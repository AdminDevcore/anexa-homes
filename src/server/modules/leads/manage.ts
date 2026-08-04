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
import { addressChanged } from "@/server/modules/geo/resolve";

/** The company's appointment timezone (defaults to Central if unset). */
async function companyTimeZone(companyId: string): Promise<string> {
  const c = await prisma.company.findUnique({ where: { id: companyId }, select: { timezone: true } });
  return c?.timezone || "America/Chicago";
}

const leadInput = z.object({
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  coOwnerName: z.string().max(80).optional().or(z.literal("")),
  preferredLanguage: z.string().max(40).optional().or(z.literal("")),
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
      preferredLanguage: d.preferredLanguage || null,
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
    select: {
      id: true, assignedRepId: true, pipelineId: true, stageId: true,
      address: true, city: true, state: true, zip: true,
    },
  });
  if (!existing) return { ok: false as const, error: "Lead not found or access denied." };

  // Coordinates are a CACHE of the address, so correcting the address has to
  // invalidate them. It didn't, which is why fixing a wrong address left the
  // deal's aerial view pointing at the old house forever — the map only ever
  // re-geocodes when lat is null. Keyed on the normalised parts so editing a
  // phone number, or re-typing the same street with different spacing, doesn't
  // throw away a pin a rep dragged onto the right roof by hand.
  const moved = addressChanged(existing, {
    address: d.address || null, city: d.city || null, state: d.state || null, zip: d.zip || null,
  });

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
      preferredLanguage: d.preferredLanguage || null,
      email: d.email || null,
      phone: d.phone || null,
      address: d.address || null,
      city: d.city || null,
      state: d.state || null,
      zip: d.zip || null,
      ...(moved ? { lat: null, lng: null, geocodedAt: null } : {}),
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

/**
 * The subset of lead fields the deal page's per-card Edit buttons can write.
 *
 * Deliberately NOT `leadInput.partial()`: that schema carries `.default()` on
 * serviceType/dealType/priority, and a default fires for an ABSENT key — so a
 * homeowner-only patch would silently post `serviceType: "roofing"` and
 * `priority: "medium"` over whatever the deal actually had. Same shape, no
 * defaults, so an omitted key stays omitted.
 */
const leadPatch = z
  .object({
    firstName: z.string().min(1).max(80),
    lastName: z.string().min(1).max(80),
    coOwnerName: z.string().max(80).or(z.literal("")),
    preferredLanguage: z.string().max(40).or(z.literal("")),
    email: z.string().email().or(z.literal("")),
    phone: z.string().max(30).or(z.literal("")),
    address: z.string().max(160).or(z.literal("")),
    city: z.string().max(80).or(z.literal("")),
    state: z.string().max(40).or(z.literal("")),
    zip: z.string().max(12).or(z.literal("")),
    sourceId: z.string().uuid().or(z.literal("")),
    assignedRepId: z.string().uuid().or(z.literal("")),
    serviceType: z.enum(["roofing", "storm_restoration", "solar", "hvac", "water_filtration", "windows", "other"]),
    dealType: z.enum(["cash", "insurance"]),
    valueCents: z.number().int().min(0),
    priority: z.enum(["low", "medium", "high", "urgent"]),
    appointmentAt: z.string().or(z.literal("")),
    notes: z.string().max(4000).or(z.literal("")),
  })
  .partial();

export type LeadPatch = z.infer<typeof leadPatch>;

/**
 * Update SOME of a lead's fields, leaving every other column alone.
 *
 * `updateLeadAction` above takes a whole `LeadInput` and writes all of it, which
 * is right for the full edit form and wrong for the deal page's per-card Edit
 * buttons: saving the Homeowner card there would post an empty stage, value and
 * priority over live data. This one writes only the keys actually present in
 * `patch`, so each card owns exactly its own fields.
 *
 * An empty string is a real value here — it means "clear this" — which is why
 * presence is tested with `in` rather than truthiness.
 */
