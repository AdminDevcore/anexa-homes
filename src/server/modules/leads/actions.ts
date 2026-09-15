"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { listScope } from "@/server/rbac/policies";
import { fireEvent } from "@/server/modules/notifications/engine";
import { recordStageEntry } from "@/server/modules/pipeline/stage-history";
import { runAutomations } from "@/server/modules/automations/engine";
import { getActiveVertical } from "@/server/auth/vertical";
import { notifyProjectStatusChanged } from "@/server/modules/projects/status-events";
import { stageEntryData } from "@/server/modules/pipeline/stage-entry-data";
import { stageMoveError } from "@/server/modules/pipeline/stage-guard";

/** Ensures the lead exists AND is within the user's row-level scope. */
async function assertLeadInScope(userCompanyId: string, scope: Prisma.LeadWhereInput, leadId: string) {
  const lead = await prisma.lead.findFirst({
    where: { AND: [{ id: leadId }, scope] },
    select: { id: true, companyId: true },
  });
  if (!lead || lead.companyId !== userCompanyId) {
    throw new Error("Lead not found or access denied.");
  }
  return lead;
}

const noteSchema = z.object({
  leadId: z.string().uuid(),
  body: z.string().min(1).max(2000),
});

export async function addLeadNote(input: z.infer<typeof noteSchema>) {
  const user = await requireUser();
  const parsed = noteSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Note is required." };
  if (!can(user, "create", "Note")) return { ok: false as const, error: "Not allowed." };

  const scope = listScope(user, "Lead") as Prisma.LeadWhereInput;
  await assertLeadInScope(user.companyId, scope, parsed.data.leadId);

  await prisma.note.create({
    data: {
      companyId: user.companyId,
      leadId: parsed.data.leadId,
      body: parsed.data.body,
      authorId: user.userId,
    },
  });
  await prisma.activityLog.create({
    data: {
      companyId: user.companyId,
      type: "note",
      message: `Note added by ${user.fullName}`,
      actorId: user.userId,
      leadId: parsed.data.leadId,
    },
  });

  revalidatePath(`/portal/leads/${parsed.data.leadId}`);
  return { ok: true as const };
}

const outcomeNoteSchema = z.object({
  leadId: z.string().uuid(),
  context: z.enum(["appointment_outcome", "inspection_outcome"]),
  body: z.string().min(1).max(2000),
});

/**
 * Add an immutable note under an appointment / inspection outcome. These notes
 * are append-only — there is no edit/delete from the deal UI — so they form a
 * permanent record of what happened on each visit.
 */
export async function addOutcomeNoteAction(input: z.infer<typeof outcomeNoteSchema>) {
  const user = await requireUser();
  const parsed = outcomeNoteSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Note is required." };
  if (!can(user, "create", "Note")) return { ok: false as const, error: "Not allowed." };

  const scope = listScope(user, "Lead") as Prisma.LeadWhereInput;
  await assertLeadInScope(user.companyId, scope, parsed.data.leadId);

  await prisma.note.create({
    data: {
      companyId: user.companyId,
      leadId: parsed.data.leadId,
      body: parsed.data.body,
      context: parsed.data.context,
      authorId: user.userId,
    },
  });

  revalidatePath(`/portal/leads/${parsed.data.leadId}`);
  return { ok: true as const };
}

const moveSchema = z.object({
  leadId: z.string().uuid(),
  stageId: z.string().uuid(),
  position: z.number().int().min(0).optional(),
});

