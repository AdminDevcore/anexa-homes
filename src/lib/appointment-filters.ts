/**
 * Outcome filtering for the Appointments list.
 *
 * Appointment outcomes are per-company, per-vertical free text (Settings →
 * Appointment Outcomes), so the filters are DERIVED from the rows on screen
 * rather than hard-coded. Roofing gets "Ran" / "No Show"; solar gets "Signed —
 * proposal accepted" and friends; a company that renames everything tomorrow
 * gets its own words. None of it needs a code change.
 *
 * Three synthetic filters cover the states no outcome label can express.
 */

export const ALL_OUTCOMES = "__all__";
/**
 * The appointment time has passed and nobody recorded what happened. This is
 * the chase list — deliberately NOT "any appointment without an outcome",
 * which would bury real gaps under next week's calendar.
 */
export const NOT_RAN = "__not_ran__";
/** Scheduled in the future — nothing to record yet. */
export const UPCOMING = "__upcoming__";
/** No appointment date at all. */
export const UNSCHEDULED = "__unscheduled__";

export type OutcomeFilter = { key: string; label: string; count: number };

type Filterable = { outcome: string | null; when: string | null; isPast: boolean };

/** The single bucket a row belongs to. Every row lands in exactly one. */
function bucketOf(row: Filterable): string {
  if (row.outcome) return row.outcome;
  if (!row.when) return UNSCHEDULED;
  return row.isPast ? NOT_RAN : UPCOMING;
}

/**
 * Filters for the given rows, in scan order: All, Not ran, each outcome present
 * (most common first), then the two "nothing to record yet" states. Filters that
 * would match nothing are dropped — except All, which always anchors the row.
 */
export function buildOutcomeFilters(rows: Filterable[]): OutcomeFilter[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const key = bucketOf(r);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const synthetic = new Set([NOT_RAN, UPCOMING, UNSCHEDULED]);
  const outcomes = [...counts.entries()]
    .filter(([key]) => !synthetic.has(key))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, count]) => ({ key, label: key, count }));

  return [
    { key: ALL_OUTCOMES, label: "All", count: rows.length },
    { key: NOT_RAN, label: "Not ran", count: counts.get(NOT_RAN) ?? 0 },
    ...outcomes,
    { key: UPCOMING, label: "Upcoming", count: counts.get(UPCOMING) ?? 0 },
    { key: UNSCHEDULED, label: "Unscheduled", count: counts.get(UNSCHEDULED) ?? 0 },
  ].filter((f) => f.key === ALL_OUTCOMES || f.count > 0);
}

export function matchesOutcomeFilter(row: Filterable, filter: string): boolean {
  if (filter === ALL_OUTCOMES) return true;
  return bucketOf(row) === filter;
}