export async function updateLeadPatchAction(leadId: string, patch: LeadPatch) {
  const user = await requireUser();
  if (!can(user, "update", "Lead")) return { ok: false as const, error: "Not allowed." };
  const parsed = leadPatch.safeParse(patch);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Invalid value." };
  const d = parsed.data;
  if (Object.keys(d).length === 0) return { ok: true as const, id: leadId };

  const scope = listScope(user, "Lead") as Prisma.LeadWhereInput;
  const existing = await prisma.lead.findFirst({
    where: { AND: [{ id: leadId }, scope] },
    select: {
      id: true, assignedRepId: true, pipelineId: true, stageId: true,
      address: true, city: true, state: true, zip: true,
    },
  });
  if (!existing) return { ok: false as const, error: "Lead not found or access denied." };

  const data: Prisma.LeadUpdateInput = {};
  // Plain string columns: "" clears to null, matching updateLeadAction.
  if ("firstName" in d) data.firstName = d.firstName!;
  if ("lastName" in d) data.lastName = d.lastName!;
  if ("coOwnerName" in d) data.coOwnerName = d.coOwnerName || null;
  if ("preferredLanguage" in d) data.preferredLanguage = d.preferredLanguage || null;
  if ("email" in d) data.email = d.email || null;
  if ("phone" in d) data.phone = d.phone || null;
  if ("address" in d) data.address = d.address || null;
  if ("city" in d) data.city = d.city || null;
  if ("state" in d) data.state = d.state || null;
  if ("zip" in d) data.zip = d.zip || null;
  if ("notes" in d) data.notes = d.notes || null;

  // Coordinates are a CACHE of the address, so correcting the address here has
  // to invalidate them exactly as the full form does — otherwise fixing a wrong
  // street from the Homeowner card leaves the deal's aerial view pointing at the
  // old house forever, since the map only re-geocodes when lat is null. A patch
  // may carry only some of the four parts, so the comparison falls back to the
  // stored value for any part this save isn't touching.
  const touchesAddress = ["address", "city", "state", "zip"].some((k) => k in d);
  if (touchesAddress) {
    const moved = addressChanged(existing, {
      address: "address" in d ? d.address || null : existing.address,
      city: "city" in d ? d.city || null : existing.city,
      state: "state" in d ? d.state || null : existing.state,
      zip: "zip" in d ? d.zip || null : existing.zip,
    });
    if (moved) {
      data.lat = null;
      data.lng = null;
      data.geocodedAt = null;
    }
  }
  if ("serviceType" in d) data.serviceType = d.serviceType!;
  if ("dealType" in d) data.dealType = d.dealType!;
  if ("priority" in d) data.priority = d.priority!;
  if ("valueCents" in d) data.value = d.valueCents!;
  if ("sourceId" in d) data.source = d.sourceId ? { connect: { id: d.sourceId } } : { disconnect: true };

  // Reassignment is a separate permission from editing — a rep may correct a
  // phone number on their own deal without being able to hand it to someone else.
  const canAssign = can(user, "assign", "Lead");
  if ("assignedRepId" in d && canAssign) {
    data.assignedRep = d.assignedRepId ? { connect: { id: d.assignedRepId } } : { disconnect: true };
  }

  // Setting or clearing the appointment re-derives the front-of-pipeline stage,
  // exactly as the full form does — otherwise booking from the Summary card
  // would leave the deal sitting in "New Lead" with a date on it.
  if ("appointmentAt" in d) {
    const tz = await companyTimeZone(user.companyId);
    data.appointmentAt = d.appointmentAt ? zonedWallClockToUtc(d.appointmentAt, tz) : null;
    const stageId = await resolveStageForAppointment({
      pipelineId: existing.pipelineId,
      candidateStageId: existing.stageId,
      hasAppointment: Boolean(d.appointmentAt),
    });
    if (stageId && stageId !== existing.stageId) {
      data.stage = { connect: { id: stageId } };
      data.stageChangedAt = new Date();
    }
  }

  await prisma.lead.update({ where: { id: existing.id }, data });

  if (canAssign && d.assignedRepId && d.assignedRepId !== existing.assignedRepId) {
    await fireEvent({ companyId: user.companyId, event: "lead_assigned", actorId: user.userId, leadId: existing.id });
  }

  revalidatePath(`/portal/leads/${existing.id}`);
  revalidatePath("/portal/leads");
  revalidatePath("/portal/pipeline");
  return { ok: true as const, id: existing.id };
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
