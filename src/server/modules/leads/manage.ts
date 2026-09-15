"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma, Vertical } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { listScope } from "@/server/rbac/policies";
import { fireEvent } from "@/server/modules/notifications/engine";
import { recordStageEntry } from "@/server/modules/pipeline/stage-history";
import { getActiveVertical } from "@/server/auth/vertical";
import { getClaimStatuses } from "@/server/modules/settings/queries";
import { claimStatusOpensClaim } from "@/lib/claim-status";
import { VERTICAL_SERVICE_TYPE } from "@/lib/vertical";
import { resolveStageForAppointment } from "./staging";
import { guardedStageId } from "@/server/modules/pipeline/contract-signed";
import { resolveOwningRepId } from "./owning-rep";
import { zonedWallClockToUtc } from "@/lib/tz";
import { addressChanged } from "@/server/modules/geo/resolve";
import { leadContactFields } from "./contact-fields";
import {
  appointmentMovePatch,
  planLeadAppointmentMove,
  recordAppointmentReschedule,
} from "./appointment-moves";
import type { AppointmentReschedule } from "@/lib/appointment-reschedule";

/** The company's appointment timezone (defaults to Central if unset). */
async function companyTimeZone(companyId: string): Promise<string> {
  const c = await prisma.company.findUnique({ where: { id: companyId }, select: { timezone: true } });
  return c?.timezone || "America/Chicago";
}

