import { Prisma, type StormType } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { geocode } from "@/server/modules/geo/geocode";
import {
  haversineMiles,
  boundingBox,
  pointInPolygonRings,
  DALLAS,
  DEFAULT_RADIUS_MILES,
  type LatLng,
} from "./geo";
import { scoreProperty, CLUSTER_RADIUS_MI } from "./scoring";
import { distanceConfidence, sourceLabel, type Confidence } from "./confidence";
import { getStormConfig } from "./config";

const EVENT_CAP = 2000;

export type StormEventDTO = {
  id: string;
  type: StormType;
  eventAt: string;
  lat: number;
  lng: number;
  hailSizeIn: number | null;
  windSpeedMph: number | null;
  tornadoScale: string | null;
  city: string | null;
  county: string | null;
  state: string | null;
  narrative: string | null;
  distanceMiles: number;
};

export type StormEventFilters = {
  types?: StormType[];
  from?: Date;
  to?: Date;
  minHailIn?: number;
  minWindMph?: number;
  county?: string;
  city?: string;
  zip?: string;
  center?: LatLng;
  radiusMiles?: number;
};

/** Filtered storm events within radius of the center (bounding-box prefilter in
 *  SQL, exact Haversine in app), ordered most-recent first, capped. */
export async function getStormEvents(
  companyId: string,
  filters: StormEventFilters,
): Promise<StormEventDTO[]> {
  const center = filters.center ?? DALLAS;
  const radius = filters.radiusMiles ?? DEFAULT_RADIUS_MILES;
  const box = boundingBox(center, radius);

  const where: Prisma.StormEventWhereInput = {
    companyId,
    lat: { gte: box.minLat, lte: box.maxLat },
    lng: { gte: box.minLng, lte: box.maxLng },
  };
  if (filters.types?.length) where.type = { in: filters.types };
  if (filters.from || filters.to) {
    where.eventAt = {};
    if (filters.from) where.eventAt.gte = filters.from;
    if (filters.to) where.eventAt.lte = filters.to;
  }
  if (filters.minHailIn != null) where.hailSizeIn = { gte: filters.minHailIn };
  if (filters.minWindMph != null) where.windSpeedMph = { gte: filters.minWindMph };
  if (filters.county) where.county = { contains: filters.county, mode: "insensitive" };
  if (filters.city) where.city = { contains: filters.city, mode: "insensitive" };
  if (filters.zip) where.zip = filters.zip;

  const events = await prisma.stormEvent.findMany({
    where,
    orderBy: { eventAt: "desc" },
    take: EVENT_CAP * 2, // over-fetch; the circle filter trims the box corners
  });

  return events
    .map((e) => ({ e, d: haversineMiles(center, { lat: e.lat, lng: e.lng }) }))
    .filter(({ d }) => d <= radius)
    .slice(0, EVENT_CAP)
    .map(({ e, d }) => ({
      id: e.id,
      type: e.type,
      eventAt: e.eventAt.toISOString(),
      lat: e.lat,
      lng: e.lng,
      hailSizeIn: e.hailSizeIn,
      windSpeedMph: e.windSpeedMph,
      tornadoScale: e.tornadoScale,
      city: e.city,
      county: e.county,
      state: e.state,
      narrative: e.narrative,
      distanceMiles: Number(d.toFixed(1)),
    }));
}

export type StormMatchDTO = {
  id: string;
  subjectType: "lead" | "knock";
  leadId: string | null;
  knockId: string | null;
  name: string;
  address: string;
  lat: number;
  lng: number;
  score: number;
  distanceMiles: number;
  dateOfLoss: string | null;
  eventCount: number;
  maxHailIn: number | null;
  maxWindMph: number | null;
};

export type StormMatchFilters = { minScore?: number; subjectType?: "lead" | "knock" };