export async function moveLeadStage(input: z.infer<typeof moveSchema>) {
  const user = await requireUser();
  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid request." };
  if (!can(user, "update", "Lead")) return { ok: false as const, error: "Not allowed." };

  const scope = listScope(user, "Lead") as Prisma.LeadWhereInput;
  await assertLeadInScope(user.companyId, scope, parsed.data.leadId);

  // Validate stage belongs to this company.
  const stage = await prisma.pipelineStage.findFirst({
    where: { id: parsed.data.stageId, pipeline: { companyId: user.companyId } },
    select: {
      id: true,
      key: true,
      name: true,
      position: true,
      isLost: true,
      defaultBlocker: true,
      stageType: true,
      pipelineId: true,
    },
  });
  if (!stage) return { ok: false as const, error: "Invalid stage." };

  // M1 Funding is certified by the funding desk, and Contract Signed is earned
  // by two documents — neither by a drag. See pipeline/stage-guard.ts.
  const current = await prisma.lead.findFirst({
    where: { id: parsed.data.leadId, companyId: user.companyId },
    select: { vertical: true, stageId: true },
  });
  if (!current) return { ok: false as const, error: "Lead not found or access denied." };
  const moveError = await stageMoveError({
    companyId: user.companyId,
    actor: user,
    lead: { id: parsed.data.leadId, vertical: current.vertical, stageId: current.stageId },
    targetStageId: stage.id,
  });
  if (moveError) return { ok: false as const, error: moveError };

  await prisma.lead.update({
    where: { id: parsed.data.leadId },
    data: {
      ...stageEntryData(stage),
      ...(parsed.data.position !== undefined ? { position: parsed.data.position } : {}),
    },
  });
  await recordStageEntry({ leadId: parsed.data.leadId, stageId: stage.id, stage, movedById: user.userId });

  await prisma.activityLog.create({
    data: {
      companyId: user.companyId,
      type: "stage_change",
      message: `${user.fullName} moved lead to ${stage.name}`,
      actorId: user.userId,
      leadId: parsed.data.leadId,
    },
  });

  await fireEvent({
    companyId: user.companyId,
    event: "stage_changed",
    actorId: user.userId,
    leadId: parsed.data.leadId,
    stageId: parsed.data.stageId,
  });

  // Landing in a stage is the commonest thing a company wants to hang work off.
  // Best-effort like fireEvent above: the move is the business record, the
  // automation is a consequence of it, and a rep must never see an error here.
  await runAutomations({
    companyId: user.companyId,
    vertical: await getActiveVertical(user),
    trigger: "stage_entered",
    leadId: parsed.data.leadId,
    payload: { stageId: parsed.data.stageId },
    depth: 0,
  });

  revalidatePath("/portal/pipeline");
  return { ok: true as const };
}

const cancelSchema = z.object({
  leadId: z.string().uuid(),
  reason: z.string().trim().min(1).max(2000),
});

/**
 * Kill a deal: move it to its pipeline's lost stage and stop it counting as
 * live work anywhere else.
 *
 * The stage move alone is not enough. Reports read `Lead.status` and
 * `Project.status`, and no stage move has ever touched either — so a deal
 * dragged to a "Cancelled" stage went on counting as open revenue and sitting
 * in production totals. This closes all three at once.
 *
 * The target stage is whichever one the pipeline flags `isLost`, resolved from
 * the deal's own pipeline, so Roofing and Solar each cancel to their own stage
 * and no stage name is hardcoded. A pipeline with nothing flagged has no cancel
 * action — the UI hides the button, and this refuses rather than guessing that
 * the last stage means dead.
 *
 * Reversing it is a normal stage move, but `status` does NOT follow the deal
 * back out: inferring "this is live again" from a drag is how a written-off job
 * quietly re-enters revenue totals. Reopening is deliberate.
 */
