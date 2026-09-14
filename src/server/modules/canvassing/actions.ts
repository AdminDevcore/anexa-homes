"use server";

import { z } from "zod";
import type { KnockDisposition } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { getActiveVertical } from "@/server/auth/vertical";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { leadAccessible } from "@/server/rbac/lead-access";
import { DISPOSITION_VALUES, pointInPolygon, type LatLng } from "@/lib/canvassing";
import { canManageAllCanvassing } from "./policies";
import { fetchAddressesInPolygon, coordKey } from "./addresses";
import { fireEvent } from "@/server/modules/notifications/engine";
import { resolvePropertyValue } from "@/server/modules/property";
import { importOwnerRecords, type OwnerRowMapping, type OwnerImportResult } from "@/server/modules/property/owner-records";
import { getSkipTraceProvider, type OwnerResult } from "@/server/modules/skiptrace/provider";
import { resolveStageForAppointment } from "@/server/modules/leads/staging";
import { resolveOwningRepId } from "@/server/modules/leads/owning-rep";
import { recordStageEntry } from "@/server/modules/pipeline/stage-history";
import {
  appointmentMovePatch,
  planLeadAppointmentMove,
  recordAppointmentReschedule,
} from "@/server/modules/leads/appointment-moves";
import { tracksReschedules } from "@/lib/appointment-reschedule";

function fail(error: string) {
  return { ok: false as const, error };
}

const dispositionEnum = z.enum(DISPOSITION_VALUES as [string, ...string[]]);

const knockSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address: z.string().max(200).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  state: z.string().max(40).optional().nullable(),
  zip: z.string().max(20).optional().nullable(),
  disposition: dispositionEnum,
  notes: z.string().max(2000).optional().nullable(),
});

/** Find which (if any) territory polygon contains the point. */
async function detectTerritory(companyId: string, lat: number, lng: number): Promise<string | null> {
  const territories = await prisma.territory.findMany({
    where: { companyId },
    select: { id: true, polygon: true },
  });
  for (const t of territories) {
    const poly = (t.polygon as LatLng[]) ?? [];
    if (poly.length >= 3 && pointInPolygon([lat, lng], poly)) return t.id;
  }
  return null;
}

export async function createKnockAction(
  input: z.infer<typeof knockSchema>
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const me = await requireUser();
  if (!can(me, "create", "Canvassing")) return fail("You don't have access to canvassing.");

  const parsed = knockSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid knock.");
  const d = parsed.data;

  const territoryId = await detectTerritory(me.companyId, d.lat, d.lng);

  const knock = await prisma.knock.create({
    data: {
      companyId: me.companyId,
      repId: me.userId,
      territoryId,
      lat: d.lat,
      lng: d.lng,
      address: d.address ?? null,
      city: d.city ?? null,
      state: d.state ?? null,
      zip: d.zip ?? null,
      disposition: d.disposition as KnockDisposition,
      notes: d.notes ?? null,
    },
    select: { id: true },
  });
  return { ok: true, id: knock.id };
}