/** Scored property matches (leads + knocks), highest score first. */
export async function getStormMatches(
  companyId: string,
  filters: StormMatchFilters = {},
  limit = 500,
): Promise<StormMatchDTO[]> {
  const where: Prisma.PropertyStormMatchWhereInput = { companyId };
  if (filters.minScore != null) where.score = { gte: filters.minScore };
  if (filters.subjectType === "lead") where.leadId = { not: null };
  if (filters.subjectType === "knock") where.knockId = { not: null };

  const matches = await prisma.propertyStormMatch.findMany({
    where,
    orderBy: [{ score: "desc" }, { dateOfLoss: "desc" }],
    take: limit,
  });

  const leadIds = matches.map((m) => m.leadId).filter((x): x is string => !!x);
  const knockIds = matches.map((m) => m.knockId).filter((x): x is string => !!x);
  const [leads, knocks] = await Promise.all([
    leadIds.length
      ? prisma.lead.findMany({
          where: { id: { in: leadIds } },
          select: { id: true, firstName: true, lastName: true, address: true, city: true, state: true, zip: true },
        })
      : Promise.resolve([]),
    knockIds.length
      ? prisma.knock.findMany({
          where: { id: { in: knockIds } },
          select: { id: true, address: true, city: true, state: true, zip: true, contactName: true },
        })
      : Promise.resolve([]),
  ]);
  const leadMap = new Map(leads.map((l) => [l.id, l]));
  const knockMap = new Map(knocks.map((k) => [k.id, k]));

  const fmtAddr = (a?: string | null, c?: string | null, s?: string | null, z?: string | null) =>
    [a, [c, s].filter(Boolean).join(", "), z].filter(Boolean).join(" ").trim() || "—";

  return matches.map((m) => {
    if (m.leadId && leadMap.has(m.leadId)) {
      const l = leadMap.get(m.leadId)!;
      return {
        id: m.id,
        subjectType: "lead" as const,
        leadId: m.leadId,
        knockId: null,
        name: `${l.firstName} ${l.lastName}`.trim() || "Lead",
        address: fmtAddr(l.address, l.city, l.state, l.zip),
        lat: m.lat,
        lng: m.lng,
        score: m.score,
        distanceMiles: m.distanceMiles,
        dateOfLoss: m.dateOfLoss?.toISOString() ?? null,
        eventCount: m.eventCount,
        maxHailIn: m.maxHailIn,
        maxWindMph: m.maxWindMph,
      };
    }
    const k = m.knockId ? knockMap.get(m.knockId) : undefined;
    return {
      id: m.id,
      subjectType: "knock" as const,
      leadId: null,
      knockId: m.knockId,
      name: k?.contactName || "Door knock",
      address: fmtAddr(k?.address, k?.city, k?.state, k?.zip),
      lat: m.lat,
      lng: m.lng,
      score: m.score,
      distanceMiles: m.distanceMiles,
      dateOfLoss: m.dateOfLoss?.toISOString() ?? null,
      eventCount: m.eventCount,
      maxHailIn: m.maxHailIn,
      maxWindMph: m.maxWindMph,
    };
  });
}

export type StormReportHit = {
  id: string;
  source: string;
  sourceLabel: string;
  verified: boolean; // NOAA Storm Events = NWS-reviewed
  type: StormType;
  eventAt: string;
  distanceMiles: number;
  hailSizeIn: number | null;
  windSpeedMph: number | null;
  tornadoScale: string | null;
  lat: number;
  lng: number;
  confidence: Confidence | null;
  raw: unknown; // original source row (debug panel), when captured
};

export type AddressCheckResult = {
  query: string;
  matched: boolean; // address geocoded
  center: { lat: number; lng: number; label: string } | null;
  radiusMiles: number; // selected search radius
  rings: { miles: number; count: number }[]; // counts across 1/3/5/10
  hasReport: boolean; // any report (or radar) within the selected radius
  confidence: Confidence | null;
  dateOfLoss: string | null;
  hailSizeIn: number | null;
  maxWindMph: number | null;
  swathHailIn: number | null; // radar MESH at the exact address (highest confidence)
  primary: StormReportHit | null; // chosen date-of-loss report
  events: StormReportHit[]; // all reports within the selected radius (sorted)
  score: number;
};

const RING_MILES = [1, 3, 5, 10];

/**
 * Geocode an address and summarize nearby storms by distance (Haversine): radar
 * hail at the exact point, reports within the selected radius (1/3/5/10mi),
 * confidence level, and a clear "no report" signal. Date-of-loss prioritizes the
 * most recent nearby report (SPC for recent, NOAA for older).
 */
