import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { haversineMiles } from "./geo";
import { scoreProperty, CLUSTER_RADIUS_MI } from "./scoring";

// Recompute PropertyStormMatch for a company: every geocoded Lead + Knock is
// scored against storm events within MATCH_RADIUS_MI. Full replace per company
// (cheap, deterministic, no stale rows). Called after each import + by cron.

export const MATCH_RADIUS_MI = 10;

export type RecomputeResult = { leadMatches: number; knockMatches: number; events: number };

export async function recomputeStormMatches(
  companyId: string,
  now: Date = new Date(),
): Promise<RecomputeResult> {
  const events = await prisma.stormEvent.findMany({
    where: { companyId },
    select: { id: true, eventAt: true, lat: true, lng: true, hailSizeIn: true, windSpeedMph: true },
  });

  const leads = await prisma.lead.findMany({
    where: { companyId, lat: { not: null }, lng: { not: null } },
    select: { id: true, lat: true, lng: true },
  });
  const knocks = await prisma.knock.findMany({
    where: { companyId },
    select: { id: true, lat: true, lng: true },
  });

  type Subject = { lat: number; lng: number; leadId?: string; knockId?: string };
  const subjects: Subject[] = [
    ...leads
      .filter((l) => l.lat != null && l.lng != null)
      .map((l) => ({ lat: l.lat as number, lng: l.lng as number, leadId: l.id })),
    ...knocks.map((k) => ({ lat: k.lat, lng: k.lng, knockId: k.id })),
  ];

  const rows: Prisma.PropertyStormMatchCreateManyInput[] = [];
  for (const s of subjects) {
    let nearestId: string | null = null;
    let nearestDist = Infinity;
    let maxHail = 0;
    let maxWind = 0;
    let reports5 = 0;
    let count = 0;
    let mostRecent: Date | null = null;
    for (const e of events) {
      // Cheap pre-filter (~13 mi box) before the exact Haversine.
      if (Math.abs(e.lat - s.lat) > 0.2 || Math.abs(e.lng - s.lng) > 0.25) continue;
      const d = haversineMiles(s, e);
      if (d > MATCH_RADIUS_MI) continue;
      count++;
      if (d < nearestDist) {
        nearestDist = d;
        nearestId = e.id;
      }
      if ((e.hailSizeIn ?? 0) > maxHail) maxHail = e.hailSizeIn ?? 0;
      if ((e.windSpeedMph ?? 0) > maxWind) maxWind = e.windSpeedMph ?? 0;
      if (d <= CLUSTER_RADIUS_MI) reports5++;
      if (!mostRecent || e.eventAt > mostRecent) mostRecent = e.eventAt;
    }
    if (count === 0) continue;
    const score = scoreProperty(
      { maxHailIn: maxHail, maxWindMph: maxWind, mostRecentEventAt: mostRecent, reportsWithin5mi: reports5 },
      now,
    );
    rows.push({
      companyId,
      leadId: s.leadId ?? null,
      knockId: s.knockId ?? null,
      lat: s.lat,
      lng: s.lng,
      nearestEventId: nearestId,
      distanceMiles: Number(nearestDist.toFixed(2)),
      dateOfLoss: mostRecent,
      score,
      eventCount: count,
      maxHailIn: maxHail || null,
      maxWindMph: maxWind ? Math.round(maxWind) : null,
      computedAt: now,
    });
  }

  await prisma.$transaction([
    prisma.propertyStormMatch.deleteMany({ where: { companyId } }),
    prisma.propertyStormMatch.createMany({ data: rows }),
  ]);

  return {
    leadMatches: rows.filter((r) => r.leadId).length,
    knockMatches: rows.filter((r) => r.knockId).length,
    events: events.length,
  };
}
