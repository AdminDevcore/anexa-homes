"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { getStormConfig } from "./config";
import { importNoaaCsv } from "./import-noaa";
import { importSpcCsv, type SpcKind } from "./import-spc";
import { recomputeStormMatches } from "./matches";
import { haversineMiles, boundingBox, circlePolygon } from "./geo";
import { geocode } from "@/server/modules/geo/geocode";
import { generateTerritoryPinsAction } from "@/server/modules/canvassing/actions";

function fail(error: string) {
  return { ok: false as const, error };
}

const coverageSchema = z.object({
  address: z.string().trim().max(200).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  radiusMiles: z.number().int().min(5).max(300),
});

/** Set the company's storm search area (center + radius). Accepts a center address
 *  to geocode, or explicit lat/lng. Drives the daily SPC import + map/checker. */
export async function setStormCoverageAction(input: z.infer<typeof coverageSchema>) {
  const user = await requireUser();
  if (!can(user, "update", "StormIntelligence")) return fail("Not allowed.");
  const parsed = coverageSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid coverage.");
  const d = parsed.data;

  let lat = d.lat ?? null;
  let lng = d.lng ?? null;
  let resolvedAddress: string | null = null;
  if ((lat == null || lng == null) && d.address) {
    const g = await geocode(d.address);
    if (!g) return fail("Couldn't find that location — try a more specific address or city.");
    lat = g.lat;
    lng = g.lng;
    resolvedAddress = g.displayName;
  }
  if (lat == null || lng == null) return fail("Enter a center address or coordinates.");

  await prisma.companySettings.upsert({
    where: { companyId: user.companyId },
    update: { stormCenterLat: lat, stormCenterLng: lng, stormRadiusMiles: d.radiusMiles },
    create: { companyId: user.companyId, stormCenterLat: lat, stormCenterLng: lng, stormRadiusMiles: d.radiusMiles },
  });
  revalidatePath("/portal/settings/storm-coverage");
  revalidatePath("/portal/canvassing");
  return { ok: true as const, lat, lng, radiusMiles: d.radiusMiles, resolvedAddress };
}

const SPC_KINDS: SpcKind[] = ["hail", "wind", "torn"];

/**
 * Import a storm-data CSV uploaded by an admin. `source` = "noaa" (Storm Events
 * details file) or "spc" (one daily report kind, with spcKind + reportDate).
 * Triggers a match recompute so scores reflect the new data immediately.
 */
export async function importStormCsvAction(formData: FormData) {
  const user = await requireUser();
  if (!can(user, "manage", "StormIntelligence")) return fail("You can't import storm data.");

  const file = formData.get("file");
  if (!(file instanceof File)) return fail("No file uploaded.");
  const text = await file.text();
  if (!text.trim()) return fail("That file is empty.");

  const source = String(formData.get("source") || "");
  const cfg = await getStormConfig(user.companyId);

  try {
    if (source === "noaa") {
      const result = await importNoaaCsv(user.companyId, text, cfg.center, cfg.radiusMiles);
      await recomputeStormMatches(user.companyId);
      return { ok: true as const, results: [result] };
    }
    if (source === "spc") {
      const kind = String(formData.get("spcKind") || "") as SpcKind;
      if (!SPC_KINDS.includes(kind)) return fail("Pick an SPC report type (hail, wind, or tornado).");
      const dateStr = String(formData.get("reportDate") || "");
      const reportDate = dateStr ? new Date(`${dateStr}T00:00:00Z`) : new Date();
      if (Number.isNaN(reportDate.getTime())) return fail("Invalid report date.");
      const result = await importSpcCsv(user.companyId, kind, text, reportDate, cfg.center, cfg.radiusMiles);
      await recomputeStormMatches(user.companyId);
      return { ok: true as const, results: [result] };
    }
    return fail("Unknown import source.");
  } catch (e) {
    console.error("[storm:import] failed", e);
    return fail("Import failed — check the CSV format and try again.");
  }
}

const zoneSchema = z.object({
  name: z.string().min(1).max(120),
  centerLat: z.number().min(-90).max(90),
  centerLng: z.number().min(-180).max(180),
  radiusMiles: z.number().min(0.25).max(50),
  assignedRepId: z.string().uuid().optional().nullable(),
  generatePins: z.boolean().optional(),
  filtersSnapshot: z.record(z.string(), z.unknown()).optional().nullable(),
});