export async function addressCheck(
  companyId: string,
  query: string,
  radiusMiles = 10,
): Promise<AddressCheckResult> {
  const empty: AddressCheckResult = {
    query,
    matched: false,
    center: null,
    radiusMiles,
    rings: RING_MILES.map((m) => ({ miles: m, count: 0 })),
    hasReport: false,
    confidence: null,
    dateOfLoss: null,
    hailSizeIn: null,
    maxWindMph: null,
    swathHailIn: null,
    primary: null,
    events: [],
    score: 0,
  };
  const geo = await geocode(query);
  if (!geo) return empty;
  const center = { lat: geo.lat, lng: geo.lng };

  // Radar swath at the exact point — most precise per-address hail.
  const swaths = await prisma.stormSwath.findMany({
    where: {
      bboxMinLat: { lte: center.lat },
      bboxMaxLat: { gte: center.lat },
      bboxMinLng: { lte: center.lng },
      bboxMaxLng: { gte: center.lng },
    },
    orderBy: { hailMinIn: "desc" },
    take: 300,
  });
  let swathHailIn: number | null = null;
  for (const s of swaths) {
    if (pointInPolygonRings(center.lat, center.lng, s.rings as [number, number][][])) {
      if (swathHailIn == null || s.hailMinIn > swathHailIn) swathHailIn = s.hailMinIn;
    }
  }

  // Point reports (SPC + NOAA) within 10mi, then filter to the selected radius.
  const box = boundingBox(center, 10);
  const rows = await prisma.stormEvent.findMany({
    where: { companyId, lat: { gte: box.minLat, lte: box.maxLat }, lng: { gte: box.minLng, lte: box.maxLng } },
  });
  const within10 = rows
    .map((e) => ({ e, d: haversineMiles(center, { lat: e.lat, lng: e.lng }) }))
    .filter(({ d }) => d <= 10);

  const rings = RING_MILES.map((miles) => ({ miles, count: within10.filter(({ d }) => d <= miles).length }));

  const toHit = ({ e, d }: { e: (typeof rows)[number]; d: number }): StormReportHit => ({
    id: e.id,
    source: e.source,
    sourceLabel: sourceLabel(e.source),
    verified: e.source === "noaa_storm_events",
    type: e.type,
    eventAt: e.eventAt.toISOString(),
    distanceMiles: Number(d.toFixed(2)),
    hailSizeIn: e.hailSizeIn,
    windSpeedMph: e.windSpeedMph,
    tornadoScale: e.tornadoScale,
    lat: e.lat,
    lng: e.lng,
    confidence: distanceConfidence(d),
    raw: e.raw ?? null,
  });

  const inRadius = within10.filter(({ d }) => d <= radiusMiles);
  const events = inRadius.map(toHit).sort((a, b) => {
    // Date of loss: most recent nearby first; SPC (recent) outranks NOAA at the
    // same time; then closest.
    if (a.eventAt !== b.eventAt) return a.eventAt < b.eventAt ? 1 : -1;
    if (a.source !== b.source) return a.source === "spc_reports" ? -1 : 1;
    return a.distanceMiles - b.distanceMiles;
  });

  const primary = events[0] ?? null;
  const maxHail = inRadius.reduce((m, { e }) => Math.max(m, e.hailSizeIn ?? 0), 0);
  const maxWind = inRadius.reduce((m, { e }) => Math.max(m, e.windSpeedMph ?? 0), 0);
  const reports5 = within10.filter(({ d }) => d <= CLUSTER_RADIUS_MI).length;
  const score = scoreProperty(
    {
      maxHailIn: Math.max(swathHailIn ?? 0, maxHail),
      maxWindMph: maxWind,
      mostRecentEventAt: primary?.eventAt ?? null,
      reportsWithin5mi: reports5,
    },
    new Date(),
  );

  return {
    query,
    matched: true,
    center: { lat: center.lat, lng: center.lng, label: geo.displayName },
    radiusMiles,
    rings,
    hasReport: events.length > 0 || swathHailIn != null,
    confidence: swathHailIn != null ? "High" : primary?.confidence ?? null,
    dateOfLoss: primary?.eventAt ?? null,
    hailSizeIn: swathHailIn ?? primary?.hailSizeIn ?? (maxHail || null),
    maxWindMph: maxWind ? Math.round(maxWind) : primary?.windSpeedMph ?? null,
    swathHailIn,
    primary,
    events,
    score,
  };
}

