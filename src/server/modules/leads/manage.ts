"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma, Vertical } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { listScope } from "@/server/rbac/policies";
import { fireEvent } from "@/server/modules/notifications/engine";
import { getActiveVertical } from "@/server/auth/vertical";
import { VERTICAL_SERVICE_TYPE } from "@/lib/vertical";
import { resolveStageForAppointment } from "./staging";
import { resolveOwningRepId } from "./owning-rep";
import { zonedWallClockToUtc } from "@/lib/tz";

/** The company's appointment timezone (defaults to Central if unset). */
async function companyTimeZone(companyId: string): Promise<string> {
  const c = await prisma.company.findUnique({ where: { id: companyId }, select: { timezone: true } });
  return c?.timezone || "America/Chicago";
}

const leadInput = z.object({
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  coOwnerName: z.string().max(80).optional().or(z.literal("")),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().max(30).optional().or(z.literal("")),
  address: z.string().max(160).optional().or(z.literal("")),
  city: z.string().max(80).optional().or(z.literal("")),
  state: z.string().max(40).optional().or(z.literal("")),
  zip: z.string().max(12).optional().or(z.literal("")),
  sourceId: z.string().uuid().optional().or(z.literal("")),
  stageId: z.string().uuid().optional().or(z.literal("")),
  assignedRepId: z.string().uuid().optional().or(z.literal("")),
  // Mirrors the full ServiceType enum, retired products included — editing an
  // existing storm_restoration lead posts its current value back and must pass.
  // Which types a user may CHOOSE is enforced in the UI (SELECTABLE_SERVICE_TYPES).
  serviceType: z.enum(["roofing", "storm_restoration", "solar", "hvac", "water_filtration", "windows", "other"]).default("roofing"),
  dealType: z.enum(["cash", "insurance"]).default("insurance"),
  valueCents: z.number().int().min(0).default(0),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  appointmentAt: z.string().optional().or(z.literal("")),
  notes: z.string().max(4000).optional().or(z.literal("")),
  customFields: z.record(z.string(), z.string()).optional().default({}),
});

export type LeadInput = z.infer<typeof leadInput>;

async function defaultPipeline(companyId: string, vertical: Vertical) {
  return prisma.pipeline.findFirst({
    where: { companyId, vertical },
    orderBy: { isDefault: "desc" },
    include: { stages: { orderBy: { position: "asc" }, take: 1 } },
  });
}

export async function createLeadAction(input: LeadInput) {
  const user = await requireUser();
  if (!can(user, "create", "Lead")) return { ok: false as const, error: "Not allowed." };
  const parsed = leadInput.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Invalid lead." };
  const d = parsed.data;

  // The deal belongs to the active vertical workspace; serviceType is derived
  // from it (the form no longer lets you pick a product).
  const vertical = await getActiveVertical(user);
  const pipeline = await defaultPipeline(user.companyId, vertical);
  // Reps can only assign leads to themselves unless they can "assign". A canvasser
  // assigned to a rep auto-funnels the lead to that rep (see resolveOwningRepId).
  const canAssign = can(user, "assign", "Lead");
  const assignedRepId = canAssign
    ? d.assignedRepId || null
    : await resolveOwningRepId(user.companyId, user.userId);

  // Stage follows the appointment date: a date lands the deal in "Appointment Set",
  // no date keeps it in "New Lead" (unless an explicit forward stage was chosen).
  const hasAppointment = Boolean(d.appointmentAt);
  const stageId = await resolveStageForAppointment({
    pipelineId: pipeline?.id ?? null,
    candidateStageId: d.stageId || null,
    hasAppointment,
  });

  const tz = await companyTimeZone(user.companyId);
  const lead = await prisma.lead.create({
    data: {
      companyId: user.companyId,
      firstName: d.firstName,
      lastName: d.lastName,
      coOwnerName: d.coOwnerName || null,
      email: d.email || null,
      phone: d.phone || null,
      address: d.address || null,
      city: d.city || null,
      state: d.state || null,
      zip: d.zip || null,
      pipelineId: pipeline?.id ?? null,
      stageId,
      stageChangedAt: new Date(),
      sourceId: d.sourceId || null,
      assignedRepId,
      createdById: user.userId,
      vertical,
      serviceType: VERTICAL_SERVICE_TYPE[vertical],
      dealType: d.dealType,
      value: d.valueCents,
      priority: d.priority,
      appointmentAt: d.appointmentAt ? zonedWallClockToUtc(d.appointmentAt, tz) : null,
      notes: d.notes || null,
      customFields: d.customFields as Prisma.InputJsonValue,
    },
  });

  await prisma.activityLog.create({
    data: { companyId: user.companyId, type: "system", message: `Lead created by ${user.fullName}`, actorId: user.userId, leadId: lead.id },
  });

  await fireEvent({ companyId: user.companyId, event: "lead_created", actorId: user.userId, leadId: lead.id });
  if (assignedRepId) {
    await fireEvent({ companyId: user.companyId, event: "lead_assigned", actorId: user.userId, leadId: lead.id });
  }

  revalidatePath("/portal/leads");
  revalidatePath("/portal/pipeline");
  return { ok: true as const, id: lead.id };
}