const updateKnockSchema = z.object({
  id: z.string().min(1),
  disposition: dispositionEnum.optional(),
  notes: z.string().max(2000).optional().nullable(),
  address: z.string().max(200).optional().nullable(),
  // Reposition the dot (drag-to-correct on the map). Both must be supplied.
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

export async function updateKnockAction(
  input: z.infer<typeof updateKnockSchema>
): Promise<{ ok: boolean; error?: string }> {
  const me = await requireUser();
  if (!can(me, "update", "Canvassing")) return { ok: false, error: "No access." };
  const parsed = updateKnockSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid update." };

  const knock = await prisma.knock.findFirst({
    where: { id: parsed.data.id, companyId: me.companyId },
    select: { repId: true, disposition: true, leadId: true },
  });
  if (!knock) return { ok: false, error: "Knock not found." };
  // Anyone with access can knock an unclaimed (not_knocked) pin; otherwise only
  // the owning rep or a manager may edit it.
  const unclaimed = knock.repId === null || knock.disposition === "not_knocked";
  if (!unclaimed && knock.repId !== me.userId && !canManageAllCanvassing(me.role)) {
    return { ok: false, error: "You can only edit your own knocks." };
  }

  // When a rep sets a real status on a blank pin, it becomes their knock now.
  const claiming = parsed.data.disposition && (knock.repId === null || knock.disposition === "not_knocked");

  // Reposition: when both coordinates are supplied, move the dot and re-detect
  // which territory now contains it.
  const moving = parsed.data.lat !== undefined && parsed.data.lng !== undefined;
  const movedTerritoryId = moving ? await detectTerritory(me.companyId, parsed.data.lat!, parsed.data.lng!) : undefined;

  const newDisp = parsed.data.disposition as KnockDisposition | undefined;
  await prisma.knock.update({
    where: { id: parsed.data.id },
    data: {
      ...(newDisp ? { disposition: newDisp } : {}),
      ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
      ...(parsed.data.address !== undefined ? { address: parsed.data.address } : {}),
      ...(moving ? { lat: parsed.data.lat, lng: parsed.data.lng, territoryId: movedTerritoryId } : {}),
      ...(claiming ? { repId: me.userId, knockedAt: new Date() } : {}),
    },
  });
  // Keep a converted deal's map pin in sync with its source house.
  if (moving && knock.leadId) {
    await prisma.lead.updateMany({
      where: { id: knock.leadId, companyId: me.companyId },
      data: { lat: parsed.data.lat, lng: parsed.data.lng, geocodedAt: new Date() },
    });
  }
  // Record status changes in the per-house timeline (visit history / audit trail).
  if (newDisp && newDisp !== knock.disposition) {
    await prisma.knockEvent.create({
      data: {
        companyId: me.companyId,
        knockId: parsed.data.id,
        type: "status_change",
        disposition: newDisp,
        authorId: me.userId,
        authorName: me.fullName,
      },
    });
  }
  return { ok: true };
}

const leadPositionSchema = z.object({
  leadId: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

/** Move a deal/appointment pin on the canvassing map (drag-to-correct). Also
 *  nudges any source knock so the house dot and the deal stay together. */
export async function updateLeadPositionAction(
  input: z.infer<typeof leadPositionSchema>
): Promise<{ ok: boolean; error?: string }> {
  const me = await requireUser();
  if (!can(me, "update", "Canvassing")) return fail("No access.");
  const parsed = leadPositionSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid position.");
  const { leadId, lat, lng } = parsed.data;
  // Canvassing scopes KNOCKS with knockScope, but this moves a LEAD, and the
  // lead scope is the one that decides whose pin this is.
  const lead = await leadAccessible(me, leadId);
  if (!lead) return fail("Deal not found.");
  await prisma.lead.update({ where: { id: lead.id }, data: { lat, lng, geocodedAt: new Date() } });
  await prisma.knock.updateMany({ where: { companyId: me.companyId, leadId: lead.id }, data: { lat, lng } });
  return { ok: true };
}

const commentSchema = z.object({ knockId: z.string().min(1), body: z.string().min(1).max(2000) });

/** Add a timestamped comment to a house's timeline (records author + status at the time). */
export async function addKnockCommentAction(
  input: z.infer<typeof commentSchema>
): Promise<{ ok: boolean; error?: string }> {
  const me = await requireUser();
  if (!can(me, "update", "Canvassing")) return fail("No access.");
  const parsed = commentSchema.safeParse(input);
  if (!parsed.success) return fail("Comment can't be empty.");
  const knock = await prisma.knock.findFirst({
    where: { id: parsed.data.knockId, companyId: me.companyId },
    select: { repId: true, disposition: true },
  });
  if (!knock) return fail("Knock not found.");
  if (knock.repId && knock.repId !== me.userId && !canManageAllCanvassing(me.role)) {
    return fail("You can only comment on your own knocks.");
  }
  await prisma.knockEvent.create({
    data: {
      companyId: me.companyId,
      knockId: parsed.data.knockId,
      type: "comment",
      body: parsed.data.body.trim(),
      disposition: knock.disposition,
      authorId: me.userId,
      authorName: me.fullName,
    },
  });
  return { ok: true };
}

const contactSchema = z.object({
  knockId: z.string().min(1),
  contactName: z.string().max(120).optional().nullable(),
  contactPhone: z.string().max(40).optional().nullable(),
  contactEmail: z.string().max(160).optional().nullable(),
  bestTime: z.string().max(80).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

/** Capture/update homeowner contact info on a house pin. */
export async function updateKnockContactAction(
  input: z.infer<typeof contactSchema>
): Promise<{ ok: boolean; error?: string }> {
  const me = await requireUser();
  if (!can(me, "update", "Canvassing")) return fail("No access.");
  const parsed = contactSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid contact info.");
  const { knockId, ...rest } = parsed.data;
  const knock = await prisma.knock.findFirst({ where: { id: knockId, companyId: me.companyId }, select: { repId: true } });
  if (!knock) return fail("Knock not found.");
  if (knock.repId && knock.repId !== me.userId && !canManageAllCanvassing(me.role)) {
    return fail("You can only edit your own knocks.");
  }
  const data: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(rest)) if (v !== undefined) data[k] = v;
  await prisma.knock.update({ where: { id: knockId }, data });
  await prisma.knockEvent.create({
    data: { companyId: me.companyId, knockId, type: "contact_update", authorId: me.userId, authorName: me.fullName },
  });
  return { ok: true };
}

// --- Homeowner skip-trace (BatchData etc.) ----------------------------------

/** Import a county appraisal roll (public CAD data): fills owner name + value on
 *  matching houses by address. Free — no per-lookup cost. Managers only. */
export async function importOwnerRecordsAction(input: {
  csvText: string;
  mapping: OwnerRowMapping;
}): Promise<{ ok: true; result: OwnerImportResult } | { ok: false; error: string }> {
  const me = await requireUser();
  if (!canManageAllCanvassing(me.role)) return { ok: false, error: "Managers only." };
  if (!input?.csvText?.trim()) return { ok: false, error: "Upload a CSV file first." };
  if (!input?.mapping?.owner || !input?.mapping?.address) return { ok: false, error: "Map the Owner name and Address columns." };
  try {
    const result = await importOwnerRecords(me.companyId, input.csvText, input.mapping);
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: (e as Error).message || "Import failed." };
  }
}

/** Queue a full re-check of homeowner data: clears the "looked up" stamp on every
 *  house so the nightly enrich cron re-pulls owner/contact for all of them. Use
 *  after a storm to re-verify who lives there. Managers only. Bills per lookup. */
export async function requeueOwnerEnrichmentAction(): Promise<{ ok: boolean; error?: string; queued?: number }> {
  const me = await requireUser();
  if (!canManageAllCanvassing(me.role)) return { ok: false, error: "Managers only." };
  const res = await prisma.knock.updateMany({
    where: { companyId: me.companyId, address: { not: null } },
    data: { ownerLookedUpAt: null },
  });
  return { ok: true, queued: res.count };
}

export type OwnerLookupResult =
  | { ok: true; result: OwnerResult; applied: { contactName: string | null; contactPhone: string | null; contactEmail: string | null } }
  | { ok: false; error: string };

/** Look up the homeowner's name / phone / email for a house from its address via the
 *  configured skip-trace provider. Caches the full result on the knock and auto-fills
 *  any contact field that's still blank (never overwrites rep-entered values). */
export async function lookupOwnerAction(input: { knockId: string; refresh?: boolean }): Promise<OwnerLookupResult> {
  const me = await requireUser();
  if (!can(me, "update", "Canvassing")) return fail("No access.");
  const knock = await prisma.knock.findFirst({
    where: { id: input.knockId, companyId: me.companyId },
    select: {
      id: true, repId: true, address: true, city: true, state: true, zip: true,
      contactName: true, contactPhone: true, contactEmail: true, ownerData: true,
    },
  });
  if (!knock) return fail("Knock not found.");
  if (knock.repId && knock.repId !== me.userId && !canManageAllCanvassing(me.role)) {
    return fail("You can only look up your own knocks.");
  }
  if (!knock.address) return fail("This house has no address to look up.");

  const provider = getSkipTraceProvider();
  if (provider.name === "Unavailable") {
    return fail("Owner lookup isn't configured. Add a skip-trace provider in settings to enable it.");
  }

  // Reuse the cached result unless the rep explicitly refreshes (skip-trace is billed).
  const cached = knock.ownerData as OwnerResult | null;
  const result = !input.refresh && cached && (cached.names?.length || cached.phones?.length || cached.emails?.length)
    ? cached
    : await provider.lookup({ address: knock.address, city: knock.city, state: knock.state, zip: knock.zip });

  if (!result) return fail("No homeowner match found for this address.");

  // Auto-fill only blank fields; the rep can override and Save.
  const contactName = knock.contactName || result.names[0] || null;
  const contactPhone = knock.contactPhone || result.phones[0] || null;
  const contactEmail = knock.contactEmail || result.emails[0] || null;

  await prisma.knock.update({
    where: { id: knock.id },
    data: {
      ownerData: result as unknown as object,
      ownerSource: result.source,
      ownerLookedUpAt: new Date(),
      contactName,
      contactPhone,
      contactEmail,
    },
  });
  await prisma.knockEvent.create({
    data: { companyId: me.companyId, knockId: knock.id, type: "contact_update", authorId: me.userId, authorName: me.fullName, body: `Owner looked up via ${result.source}` },
  });

  return { ok: true, result, applied: { contactName, contactPhone, contactEmail } };
}

export async function deleteKnockAction(id: string): Promise<{ ok: boolean; error?: string }> {
  const me = await requireUser();
  if (!can(me, "update", "Canvassing")) return { ok: false, error: "No access." };
  const knock = await prisma.knock.findFirst({ where: { id, companyId: me.companyId }, select: { repId: true } });
  if (!knock) return { ok: false, error: "Knock not found." };
  if (knock.repId && knock.repId !== me.userId && !canManageAllCanvassing(me.role)) {
    return { ok: false, error: "You can only delete your own knocks." };
  }
  await prisma.knock.delete({ where: { id } });
  return { ok: true };
}

const convertSchema = z.object({
  id: z.string().min(1),
  firstName: z.string().max(80).optional(),
  lastName: z.string().max(80).optional(),
  phone: z.string().max(30).optional(),
});

export async function convertKnockToLeadAction(
  input: z.infer<typeof convertSchema>
): Promise<{ ok: true; leadId: string } | { ok: false; error: string }> {
  const me = await requireUser();
  if (!can(me, "update", "Canvassing")) return fail("No access.");
  const parsed = convertSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid request.");

  const knock = await prisma.knock.findFirst({
    where: { id: parsed.data.id, companyId: me.companyId },
  });
  if (!knock) return fail("Knock not found.");
  if (knock.repId !== me.userId && !canManageAllCanvassing(me.role)) {
    return fail("You can only convert your own knocks.");
  }
  if (knock.leadId) return { ok: true, leadId: knock.leadId };

  const source = await prisma.leadSource.upsert({
    where: {
      companyId_vertical_name: {
        companyId: me.companyId,
        vertical: await getActiveVertical(me),
        name: "Door Knock",
      },
    },
    update: {},
    create: { companyId: me.companyId, name: "Door Knock" },
  });

  const pipeline = await prisma.pipeline.findFirst({
    where: { companyId: me.companyId },
    orderBy: { isDefault: "desc" },
    include: { stages: { orderBy: { position: "asc" }, take: 1 } },
  });

  // Carry the full estimate (value + range + last sale) through to the lead.
  // Prefer the snapshot already on the knock; otherwise resolve it now.
  let propertyValue = knock.propertyValue;
  let propertyValueSource = knock.propertyValueSource;
  let propertyData: object | null = (knock.propertyData as object | null) ?? null;
  if (propertyData == null) {
    const resolved = await resolvePropertyValue({
      address: knock.address,
      city: knock.city,
      state: knock.state,
      zip: knock.zip,
      lat: knock.lat,
      lng: knock.lng,
    });
    if (resolved) {
      propertyValue = resolved.matched ? resolved.value : null;
      propertyValueSource = resolved.source;
      propertyData = resolved as unknown as object;
    }
  }

  // Prefill from captured homeowner contact when the dialog didn't supply names.
  const contactParts = (knock.contactName ?? "").trim().split(/\s+/).filter(Boolean);
  // The lead is owned by the knocker's sales rep (canvasser → rep funnel).
  const ownerRepId = await resolveOwningRepId(me.companyId, knock.repId ?? me.userId);
  const lead = await prisma.lead.create({
    data: {
      companyId: me.companyId,
      firstName: parsed.data.firstName?.trim() || contactParts[0] || "New",
      lastName:
        parsed.data.lastName?.trim() ||
        contactParts.slice(1).join(" ") ||
        (knock.address ? `Knock — ${knock.address}` : "Door Knock"),
      phone: parsed.data.phone?.trim() || knock.contactPhone || null,
      email: knock.contactEmail || null,
      address: knock.address,
      city: knock.city,
      state: knock.state,
      zip: knock.zip,
      // Inherit the knock's map coordinates so the deal plots on the canvassing
      // map immediately — even when there's no geocodable street address.
      lat: knock.lat,
      lng: knock.lng,
      geocodedAt: new Date(),
      pipelineId: pipeline?.id ?? null,
      stageId: pipeline?.stages[0]?.id ?? null,
      sourceId: source.id,
      assignedRepId: ownerRepId,
      createdById: me.userId,
      propertyValue,
      propertyValueSource,
      ...(propertyData ? { propertyData } : {}),
      notes: knock.notes ? `From canvassing: ${knock.notes}` : "Created from door-knock.",
    },
    select: { id: true },
  });

  await recordStageEntry({ leadId: lead.id, stageId: pipeline?.stages[0]?.id ?? null, movedById: me.userId });

  await prisma.knock.update({ where: { id: knock.id }, data: { leadId: lead.id } });
  await prisma.knockEvent.create({
    data: { companyId: me.companyId, knockId: knock.id, type: "lead_created", authorId: me.userId, authorName: me.fullName },
  });
  return { ok: true, leadId: lead.id };
}

const ensureHouseSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address: z.string().max(200).optional().nullable(),
});

/**
 * Persist an auto-loaded house dot the first time someone acts on it. Dedupes
 * by coordinate so a house is never double-created. Houses always come from the
 * address dataset (never arbitrary taps), so this isn't an "orphan" pin.
 */
export async function ensureHouseKnockAction(
  input: z.infer<typeof ensureHouseSchema>
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const me = await requireUser();
  if (!can(me, "create", "Canvassing")) return fail("No access.");
  const parsed = ensureHouseSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid house.");
  const { lat, lng, address } = parsed.data;

  // Dedupe: a pin at (roughly) these coords already exists?
  const key = coordKey(lat, lng);
  const nearby = await prisma.knock.findMany({
    where: { companyId: me.companyId, lat: { gte: lat - 0.0001, lte: lat + 0.0001 }, lng: { gte: lng - 0.0001, lte: lng + 0.0001 } },
    select: { id: true, lat: true, lng: true },
  });
  const hit = nearby.find((k) => coordKey(k.lat, k.lng) === key);
  if (hit) return { ok: true, id: hit.id };

  const territoryId = await detectTerritory(me.companyId, lat, lng);
  // Reps claim the house they act on so it stays in their row scope; managers
  // (who see all knocks) can leave it unassigned until dispatched.
  const repId = canManageAllCanvassing(me.role) ? null : me.userId;
  const knock = await prisma.knock.create({
    data: {
      companyId: me.companyId,
      repId,
      territoryId,
      lat,
      lng,
      address: address ?? null,
      disposition: "not_knocked",
    },
    select: { id: true },
  });
  return { ok: true, id: knock.id };
}

const apptSchema = z.object({
  knockId: z.string().min(1),
  appointmentAt: z.string().min(1), // ISO datetime
  repId: z.string().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

/**
 * Convert a house dot to an appointment: sets status=appointment, stores the
 * appointment datetime + assigned rep, and creates a Task (calendar entry) for
 * the rep to show up. Records it on the house timeline.
 */
export async function convertKnockToAppointmentAction(
  input: z.infer<typeof apptSchema>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requireUser();
  if (!can(me, "update", "Canvassing")) return fail("No access.");
  const parsed = apptSchema.safeParse(input);
  if (!parsed.success) return fail("Pick an appointment date and time.");

  const knock = await prisma.knock.findFirst({ where: { id: parsed.data.knockId, companyId: me.companyId } });
  if (!knock) return fail("Knock not found.");
  if (knock.repId && knock.repId !== me.userId && !canManageAllCanvassing(me.role)) {
    return fail("You can only act on your own knocks.");
  }

  const when = new Date(parsed.data.appointmentAt);
  if (Number.isNaN(when.getTime())) return fail("Invalid date/time.");
  // The knock stays owned by whoever knocked; the resulting appointment/deal funnels
  // to that person's sales rep (canvasser → rep), who acts on it.
  const repId = parsed.data.repId || knock.repId || me.userId;
  const ownerRepId = await resolveOwningRepId(me.companyId, repId);

  await prisma.knock.update({
    where: { id: knock.id },
    data: { disposition: "appointment", appointmentAt: when, repId },
  });

  // Keep the linked deal in sync: setting a canvassing appointment gives the lead
  // an appointment date (→ "Appointment Set") and assigns it to the owning rep.
  if (knock.leadId) {
    const lead = await prisma.lead.findFirst({
      where: { id: knock.leadId, companyId: me.companyId },
      select: {
        id: true, pipelineId: true, stageId: true,
        vertical: true, appointmentAt: true, appointmentDisposition: true,
      },
    });
    if (lead) {
      const stageId = await resolveStageForAppointment({
        pipelineId: lead.pipelineId,
        candidateStageId: lead.stageId,
        hasAppointment: true,
      });
      // Booking again from the map on a deal that already had a time moves it.
      const move = await planLeadAppointmentMove(me.companyId, lead, when);
      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          appointmentAt: when,
          assignedRepId: ownerRepId,
          stageId,
          ...(stageId !== lead.stageId ? { stageChangedAt: new Date() } : {}),
          ...appointmentMovePatch(move),
        },
      });
      if (stageId !== lead.stageId) await recordStageEntry({ leadId: lead.id, stageId, movedById: me.userId });
      await recordAppointmentReschedule(lead.id, move, me.userId);
    }
  }

  // Create the calendar/task entry for the owning rep.
  const task = await prisma.task.create({
    data: {
      companyId: me.companyId,
      title: `Appointment: ${knock.address ?? "house"}`,
      priority: "high",
      dueAt: when,
      assigneeId: ownerRepId,
      createdById: me.userId,
      leadId: knock.leadId ?? null,
    },
    select: { id: true, assigneeId: true },
  });

  await prisma.knockEvent.create({
    data: {
      companyId: me.companyId,
      knockId: knock.id,
      type: "status_change",
      disposition: "appointment",
      body: `Appointment set for ${when.toLocaleString("en-US")}${parsed.data.notes ? ` — ${parsed.data.notes}` : ""}`,
      authorId: me.userId,
      authorName: me.fullName,
    },
  });

  if (task.assigneeId && task.assigneeId !== me.userId) {
    await fireEvent({ companyId: me.companyId, event: "task_assigned", actorId: me.userId, taskId: task.id });
  }
  return { ok: true };
}

// --- Territories (manager/admin only) ------------------------------------

const territorySchema = z.object({
  name: z.string().min(1, "Name is required").max(80),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#F4631E"),
  polygon: z.array(z.tuple([z.number(), z.number()])).min(3, "Draw at least 3 points"),
  assignedRepId: z.string().optional().nullable(),
});

export async function createTerritoryAction(
  input: z.infer<typeof territorySchema>
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const me = await requireUser();
  if (!canManageAllCanvassing(me.role)) return fail("Only managers can create territories.");
  const parsed = territorySchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid territory.");

  let assignedRepId: string | null = null;
  if (parsed.data.assignedRepId) {
    const rep = await prisma.user.findFirst({
      where: { id: parsed.data.assignedRepId, companyId: me.companyId, status: "active" },
      select: { id: true },
    });
    assignedRepId = rep?.id ?? null;
  }

  const territory = await prisma.territory.create({
    data: {
      companyId: me.companyId,
      name: parsed.data.name.trim(),
      color: parsed.data.color,
      polygon: parsed.data.polygon,
      assignedRepId,
      createdById: me.userId,
    },
    select: { id: true },
  });
  // Mirror the primary rep into the multi-rep join.
  if (assignedRepId) {
    await prisma.territoryRep.create({ data: { territoryId: territory.id, userId: assignedRepId } });
  }
  return { ok: true, id: territory.id };
}

const setRepsSchema = z.object({ territoryId: z.string().min(1), repIds: z.array(z.string()).default([]) });

/** Set the full list of reps assigned to a territory (multi-rep). First = primary. */
export async function setTerritoryRepsAction(
  input: z.infer<typeof setRepsSchema>
): Promise<{ ok: boolean; error?: string }> {
  const me = await requireUser();
  if (!canManageAllCanvassing(me.role)) return fail("Only managers can assign reps.");
  const parsed = setRepsSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid input.");

  const territory = await prisma.territory.findFirst({
    where: { id: parsed.data.territoryId, companyId: me.companyId },
    select: { id: true },
  });
  if (!territory) return fail("Territory not found.");

  // Validate reps are active staff in this company.
  const ids = [...new Set(parsed.data.repIds)];
  const valid = ids.length
    ? await prisma.user.findMany({
        where: { id: { in: ids }, companyId: me.companyId, status: "active", role: { in: ["sales_rep", "manager"] } },
        select: { id: true },
      })
    : [];
  const validIds = valid.map((u) => u.id);

  await prisma.$transaction([
    prisma.territoryRep.deleteMany({ where: { territoryId: territory.id } }),
    ...(validIds.length
      ? [prisma.territoryRep.createMany({ data: validIds.map((userId) => ({ territoryId: territory.id, userId })) })]
      : []),
    prisma.territory.update({ where: { id: territory.id }, data: { assignedRepId: validIds[0] ?? null } }),
  ]);
  return { ok: true };
}

const assignKnockRepSchema = z.object({ knockId: z.string().min(1), repId: z.string().optional().nullable() });

/** Reassign a single house/pin to a rep (managers only). */
export async function assignKnockRepAction(
  input: z.infer<typeof assignKnockRepSchema>
): Promise<{ ok: boolean; error?: string }> {
  const me = await requireUser();
  if (!canManageAllCanvassing(me.role)) return fail("Only managers can reassign pins.");
  const parsed = assignKnockRepSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid input.");
  const knock = await prisma.knock.findFirst({ where: { id: parsed.data.knockId, companyId: me.companyId }, select: { id: true } });
  if (!knock) return fail("Knock not found.");
  let repId: string | null = null;
  if (parsed.data.repId) {
    const rep = await prisma.user.findFirst({ where: { id: parsed.data.repId, companyId: me.companyId, status: "active" }, select: { id: true } });
    repId = rep?.id ?? null;
  }
  await prisma.knock.update({ where: { id: knock.id }, data: { repId } });
  return { ok: true };
}

const updateTerritorySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  assignedRepId: z.string().optional().nullable(),
});