export type StormZoneDTO = {
  id: string;
  name: string;
  centerLat: number;
  centerLng: number;
  radiusMiles: number;
  eventCount: number;
  totalScore: number;
  assignedRepId: string | null;
  assignedRepName: string | null;
  territoryId: string | null;
  createdAt: string;
};

export async function getStormZones(companyId: string): Promise<StormZoneDTO[]> {
  const zones = await prisma.stormCanvassingZone.findMany({
    where: { companyId },
    orderBy: { createdAt: "desc" },
  });
  const repIds = zones.map((z) => z.assignedRepId).filter((x): x is string => !!x);
  const reps = repIds.length
    ? await prisma.user.findMany({ where: { id: { in: repIds } }, select: { id: true, firstName: true, lastName: true } })
    : [];
  const repMap = new Map(reps.map((r) => [r.id, `${r.firstName} ${r.lastName}`.trim()]));
  return zones.map((z) => ({
    id: z.id,
    name: z.name,
    centerLat: z.centerLat,
    centerLng: z.centerLng,
    radiusMiles: z.radiusMiles,
    eventCount: z.eventCount,
    totalScore: z.totalScore,
    assignedRepId: z.assignedRepId,
    assignedRepName: z.assignedRepId ? repMap.get(z.assignedRepId) ?? null : null,
    territoryId: z.territoryId,
    createdAt: z.createdAt.toISOString(),
  }));
}

/** Convenience: company default search config (Dallas/100mi today). */
export async function defaultStormCenter(companyId: string) {
  return getStormConfig(companyId);
}

export type StormAtPoint = {
  score: number;
  hailSizeIn: number | null; // best estimate (radar swath if available, else max nearby event)
  swathHailIn: number | null; // radar MESH tier the exact point sits inside (most precise)
  dateOfLoss: string | null;
  maxHailIn: number | null;
  maxWindMph: number | null;
  eventCount: number;
  reportsWithin5mi: number;
  zoneName: string | null;
  nearest:
    | { type: StormType; eventAt: string; distanceMiles: number; hailSizeIn: number | null; windSpeedMph: number | null }
    | null;
};

/**
 * Full storm picture for a single coordinate (a house on the canvassing map):
 * the radar swath tier it sits inside (precise hail size), nearby reports, date
 * of loss, score, and which storm zone it falls in.
 */
