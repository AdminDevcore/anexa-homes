import { Prisma, type StormType } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { geocode } from "@/server/modules/geo/geocode";
import { haversineMiles, boundingBox, DALLAS, DEFAULT_RADIUS_MILES, type LatLng } from "./geo";
import { scoreProperty, CLUSTER_RADIUS_MI } from "./scoring";
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

export type AddressCheckResult = {
  query: string;
  matched: boolean;
  center: { lat: number; lng: number; label: string } | null;
  rings: { miles: number; count: number }[];
  nearest:
    | { type: StormType; eventAt: string; distanceMiles: number; hailSizeIn: number | null; windSpeedMph: number | null; tornadoScale: string | null }
    | null;
  dateOfLoss: string | null;
  score: number;
  maxHailIn: number | null;
  maxWindMph: number | null;
};

const RING_MILES = [1, 3, 5, 10];

/** Geocode an address and summarize nearby storms (1/3/5/10 mi rings, nearest
 *  event, possible date of loss, score). */
export async function addressCheck(companyId: string, query: string): Promise<AddressCheckResult> {
  const empty: AddressCheckResult = {
    query,
    matched: false,
    center: null,
    rings: RING_MILES.map((m) => ({ miles: m, count: 0 })),
    nearest: null,
    dateOfLoss: null,
    score: 0,
    maxHailIn: null,
    maxWindMph: null,
  };
  const geo = await geocode(query);
  if (!geo) return empty;
  const center = { lat: geo.lat, lng: geo.lng };

  const box = boundingBox(center, 10);
  const events = await prisma.stormEvent.findMany({
    where: {
      companyId,
      lat: { gte: box.minLat, lte: box.maxLat },
      lng: { gte: box.minLng, lte: box.maxLng },
    },
    orderBy: { eventAt: "desc" },
  });

  const within = events
    .map((e) => ({ e, d: haversineMiles(center, { lat: e.lat, lng: e.lng }) }))
    .filter(({ d }) => d <= 10);

  const rings = RING_MILES.map((miles) => ({ miles, count: within.filter(({ d }) => d <= miles).length }));
  let nearest: AddressCheckResult["nearest"] = null;
  let maxHail = 0;
  let maxWind = 0;
  let mostRecent: Date | null = null;
  let nearestDist = Infinity;
  for (const { e, d } of within) {
    if (d < nearestDist) {
      nearestDist = d;
      nearest = {
        type: e.type,
        eventAt: e.eventAt.toISOString(),
        distanceMiles: Number(d.toFixed(2)),
        hailSizeIn: e.hailSizeIn,
        windSpeedMph: e.windSpeedMph,
        tornadoScale: e.tornadoScale,
      };
    }
    if ((e.hailSizeIn ?? 0) > maxHail) maxHail = e.hailSizeIn ?? 0;
    if ((e.windSpeedMph ?? 0) > maxWind) maxWind = e.windSpeedMph ?? 0;
    if (!mostRecent || e.eventAt > mostRecent) mostRecent = e.eventAt;
  }
  const reports5 = within.filter(({ d }) => d <= CLUSTER_RADIUS_MI).length;
  const score = scoreProperty(
    { maxHailIn: maxHail, maxWindMph: maxWind, mostRecentEventAt: mostRecent, reportsWithin5mi: reports5 },
    new Date(),
  );

  return {
    query,
    matched: true,
    center: { lat: center.lat, lng: center.lng, label: geo.displayName },
    rings,
    nearest,
    dateOfLoss: mostRecent?.toISOString() ?? null,
    score,
    maxHailIn: maxHail || null,
    maxWindMph: maxWind ? Math.round(maxWind) : null,
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