export async function updateTerritoryAction(
  input: z.infer<typeof updateTerritorySchema>
): Promise<{ ok: boolean; error?: string }> {
  const me = await requireUser();
  if (!canManageAllCanvassing(me.role)) return { ok: false, error: "Only managers can edit territories." };
  const parsed = updateTerritorySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid update." };

  const territory = await prisma.territory.findFirst({
    where: { id: parsed.data.id, companyId: me.companyId },
    select: { id: true },
  });
  if (!territory) return { ok: false, error: "Territory not found." };

  await prisma.territory.update({
    where: { id: parsed.data.id },
    data: {
      ...(parsed.data.name ? { name: parsed.data.name.trim() } : {}),
      ...(parsed.data.color ? { color: parsed.data.color } : {}),
      ...(parsed.data.assignedRepId !== undefined ? { assignedRepId: parsed.data.assignedRepId || null } : {}),
    },
  });
  return { ok: true };
}

export async function deleteTerritoryAction(id: string): Promise<{ ok: boolean; error?: string }> {
  const me = await requireUser();
  if (!canManageAllCanvassing(me.role)) return { ok: false, error: "Only managers can delete territories." };
  const territory = await prisma.territory.findFirst({ where: { id, companyId: me.companyId }, select: { id: true } });
  if (!territory) return { ok: false, error: "Territory not found." };
  await prisma.territory.delete({ where: { id } });
  return { ok: true };
}