const leadInput = z.object({
  // The contact half is shared with the solar builder's Customer step — see
  // leadContactFields. One definition of a valid name, not two.
  ...leadContactFields,
  sourceId: z.string().uuid().optional().or(z.literal("")),
  stageId: z.string().uuid().optional().or(z.literal("")),
  assignedRepId: z.string().uuid().optional().or(z.literal("")),
  /** Who knocked and booked it, where that is not the rep who runs it. */
  setterId: z.string().uuid().optional().or(z.literal("")),
  /**
   * Solar only: the utility that delivers the power, captured at the door.
   *
   * Asked here because the rep is standing in front of the meter, and because
   * the proposal's Energy step needs it before it can derive a rate. It seeds
   * the design rather than living on the lead — the design is what owns it —
   * and a later edit there wins.
   */
  utilityProvider: z.string().max(120).optional().or(z.literal("")),
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
  // A rooftop point the rep picked from the address dropdown, for the address
  // in THIS payload. Optional because the field still accepts free text: type
  // the address instead of picking it and the nightly cron geocodes it as
  // before. Sent only while the picked address is still what's in the form —
  // the client drops it the moment any address field is hand-edited, so these
  // can't describe some earlier house.
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

export type LeadInput = z.infer<typeof leadInput>;

/**
 * Coordinates to write for a lead whose address the rep picked from the
 * dropdown, or null to leave the cron to it.
 *
 * Only a rooftop pick counts. The dropdown falls back to Nominatim when Places
 * is unavailable, and a Nominatim point is interpolated along the road
 * centreline — accurate to the block, never to the lot. Storing one here would
 * plant exactly the bug `geo/resolve.ts` exists to describe, with the added
 * insult that `geocodedAt` being set stops the cron ever revisiting it.
 */
function pickedRooftop(d: LeadInput): { lat: number; lng: number; geocodedAt: Date } | null {
  if (typeof d.lat !== "number" || typeof d.lng !== "number") return null;
  return { lat: d.lat, lng: d.lng, geocodedAt: new Date() };
}

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
  const resolvedStageId = await resolveStageForAppointment({
    pipelineId: pipeline?.id ?? null,
    candidateStageId: d.stageId || null,
    hasAppointment,
  });
  // A new deal has no documents on file, so it can never START at or past
  // Contract Signed — see guardedStageId.
  const guard = await guardedStageId({
    companyId: user.companyId,
    lead: { id: null, vertical, stageId: null },
    resolvedStageId,
    explicitStageId: d.stageId || null,
    fallbackStageId: pipeline?.stages[0]?.id ?? null,
  });
  if (!guard.ok) return { ok: false as const, error: guard.error };
  const stageId = guard.stageId;

  const tz = await companyTimeZone(user.companyId);
  const lead = await prisma.lead.create({
    data: {
      companyId: user.companyId,
      firstName: d.firstName,
      lastName: d.lastName,
      coOwnerName: d.coOwnerName || null,
      coOwnerEmail: d.coOwnerEmail || null,
      coOwnerPhone: d.coOwnerPhone || null,
      preferredLanguage: d.preferredLanguage || null,
      email: d.email || null,
      phone: d.phone || null,
      address: d.address || null,
      city: d.city || null,
      state: d.state || null,
      zip: d.zip || null,
      // A picked address arrives already geocoded, so the lead plots on the
      // right roof immediately instead of waiting for tonight's cron to
      // interpolate one off a road centreline.
      ...(pickedRooftop(d) ?? {}),
      pipelineId: pipeline?.id ?? null,
      stageId,
      stageChangedAt: new Date(),
      sourceId: d.sourceId || null,
      assignedRepId,
      setterId: d.setterId || null,
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

  await recordStageEntry({ leadId: lead.id, stageId, movedById: user.userId });

  // The utility the rep read off the meter, put where the proposal looks for
  // it. Seeded into the design rather than stored on the lead: the design is
  // what owns the energy figures, and the Energy step's own edit then wins
  // without two fields disagreeing about which utility this house is on.
  if (vertical === "solar" && d.utilityProvider) {
    await prisma.solarDesign.upsert({
      where: { leadId: lead.id },
      create: { companyId: user.companyId, leadId: lead.id, utilityProvider: d.utilityProvider },
      update: { utilityProvider: d.utilityProvider },
    });
  }

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
      // Which workspace this deal is in decides whether the form's solar-only
      // fields mean anything.
      vertical: true,
      // Moving the time on a solar deal is recorded as a reschedule.
      appointmentAt: true,
      appointmentDisposition: true,
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
  const resolvedStageId = await resolveStageForAppointment({
    pipelineId: existing.pipelineId,
    candidateStageId: d.stageId || existing.stageId,
    hasAppointment,
  });
  // The lead form can move a deal as well as the board can, so it is held to
  // the same Contract Signed rule.
  const guard = await guardedStageId({
    companyId: user.companyId,
    lead: { id, vertical: existing.vertical, stageId: existing.stageId },
    resolvedStageId,
    explicitStageId: d.stageId || null,
  });
  if (!guard.ok) return { ok: false as const, error: guard.error };
  const stageId = guard.stageId;
  const stageChanged = stageId !== existing.stageId;

  const tz = await companyTimeZone(user.companyId);
  const appointmentAt = d.appointmentAt ? zonedWallClockToUtc(d.appointmentAt, tz) : null;
  const move = await planLeadAppointmentMove(user.companyId, existing, appointmentAt);
  await prisma.lead.update({
    where: { id },
    data: {
      firstName: d.firstName,
      lastName: d.lastName,
      coOwnerName: d.coOwnerName || null,
      coOwnerEmail: d.coOwnerEmail || null,
      coOwnerPhone: d.coOwnerPhone || null,
      preferredLanguage: d.preferredLanguage || null,
      email: d.email || null,
      phone: d.phone || null,
      address: d.address || null,
      city: d.city || null,
      state: d.state || null,
      zip: d.zip || null,
      // Correcting an address invalidates its cached pin. If the correction came
      // from the dropdown we already hold the new roof's coordinates, so replace
      // rather than clear; otherwise clear and let the cron re-derive.
      ...(moved ? (pickedRooftop(d) ?? { lat: null, lng: null, geocodedAt: null }) : {}),
      stageId,
      ...(stageChanged ? { stageChangedAt: new Date() } : {}),
      sourceId: d.sourceId || null,
      ...(canAssign ? { assignedRepId: d.assignedRepId || null, setterId: d.setterId || null } : {}),
      serviceType: d.serviceType,
      dealType: d.dealType,
      value: d.valueCents,
      priority: d.priority,
      appointmentAt,
      ...appointmentMovePatch(move),
      notes: d.notes || null,
      customFields: d.customFields as Prisma.InputJsonValue,
    },
  });

  if (stageChanged) await recordStageEntry({ leadId: id, stageId, movedById: user.userId });
  await recordAppointmentReschedule(id, move, user.userId);

  // The utility is the design's, not the lead's, so an edit writes it through
  // to the design. Only when the form actually sent one: a roofing edit, or a
  // solar edit that left the box alone, must not blank what the Energy step
  // has since recorded.
  if (existing.vertical === "solar" && d.utilityProvider) {
    await prisma.solarDesign.upsert({
      where: { leadId: id },
      create: { companyId: user.companyId, leadId: id, utilityProvider: d.utilityProvider },
      update: { utilityProvider: d.utilityProvider },
    });
  }

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
    coOwnerEmail: z.string().email().or(z.literal("")),
    coOwnerPhone: z.string().max(30).or(z.literal("")),
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
      vertical: true, appointmentAt: true, appointmentDisposition: true,
    },
  });
  if (!existing) return { ok: false as const, error: "Lead not found or access denied." };

  const data: Prisma.LeadUpdateInput = {};
  // Plain string columns: "" clears to null, matching updateLeadAction.
  if ("firstName" in d) data.firstName = d.firstName!;
  if ("lastName" in d) data.lastName = d.lastName!;
  if ("coOwnerName" in d) data.coOwnerName = d.coOwnerName || null;
  if ("coOwnerEmail" in d) data.coOwnerEmail = d.coOwnerEmail || null;
  if ("coOwnerPhone" in d) data.coOwnerPhone = d.coOwnerPhone || null;
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
  let movedTo: string | null = null;
  let move: AppointmentReschedule | null = null;
  if ("appointmentAt" in d) {
    const tz = await companyTimeZone(user.companyId);
    const nextAt = d.appointmentAt ? zonedWallClockToUtc(d.appointmentAt, tz) : null;
    data.appointmentAt = nextAt;
    // Moving a solar deal's time is a reschedule; a stale outcome comes off with it.
    move = await planLeadAppointmentMove(user.companyId, existing, nextAt);
    Object.assign(data, appointmentMovePatch(move));
    const resolvedStageId = await resolveStageForAppointment({
      pipelineId: existing.pipelineId,
      candidateStageId: existing.stageId,
      hasAppointment: Boolean(d.appointmentAt),
    });
    // Automatic only, so a re-stage that would cross Contract Signed is simply
    // not applied rather than failing the save — see guardedStageId.
    const guard = await guardedStageId({
      companyId: user.companyId,
      lead: { id: existing.id, vertical: existing.vertical, stageId: existing.stageId },
      resolvedStageId,
      explicitStageId: null,
    });
    const stageId = guard.ok ? guard.stageId : existing.stageId;
    if (stageId && stageId !== existing.stageId) {
      data.stage = { connect: { id: stageId } };
      data.stageChangedAt = new Date();
      movedTo = stageId;
    }
  }

  await prisma.lead.update({ where: { id: existing.id }, data });
  if (movedTo) await recordStageEntry({ leadId: existing.id, stageId: movedTo, movedById: user.userId });
  await recordAppointmentReschedule(existing.id, move, user.userId);

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

const claimStatusSchema = z.object({
  leadId: z.string().min(1),
  status: z.string().min(1).max(60),
  // The essentials, captured in the same call that opens the claim. Optional
  // because the rep may not have the claim number yet — see the doc comment.
  carrier: z.string().max(120).optional(),
  claimNumber: z.string().max(80).optional(),
  lossDate: z.string().max(40).optional(),
});

/**
 * Move the deal along its insurance claim — and OPEN the claim if this is the
 * first status that says one exists.
 *
 * The accepted values are the COMPANY's configured list (Settings → Claim
 * Statuses), not a fixed enum — so this validates against that list rather than
 * against a type. Anything not on the list is rejected: the column is plain text
 * now, and without this check a stale tab could write a status the office
 * deleted months ago.
 *
 * This is the ONLY way a claim gets opened. There used to be a separate "Open
 * claim" button beside this picker, which made two controls for one idea and
 * always slammed the status to "Filed" — so a deal whose adjuster was already
 * scheduled had to be filed first and corrected second. Picking the status the
 * deal is actually on now does the whole job.
 *
 * Going BACK to Not Filed destroys nothing: the claim row and everything typed
 * into the worksheet stay exactly where they are. A dropdown must never be able
 * to delete a carrier, an adjuster and an RCV.
 *
 * `carrier` / `claimNumber` / `lossDate` are what the picker's dialog collects
 * as it opens the claim, so the claim is born with the identifying facts instead
 * of as an empty worksheet that merely claims to be Filed. They stay OPTIONAL:
 * a rep who files by phone is sometimes told the claim number will follow, and
 * refusing to record the status until the carrier calls back would just push the
 * truth out of the CRM. Skipped claims are flagged incomplete instead — see
 * `claimIsIncomplete`.
 */
export async function setClaimStatusAction(input: z.infer<typeof claimStatusSchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Lead")) return { ok: false as const, error: "Not allowed." };
  const parsed = claimStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid status." };
  const { leadId, status, carrier, claimNumber, lossDate } = parsed.data;

  const scope = listScope(user, "Lead") as Prisma.LeadWhereInput;
  const lead = await prisma.lead.findFirst({
    where: { AND: [{ id: leadId }, scope] },
    select: { id: true, companyId: true, vertical: true, claimStatus: true },
  });
  if (!lead) return { ok: false as const, error: "Deal not found." };

  const options = await getClaimStatuses(user.companyId, lead.vertical);
  if (!options.some((o) => o.key === status) && status !== lead.claimStatus) {
    return { ok: false as const, error: "That status is no longer available." };
  }

  const claim = await prisma.claim.findFirst({
    where: { leadId: lead.id, companyId: lead.companyId },
    select: { id: true },
  });

  // Only ever written on the way IN. An existing claim's carrier is edited in the
  // worksheet, and a blank field in the picker's dialog must not wipe it.
  const opening = {
    ...(carrier?.trim() ? { carrier: carrier.trim() } : {}),
    ...(claimNumber?.trim() ? { claimNumber: claimNumber.trim() } : {}),
    ...(lossDate?.trim() ? { lossDate: new Date(`${lossDate.trim()}T12:00:00`) } : {}),
  };

  if (!claim && claimStatusOpensClaim(status)) {
    if (!can(user, "create", "Claim")) return { ok: false as const, error: "Not allowed to open a claim." };
    await prisma.claim.create({
      data: { companyId: lead.companyId, leadId: lead.id, vertical: lead.vertical, status, ...opening },
    });
  } else if (claim) {
    // Keep the claim's own status in step with the deal's. These drifted before:
    // `Claim.status` was written once at creation and never again, while the
    // homeowner's proposal reads it (proposals/queries.ts) — so a deal long since
    // Approved still told the customer "Filed".
    await prisma.claim.update({ where: { id: claim.id }, data: { status } });
  }

  await prisma.lead.update({ where: { id: lead.id }, data: { claimStatus: status } });
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