export async function cancelLeadAction(input: z.infer<typeof cancelSchema>) {
  const user = await requireUser();
  const parsed = cancelSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "A reason is required." };
  if (!can(user, "update", "Lead")) return { ok: false as const, error: "Not allowed." };

  const scope = listScope(user, "Lead") as Prisma.LeadWhereInput;
  await assertLeadInScope(user.companyId, scope, parsed.data.leadId);

  const lead = await prisma.lead.findUnique({
    where: { id: parsed.data.leadId },
    // `project.status` so the cancellation only announces a status change when
    // one actually happened — cancelling an already-cancelled job should not
    // notify a second time.
    select: {
      id: true, pipelineId: true, vertical: true, stageId: true,
      project: { select: { id: true, status: true } },
    },
  });
  if (!lead?.pipelineId) return { ok: false as const, error: "This deal has no pipeline." };

  const stage = await prisma.pipelineStage.findFirst({
    where: { pipelineId: lead.pipelineId, isLost: true, pipeline: { companyId: user.companyId } },
    orderBy: { position: "asc" },
    select: { id: true, name: true, position: true, defaultBlocker: true, stageType: true },
  });
  if (!stage) {
    return {
      ok: false as const,
      error: "No cancelled stage is configured. Mark one as Lost in Settings → Pipeline.",
    };
  }

  // A lost stage is never past M1 Funding or Contract Signed, so this passes
  // today. It is asked anyway, like every other move, so the day either rule
  // changes it is answered here too — see pipeline/stage-guard.ts.
  const moveError = await stageMoveError({
    companyId: user.companyId,
    actor: user,
    lead: { id: lead.id, vertical: lead.vertical, stageId: lead.stageId },
    targetStageId: stage.id,
  });
  if (moveError) return { ok: false as const, error: moveError };

  const { reason } = parsed.data;
  await prisma.$transaction([
    prisma.lead.update({
      where: { id: lead.id },
      data: { ...stageEntryData(stage), status: "lost" },
    }),
    // Only if the deal got as far as a job. Cancelling before that is normal.
    ...(lead.project
      ? [prisma.project.update({ where: { id: lead.project.id }, data: { status: "cancelled" } })]
      : []),
    prisma.note.create({
      data: {
        companyId: user.companyId,
        leadId: lead.id,
        body: `Deal cancelled — ${reason}`,
        authorId: user.userId,
      },
    }),
    prisma.activityLog.create({
      data: {
        companyId: user.companyId,
        type: "stage_change",
        message: `${user.fullName} cancelled the deal — ${reason}`,
        actorId: user.userId,
        leadId: lead.id,
      },
    }),
  ]);

  await recordStageEntry({ leadId: lead.id, stageId: stage.id, stage, movedById: user.userId });

  // After the transaction commits, never inside it: a notification for a change
  // that then rolled back is a lie.
  if (lead.project) {
    await notifyProjectStatusChanged({
      companyId: user.companyId,
      projectId: lead.project.id,
      actorId: user.userId,
      from: lead.project.status,
      to: "cancelled",
    });
  }

  await fireEvent({
    companyId: user.companyId,
    event: "stage_changed",
    actorId: user.userId,
    leadId: lead.id,
    stageId: stage.id,
  });

  await runAutomations({
    companyId: user.companyId,
    vertical: await getActiveVertical(user),
    trigger: "stage_entered",
    leadId: lead.id,
    payload: { stageId: stage.id },
    depth: 0,
  });

  revalidatePath(`/portal/leads/${lead.id}`);
  revalidatePath("/portal/pipeline");
  return { ok: true as const, stageName: stage.name };
}

// --- Appointment disposition + claim (deal page right-rail controls) ---------

const dispoSchema = z.object({
  leadId: z.string().min(1),
  disposition: z.string().max(60).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
});

/** Record the appointment outcome and/or its note. */
export async function setAppointmentDispositionAction(input: z.infer<typeof dispoSchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Lead")) return { ok: false as const, error: "Not allowed." };
  const parsed = dispoSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid input." };
  const { leadId, disposition, note } = parsed.data;
  const scope = listScope(user, "Lead") as Prisma.LeadWhereInput;
  const lead = await prisma.lead.findFirst({ where: { AND: [{ id: leadId }, scope] }, select: { id: true } });
  if (!lead) return { ok: false as const, error: "Appointment not found." };
  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      ...(disposition !== undefined ? { appointmentDisposition: disposition || null } : {}),
      ...(note !== undefined ? { appointmentNote: note || null } : {}),
    },
  });
  revalidatePath(`/portal/leads/${lead.id}`);
  return { ok: true as const };
}

const inspectionSchema = z.object({
  leadId: z.string().min(1),
  outcome: z.string().max(60).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
});