export async function stormAtPoint(companyId: string, lat: number, lng: number): Promise<StormAtPoint> {
  const pt: LatLng = { lat, lng };

  // 1) Radar swath polygons whose bbox contains the point (universal data).
  const swaths = await prisma.stormSwath.findMany({
    where: {
      bboxMinLat: { lte: lat },
      bboxMaxLat: { gte: lat },
      bboxMinLng: { lte: lng },
      bboxMaxLng: { gte: lng },
    },
    orderBy: { hailMinIn: "desc" },
    take: 300,
  });
  let swathHailIn: number | null = null;
  let swathDate: Date | null = null;
  for (const s of swaths) {
    if (pointInPolygonRings(lat, lng, s.rings as [number, number][][])) {
      if (swathHailIn == null || s.hailMinIn > swathHailIn) {
        swathHailIn = s.hailMinIn;
        swathDate = s.eventDate;
      }
    }
  }

  // 2) Nearby point reports within 10mi (company-scoped).
  const box = boundingBox(pt, 10);
  const events = await prisma.stormEvent.findMany({
    where: { companyId, lat: { gte: box.minLat, lte: box.maxLat }, lng: { gte: box.minLng, lte: box.maxLng } },
    orderBy: { eventAt: "desc" },
  });
  let maxHail = 0;
  let maxWind = 0;
  let reports5 = 0;
  let count = 0;
  let mostRecent: Date | null = null;
  let nearest: StormAtPoint["nearest"] = null;
  let nearestDist = Infinity;
  for (const e of events) {
    const d = haversineMiles(pt, { lat: e.lat, lng: e.lng });
    if (d > 10) continue;
    count++;
    if (d < nearestDist) {
      nearestDist = d;
      nearest = {
        type: e.type,
        eventAt: e.eventAt.toISOString(),
        distanceMiles: Number(d.toFixed(2)),
        hailSizeIn: e.hailSizeIn,
        windSpeedMph: e.windSpeedMph,
      };
    }
    if ((e.hailSizeIn ?? 0) > maxHail) maxHail = e.hailSizeIn ?? 0;
    if ((e.windSpeedMph ?? 0) > maxWind) maxWind = e.windSpeedMph ?? 0;
    if (d <= CLUSTER_RADIUS_MI) reports5++;
    if (!mostRecent || e.eventAt > mostRecent) mostRecent = e.eventAt;
  }

  // 3) Storm zone membership.
  const zones = await prisma.stormCanvassingZone.findMany({
    where: { companyId },
    select: { name: true, centerLat: true, centerLng: true, radiusMiles: true },
  });
  let zoneName: string | null = null;
  for (const z of zones) {
    if (haversineMiles(pt, { lat: z.centerLat, lng: z.centerLng }) <= z.radiusMiles) {
      zoneName = z.name;
      break;
    }
  }

  const bestHail = Math.max(swathHailIn ?? 0, maxHail);
  const dateOfLoss = swathDate ?? mostRecent;
  const score = scoreProperty({
    maxHailIn: bestHail,
    maxWindMph: maxWind,
    mostRecentEventAt: dateOfLoss,
    reportsWithin5mi: reports5,
  });

  return {
    score,
    hailSizeIn: bestHail || null,
    swathHailIn,
    dateOfLoss: dateOfLoss ? dateOfLoss.toISOString() : null,
    maxHailIn: maxHail || null,
    maxWindMph: maxWind ? Math.round(maxWind) : null,
    eventCount: count,
    reportsWithin5mi: reports5,
    zoneName,
    nearest,
  };
}

/** Storm score per knock + lead id, for coloring canvassing pins. */
export async function getStormScores(
  companyId: string,
): Promise<{ knock: Record<string, number>; lead: Record<string, number> }> {
  const rows = await prisma.propertyStormMatch.findMany({
    where: { companyId },
    select: { leadId: true, knockId: true, score: true },
  });
  const knock: Record<string, number> = {};
  const lead: Record<string, number> = {};
  for (const r of rows) {
    if (r.knockId) knock[r.knockId] = r.score;
    if (r.leadId) lead[r.leadId] = r.score;
  }
  return { knock, lead };
}

export type StormSwathDTO = {
  id: string;
  hailMinIn: number;
  eventDate: string;
  rings: [number, number][][];
};

/** Radar-derived MRMS hail swaths overlapping the region within a date window. */
export async function getStormSwaths(filters: {
  from?: Date;
  to?: Date;
  center?: LatLng;
  radiusMiles?: number;
}): Promise<StormSwathDTO[]> {
  const center = filters.center ?? DALLAS;
  const radius = filters.radiusMiles ?? DEFAULT_RADIUS_MILES;
  const box = boundingBox(center, radius);

  const where: Prisma.StormSwathWhereInput = {
    // bbox of the swath overlaps the search box
    bboxMinLat: { lte: box.maxLat },
    bboxMaxLat: { gte: box.minLat },
    bboxMinLng: { lte: box.maxLng },
    bboxMaxLng: { gte: box.minLng },
  };
  if (filters.from || filters.to) {
    where.eventDate = {};
    if (filters.from) where.eventDate.gte = filters.from;
    if (filters.to) where.eventDate.lte = filters.to;
  }

  const swaths = await prisma.stormSwath.findMany({
    where,
    orderBy: { eventDate: "desc" },
    take: 4000,
  });
  return swaths.map((s) => ({
    id: s.id,
    hailMinIn: s.hailMinIn,
    eventDate: s.eventDate.toISOString(),
    rings: s.rings as [number, number][][],
  }));
}
