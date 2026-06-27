// Lead scoring for storm-impacted properties. Pure + unit-tested.
//
// Rules (confirmed with the owner). Hail tiers are NON-additive — take the
// single highest tier that applies:
//   hail >= 1"   => +30
//   hail >= 1.5" => +50
//   hail >= 2"   => +70
//   wind >= 60mph                       => +40
//   most recent nearby event <= 30 days => +20
//   >= 2 reports within 5 miles         => +20

export type ScoreInput = {
  maxHailIn?: number | null;
  maxWindMph?: number | null;
  mostRecentEventAt?: Date | string | null;
  reportsWithin5mi?: number | null;
};

export const RECENT_DAYS = 30;
export const CLUSTER_RADIUS_MI = 5;
export const CLUSTER_MIN_REPORTS = 2;

/** Tiered hail bonus (highest matching tier only). */
export function hailPoints(maxHailIn?: number | null): number {
  const h = maxHailIn ?? 0;
  if (h >= 2) return 70;
  if (h >= 1.5) return 50;
  if (h >= 1) return 30;
  return 0;
}

export function windPoints(maxWindMph?: number | null): number {
  return (maxWindMph ?? 0) >= 60 ? 40 : 0;
}

export function recencyPoints(
  mostRecentEventAt?: Date | string | null,
  now: Date = new Date(),
): number {
  if (!mostRecentEventAt) return 0;
  const d = mostRecentEventAt instanceof Date ? mostRecentEventAt : new Date(mostRecentEventAt);
  if (Number.isNaN(d.getTime())) return 0;
  const days = (now.getTime() - d.getTime()) / 86_400_000;
  return days >= 0 && days <= RECENT_DAYS ? 20 : 0;
}

export function clusterPoints(reportsWithin5mi?: number | null): number {
  return (reportsWithin5mi ?? 0) >= CLUSTER_MIN_REPORTS ? 20 : 0;
}

/** Total storm-opportunity score for a property. */
export function scoreProperty(input: ScoreInput, now: Date = new Date()): number {
  return (
    hailPoints(input.maxHailIn) +
    windPoints(input.maxWindMph) +
    recencyPoints(input.mostRecentEventAt, now) +
    clusterPoints(input.reportsWithin5mi)
  );
}