/** Record the inspection outcome (post-appointment / claim) and/or its note. */
export async function setInspectionOutcomeAction(input: z.infer<typeof inspectionSchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Lead")) return { ok: false as const, error: "Not allowed." };
  const parsed = inspectionSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid input." };
  const { leadId, outcome, note } = parsed.data;
  const scope = listScope(user, "Lead") as Prisma.LeadWhereInput;
  const lead = await prisma.lead.findFirst({ where: { AND: [{ id: leadId }, scope] }, select: { id: true } });
  if (!lead) return { ok: false as const, error: "Appointment not found." };
  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      ...(outcome !== undefined ? { inspectionOutcome: outcome || null } : {}),
      ...(note !== undefined ? { inspectionNote: note || null } : {}),
    },
  });
  revalidatePath(`/portal/leads/${lead.id}`);
  return { ok: true as const };
}

/*
 * `openClaimAction` lived here: a button that created the claim row and forced
 * the status to "filed". Opening a claim is now a side effect of setting the
 * Claim Status — see `setClaimStatusAction` in ./manage.ts — so the deal has one
 * claim control instead of two that disagreed about the status.
 */

const claimInfoSchema = z.object({
  leadId: z.string().min(1),
  carrier: z.string().max(120).optional().nullable(),
  claimNumber: z.string().max(80).optional().nullable(),
  policyNumber: z.string().max(80).optional().nullable(),
  adjusterName: z.string().max(120).optional().nullable(),
  adjusterPhone: z.string().max(40).optional().nullable(),
  adjusterEmail: z.string().max(160).optional().nullable(),
  lossDate: z.string().optional().nullable(),
  adjusterMeetingAt: z.string().optional().nullable(),
  deductibleCents: z.number().int().min(0).optional().nullable(),
  rcvCents: z.number().int().min(0).optional().nullable(),
  acvCents: z.number().int().min(0).optional().nullable(),
  depreciationCents: z.number().int().min(0).optional().nullable(),
  // Roof information
  roofSquares: z.number().min(0).optional().nullable(),
  wasteFactorPct: z.number().min(0).optional().nullable(),
  pitch: z.string().max(20).optional().nullable(),
  storyCount: z.number().int().min(0).optional().nullable(),
  // Flagged supplement opportunities (array of keys)
  supplementOpportunities: z.array(z.string().max(40)).optional(),
});

/** Update the claim's information (carrier, adjuster, amounts, etc.). */
export async function updateClaimInfoAction(input: z.infer<typeof claimInfoSchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Claim")) return { ok: false as const, error: "Not allowed." };
  const parsed = claimInfoSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid claim info." };
  const d = parsed.data;
  const scope = listScope(user, "Lead") as Prisma.LeadWhereInput;
  const lead = await prisma.lead.findFirst({ where: { AND: [{ id: d.leadId }, scope] }, select: { id: true, companyId: true } });
  if (!lead) return { ok: false as const, error: "Deal not found." };
  const claim = await prisma.claim.findFirst({ where: { leadId: lead.id, companyId: lead.companyId }, select: { id: true } });
  if (!claim) return { ok: false as const, error: "Open a claim first." };
  await prisma.claim.update({
    where: { id: claim.id },
    data: {
      ...(d.carrier !== undefined ? { carrier: d.carrier || null } : {}),
      ...(d.claimNumber !== undefined ? { claimNumber: d.claimNumber || null } : {}),
      ...(d.policyNumber !== undefined ? { policyNumber: d.policyNumber || null } : {}),
      ...(d.adjusterName !== undefined ? { adjusterName: d.adjusterName || null } : {}),
      ...(d.adjusterPhone !== undefined ? { adjusterPhone: d.adjusterPhone || null } : {}),
      ...(d.adjusterEmail !== undefined ? { adjusterEmail: d.adjusterEmail || null } : {}),
      ...(d.lossDate !== undefined ? { lossDate: d.lossDate ? new Date(`${d.lossDate}T12:00:00`) : null } : {}),
      ...(d.adjusterMeetingAt !== undefined ? { adjusterMeetingAt: d.adjusterMeetingAt ? new Date(`${d.adjusterMeetingAt}T12:00:00`) : null } : {}),
      ...(d.deductibleCents !== undefined && d.deductibleCents !== null ? { deductible: d.deductibleCents } : {}),
      ...(d.rcvCents !== undefined && d.rcvCents !== null ? { rcv: d.rcvCents } : {}),
      ...(d.acvCents !== undefined && d.acvCents !== null ? { acv: d.acvCents } : {}),
      ...(d.depreciationCents !== undefined && d.depreciationCents !== null ? { depreciation: d.depreciationCents } : {}),
      ...(d.roofSquares !== undefined ? { roofSquares: d.roofSquares } : {}),
      ...(d.wasteFactorPct !== undefined ? { wasteFactorPct: d.wasteFactorPct } : {}),
      ...(d.pitch !== undefined ? { pitch: d.pitch || null } : {}),
      ...(d.storyCount !== undefined ? { storyCount: d.storyCount } : {}),
      ...(d.supplementOpportunities !== undefined ? { supplementOpportunities: d.supplementOpportunities } : {}),
    },
  });
  revalidatePath(`/portal/leads/${lead.id}`);
  revalidatePath("/portal/calendar");
  return { ok: true as const };
}