export async function updateLeadAction(id: string, input: LeadInput) {
  const user = await requireUser();
  if (!can(user, "update", "Lead")) return { ok: false as const, error: "Not allowed." };
  const parsed = leadInput.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Invalid lead." };
  const d = parsed.data;

  const scope = listScope(user, "Lead") as Prisma.LeadWhereInput;
  const existing = await prisma.lead.findFirst({
    where: { AND: [{ id }, scope] },
    select: { id: true, assignedRepId: true, pipelineId: true, stageId: true },
  });
  if (!existing) return { ok: false as const, error: "Lead not found or access denied." };

  const canAssign = can(user, "assign", "Lead");

  // Re-derive the front-of-pipeline stage from the appointment date. Setting a
  // date moves it to "Appointment Set", clearing it returns it to "New Lead";
  // deals already past those stages are left where they are.
  const hasAppointment = Boolean(d.appointmentAt);
  const stageId = await resolveStageForAppointment({
    pipelineId: existing.pipelineId,
    candidateStageId: d.stageId || existing.stageId,
    hasAppointment,
  });
  const stageChanged = stageId !== existing.stageId;

  const tz = await companyTimeZone(user.companyId);
  await prisma.lead.update({
    where: { id },
    data: {
      firstName: d.firstName,
      lastName: d.lastName,
      coOwnerName: d.coOwnerName || null,
      email: d.email || null,
      phone: d.phone || null,
      address: d.address || null,
      city: d.city || null,
      state: d.state || null,
      zip: d.zip || null,
      stageId,
      ...(stageChanged ? { stageChangedAt: new Date() } : {}),
      sourceId: d.sourceId || null,
      ...(canAssign ? { assignedRepId: d.assignedRepId || null } : {}),
      serviceType: d.serviceType,
      dealType: d.dealType,
      value: d.valueCents,
      priority: d.priority,
      appointmentAt: d.appointmentAt ? zonedWallClockToUtc(d.appointmentAt, tz) : null,
      notes: d.notes || null,
      customFields: d.customFields as Prisma.InputJsonValue,
    },
  });

  if (canAssign && d.assignedRepId && d.assignedRepId !== existing.assignedRepId) {
    await fireEvent({ companyId: user.companyId, event: "lead_assigned", actorId: user.userId, leadId: id });
  }

  revalidatePath(`/portal/leads/${id}`);
  revalidatePath("/portal/leads");
  revalidatePath("/portal/pipeline");
  return { ok: true as const, id };
}

const dealTypeSchema = z.object({ leadId: z.string().min(1), dealType: z.enum(["cash", "insurance"]) });

/** Switch a deal between cash (out-of-pocket / financing) and insurance (filed claim).
 *  Settable on the deal page and from the proposal builder. */
export async function setDealTypeAction(input: z.infer<typeof dealTypeSchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Lead")) return { ok: false as const, error: "Not allowed." };
  const parsed = dealTypeSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid deal type." };
  const { leadId, dealType } = parsed.data;

  const scope = listScope(user, "Lead") as Prisma.LeadWhereInput;
  const lead = await prisma.lead.findFirst({ where: { AND: [{ id: leadId }, scope] }, select: { id: true } });
  if (!lead) return { ok: false as const, error: "Deal not found." };

  await prisma.lead.update({ where: { id: lead.id }, data: { dealType } });
  revalidatePath(`/portal/leads/${lead.id}`);
  revalidatePath(`/portal/leads/${lead.id}/presentation`);
  return { ok: true as const };
}

const claimPriceSchema = z.object({ leadId: z.string().min(1), amountCents: z.number().int().min(0) });

/**
 * Set the deal's CLAIM PRICE — the contract price from the insurance scope
 * (found at Scope Received). This becomes the deal's contract value; if a job
 * (project) already exists, its contract value is synced so commissions update.
 */
export async function setClaimPriceAction(input: z.infer<typeof claimPriceSchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Lead")) return { ok: false as const, error: "Not allowed." };
  const parsed = claimPriceSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Enter a valid amount." };
  const { leadId, amountCents } = parsed.data;

  const scope = listScope(user, "Lead") as Prisma.LeadWhereInput;
  const lead = await prisma.lead.findFirst({
    where: { AND: [{ id: leadId }, scope] },
    select: { id: true, project: { select: { id: true } } },
  });
  if (!lead) return { ok: false as const, error: "Deal not found." };

  await prisma.lead.update({ where: { id: lead.id }, data: { claimPrice: amountCents } });
  if (lead.project) {
    await prisma.project.update({ where: { id: lead.project.id }, data: { contractValue: amountCents } });
    revalidatePath(`/portal/projects/${lead.project.id}`);
  }
  revalidatePath(`/portal/leads/${lead.id}`);
  return { ok: true as const };
}