/**
 * Auto-populate a territory with one "Not knocked" pin per residential address
 * inside its polygon (sourced from OpenStreetMap). Dedupes against pins that
 * already exist in the company so overlapping territories don't double-stack.
 */
export async function generateTerritoryPinsAction(
  territoryId: string
): Promise<{ ok: true; created: number; found: number; message: string } | { ok: false; error: string }> {
  const me = await requireUser();
  if (!canManageAllCanvassing(me.role)) return fail("Only managers can generate territory pins.");

  const territory = await prisma.territory.findFirst({
    where: { id: territoryId, companyId: me.companyId },
    select: { id: true, polygon: true },
  });
  if (!territory) return fail("Territory not found.");
  const polygon = (territory.polygon as LatLng[]) ?? [];
  if (polygon.length < 3) return fail("Territory has no polygon.");

  const addresses = await fetchAddressesInPolygon(polygon);
  if (addresses.length === 0) {
    return {
      ok: true,
      created: 0,
      found: 0,
      message: "No address data found for this area. Reps can drop pins manually instead.",
    };
  }

  // Dedupe against existing pins anywhere in the company (one pin per address).
  const existing = await prisma.knock.findMany({ where: { companyId: me.companyId }, select: { lat: true, lng: true } });
  const seen = new Set(existing.map((e) => coordKey(e.lat, e.lng)));

  const toCreate = addresses
    .filter((a) => !seen.has(coordKey(a.lat, a.lng)))
    .map((a) => ({
      companyId: me.companyId,
      repId: null,
      territoryId: territory.id,
      lat: a.lat,
      lng: a.lng,
      address: a.address,
      disposition: "not_knocked" as KnockDisposition,
    }));

  if (toCreate.length > 0) {
    await prisma.knock.createMany({ data: toCreate });
  }

  return {
    ok: true,
    created: toCreate.length,
    found: addresses.length,
    message:
      toCreate.length === 0
        ? `Found ${addresses.length} addresses — all already have pins.`
        : `Added ${toCreate.length} houses to knock (${addresses.length} found).`,
  };
}