/**
 * Create a Storm Canvassing Zone from a storm area, and spawn a real canvassing
 * Territory (circle→polygon) assigned to the rep — so it flows straight into the
 * existing canvassing map/workflow. Optionally auto-generates house pins.
 */
export async function createStormZoneAction(input: z.infer<typeof zoneSchema>) {
  const me = await requireUser();
  if (!can(me, "manage", "StormIntelligence")) return fail("Only managers can create zones.");
  const parsed = zoneSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid zone.");
  const { name, centerLat, centerLng, radiusMiles, generatePins } = parsed.data;
  const center = { lat: centerLat, lng: centerLng };

  // Validate the rep belongs to this company.
  let assignedRepId: string | null = null;
  if (parsed.data.assignedRepId) {
    const rep = await prisma.user.findFirst({
      where: { id: parsed.data.assignedRepId, companyId: me.companyId, status: "active" },
      select: { id: true },
    });
    assignedRepId = rep?.id ?? null;
  }

  // Aggregate storm severity inside the zone (events + summed match scores).
  const box = boundingBox(center, radiusMiles);
  const boxWhere = {
    companyId: me.companyId,
    lat: { gte: box.minLat, lte: box.maxLat },
    lng: { gte: box.minLng, lte: box.maxLng },
  };
  const [events, matches] = await Promise.all([
    prisma.stormEvent.findMany({ where: boxWhere, select: { lat: true, lng: true } }),
    prisma.propertyStormMatch.findMany({ where: boxWhere, select: { lat: true, lng: true, score: true } }),
  ]);
  const eventCount = events.filter((e) => haversineMiles(center, e) <= radiusMiles).length;
  const totalScore = matches
    .filter((m) => haversineMiles(center, m) <= radiusMiles)
    .reduce((n, m) => n + m.score, 0);

  // Spawn the canvassing Territory (circle approximated as a polygon ring).
  const polygon = circlePolygon(center, radiusMiles);
  const territory = await prisma.territory.create({
    data: {
      companyId: me.companyId,
      name: name.trim(),
      color: "#F4631E",
      polygon,
      assignedRepId,
      createdById: me.userId,
    },
    select: { id: true },
  });
  if (assignedRepId) {
    await prisma.territoryRep.create({ data: { territoryId: territory.id, userId: assignedRepId } });
  }

  const zone = await prisma.stormCanvassingZone.create({
    data: {
      companyId: me.companyId,
      name: name.trim(),
      centerLat,
      centerLng,
      radiusMiles,
      filtersSnapshot: (parsed.data.filtersSnapshot ?? undefined) as object | undefined,
      eventCount,
      totalScore,
      assignedRepId,
      territoryId: territory.id,
      createdById: me.userId,
    },
    select: { id: true, territoryId: true },
  });

  if (generatePins) {
    // Best-effort: populate house pins from OSM. Don't fail zone creation if it errors.
    try {
      await generateTerritoryPinsAction(territory.id);
    } catch (e) {
      console.error("[storm:zone] pin generation failed", e);
    }
  }

  return { ok: true as const, id: zone.id, territoryId: zone.territoryId, eventCount, totalScore };
}

const assignSchema = z.object({
  zoneId: z.string().uuid(),
  assignedRepId: z.string().uuid().nullable(),
});

/** Reassign a storm zone (and its spawned territory) to a rep. */
export async function assignStormZoneAction(input: z.infer<typeof assignSchema>) {
  const me = await requireUser();
  if (!can(me, "manage", "StormIntelligence")) return fail("Only managers can assign zones.");
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid assignment.");

  const zone = await prisma.stormCanvassingZone.findFirst({
    where: { id: parsed.data.zoneId, companyId: me.companyId },
    select: { id: true, territoryId: true },
  });
  if (!zone) return fail("Zone not found.");

  let repId: string | null = null;
  if (parsed.data.assignedRepId) {
    const rep = await prisma.user.findFirst({
      where: { id: parsed.data.assignedRepId, companyId: me.companyId, status: "active" },
      select: { id: true },
    });
    if (!rep) return fail("Rep not found.");
    repId = rep.id;
  }

  await prisma.stormCanvassingZone.update({ where: { id: zone.id }, data: { assignedRepId: repId } });
  if (zone.territoryId) {
    await prisma.territory.update({ where: { id: zone.territoryId }, data: { assignedRepId: repId } });
    await prisma.territoryRep.deleteMany({ where: { territoryId: zone.territoryId } });
    if (repId) await prisma.territoryRep.create({ data: { territoryId: zone.territoryId, userId: repId } });
  }
  return { ok: true as const };
}