// --- Claim line items (Xactimate worksheet) ----------------------------------

async function claimForLead(user: Awaited<ReturnType<typeof requireUser>>, leadId: string) {
  const scope = listScope(user, "Lead") as Prisma.LeadWhereInput;
  const lead = await prisma.lead.findFirst({ where: { AND: [{ id: leadId }, scope] }, select: { id: true, companyId: true } });
  if (!lead) return null;
  return prisma.claim.findFirst({ where: { leadId: lead.id, companyId: lead.companyId }, select: { id: true } });
}

export async function addClaimLineItemAction(leadId: string) {
  const user = await requireUser();
  if (!can(user, "update", "Claim")) return { ok: false as const, error: "Not allowed." };
  const claim = await claimForLead(user, leadId);
  if (!claim) return { ok: false as const, error: "Open a claim first." };
  await prisma.claimLineItem.create({ data: { claimId: claim.id, description: "New line item", quantity: 1 } });
  revalidatePath(`/portal/leads/${leadId}`);
  return { ok: true as const };
}

const lineItemSchema = z.object({
  id: z.string().min(1),
  leadId: z.string().min(1),
  code: z.string().max(40).optional().nullable(),
  description: z.string().max(200).optional(),
  quantity: z.number().min(0).optional(),
  unit: z.string().max(20).optional().nullable(),
  unitPriceCents: z.number().int().min(0).optional(),
});

export async function updateClaimLineItemAction(input: z.infer<typeof lineItemSchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Claim")) return { ok: false as const, error: "Not allowed." };
  const parsed = lineItemSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid line item." };
  const d = parsed.data;
  const claim = await claimForLead(user, d.leadId);
  if (!claim) return { ok: false as const, error: "Claim not found." };
  const item = await prisma.claimLineItem.findFirst({ where: { id: d.id, claimId: claim.id }, select: { id: true } });
  if (!item) return { ok: false as const, error: "Line item not found." };
  await prisma.claimLineItem.update({
    where: { id: d.id },
    data: {
      ...(d.code !== undefined ? { code: d.code || null } : {}),
      ...(d.description !== undefined ? { description: d.description || "—" } : {}),
      ...(d.quantity !== undefined ? { quantity: d.quantity } : {}),
      ...(d.unit !== undefined ? { unit: d.unit || null } : {}),
      ...(d.unitPriceCents !== undefined ? { unitPrice: d.unitPriceCents } : {}),
    },
  });
  revalidatePath(`/portal/leads/${d.leadId}`);
  return { ok: true as const };
}

export async function deleteClaimLineItemAction(input: { id: string; leadId: string }) {
  const user = await requireUser();
  if (!can(user, "update", "Claim")) return { ok: false as const, error: "Not allowed." };
  const claim = await claimForLead(user, input.leadId);
  if (!claim) return { ok: false as const, error: "Claim not found." };
  const item = await prisma.claimLineItem.findFirst({ where: { id: input.id, claimId: claim.id }, select: { id: true } });
  if (!item) return { ok: false as const, error: "Line item not found." };
  await prisma.claimLineItem.delete({ where: { id: input.id } });
  revalidatePath(`/portal/leads/${input.leadId}`);
  return { ok: true as const };
}