// --- Appointment reschedule / cancel (calendar) --------------------------

const rescheduleSchema = z.object({ knockId: z.string().min(1), appointmentAt: z.string().min(1) });

export async function rescheduleAppointmentAction(
  input: z.infer<typeof rescheduleSchema>
): Promise<{ ok: boolean; error?: string }> {
  const me = await requireUser();
  if (!can(me, "update", "Canvassing")) return fail("No access.");
  const parsed = rescheduleSchema.safeParse(input);
  if (!parsed.success) return fail("Pick a new date and time.");
  const knock = await prisma.knock.findFirst({
    where: { id: parsed.data.knockId, companyId: me.companyId },
    select: { id: true, repId: true, leadId: true, appointmentAt: true },
  });
  if (!knock) return fail("Appointment not found.");
  if (knock.repId && knock.repId !== me.userId && !canManageAllCanvassing(me.role)) {
    return fail("You can only manage your own appointments.");
  }
  const when = new Date(parsed.data.appointmentAt);
  if (Number.isNaN(when.getTime())) return fail("Invalid date/time.");
  const prev = knock.appointmentAt;
  await prisma.knock.update({ where: { id: knock.id }, data: { appointmentAt: when } });
  // Keep the linked calendar Task in sync (best-effort).
  if (knock.leadId && prev) {
    await prisma.task.updateMany({
      where: { companyId: me.companyId, leadId: knock.leadId, title: { startsWith: "Appointment" }, dueAt: prev },
      data: { dueAt: when },
    });
  }
  // Solar: the deal carries the time the Appointments list and the deal page
  // read. Moving only the knock left both showing the old time and the
  // reschedule uncounted. Only a deal that already HAS a time is moved, so no
  // stage needs re-deriving. Roofing keeps the knock-only behaviour it had.
  if (knock.leadId) {
    const lead = await prisma.lead.findFirst({
      where: { id: knock.leadId, companyId: me.companyId },
      select: { id: true, vertical: true, appointmentAt: true, appointmentDisposition: true },
    });
    if (lead?.appointmentAt && tracksReschedules(lead.vertical)) {
      const move = await planLeadAppointmentMove(me.companyId, lead, when);
      await prisma.lead.update({
        where: { id: lead.id },
        data: { appointmentAt: when, ...appointmentMovePatch(move) },
      });
      await recordAppointmentReschedule(lead.id, move, me.userId);
    }
  }
  await prisma.knockEvent.create({
    data: {
      companyId: me.companyId, knockId: knock.id, type: "status_change", disposition: "appointment",
      body: `Appointment rescheduled to ${when.toLocaleString("en-US")}`, authorId: me.userId, authorName: me.fullName,
    },
  });
  return { ok: true };
}

export async function cancelAppointmentAction(knockId: string): Promise<{ ok: boolean; error?: string }> {
  const me = await requireUser();
  if (!can(me, "update", "Canvassing")) return fail("No access.");
  const knock = await prisma.knock.findFirst({
    where: { id: knockId, companyId: me.companyId },
    select: { id: true, repId: true, leadId: true, appointmentAt: true },
  });
  if (!knock) return fail("Appointment not found.");
  if (knock.repId && knock.repId !== me.userId && !canManageAllCanvassing(me.role)) {
    return fail("You can only manage your own appointments.");
  }
  await prisma.knock.update({ where: { id: knock.id }, data: { appointmentAt: null, disposition: "callback" } });
  if (knock.leadId && knock.appointmentAt) {
    await prisma.task.updateMany({
      where: { companyId: me.companyId, leadId: knock.leadId, title: { startsWith: "Appointment" }, dueAt: knock.appointmentAt },
      data: { status: "cancelled" },
    });
  }
  await prisma.knockEvent.create({
    data: {
      companyId: me.companyId, knockId: knock.id, type: "status_change", disposition: "callback",
      body: "Appointment cancelled", authorId: me.userId, authorName: me.fullName,
    },
  });
  return { ok: true };
}
