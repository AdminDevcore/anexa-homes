/**
 * Outcome filtering for the Appointments list.
 *
 * The workflow this models: a rep hits "Run appointment" and must pick an
 * outcome. So the outcome field answers WHAT HAPPENED — that it ran at all is
 * implied by the field being set. That is why "ran" is not itself an outcome
 * here; running is simply the absence of NOT_RAN.
 *
 * Outcomes are per-company free text (Settings → Appointment Outcomes), so the
 * chips are built from the COMPANY'S CONFIGURED LIST — including outcomes no
 * appointment has yet, so you can see which results are going unused. Anything
 * recorded on a lead but missing from config (a since-deleted outcome) is
 * appended, or those rows would be unreachable by any filter.
 */

export const ALL_OUTCOMES = "__all__";
/**
 * The appointment time has passed and nobody recorded an outcome. This is the
 * chase list — deliberately NOT "any appointment without an outcome", which
 * would bury real gaps under next week's calendar.
 */
export const NOT_RAN = "__not_ran__";
/** Scheduled in the future — nothing to record yet. */
export const UPCOMING = "__upcoming__";
/** No appointment date at all. */
export const UNSCHEDULED = "__unscheduled__";
/**
 * The deal is dead — it sits in a stage its pipeline flags `isLost`.
 *
 * Archived rather than deleted: it drops out of every other chip, including
 * the outcome it was carrying when it died, but stays one click away and stays
 * in the reports. Nothing about it is destroyed.
 */
export const CANCELLED = "__cancelled__";

export type OutcomeFilter = { key: string; label: string; count: number };

/** Chips split into the two rows the UI renders. */
export type OutcomeFilterGroups = {
  /** All / Not ran / Upcoming / Unscheduled — where an appointment stands. */
  states: OutcomeFilter[];
  /** One per configured outcome — what happened. Zero-count entries are kept. */
  outcomes: OutcomeFilter[];
};

type Filterable = {
  outcome: string | null;
  when: string | null;
  isPast: boolean;
  /** In a stage flagged `isLost`. Required, not optional: a filter whose job is
   *  hiding rows must never treat a forgotten field as "show it". */
  isCancelled: boolean;
};

/** The columns the search box matches, plus the address behind the row. */
type Searchable = {
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  repName: string | null;
  sourceName: string | null;
  stage: { name: string } | null;
  outcome: string | null;
};

/**
 * Free-text match for the Appointments list. `needle` is matched against the
 * visible columns AND the property address (street/city/state/ZIP), since reps
 * look deals up by house as often as by name.
 */
export function matchesAppointmentQuery(row: Searchable, needle: string): boolean {
  const q = needle.trim().toLowerCase();
  if (!q) return true;
  return [row.name, row.phone, row.email, row.address, row.repName, row.sourceName, row.stage?.name, row.outcome]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(q);
}

/**
 * The single bucket a row belongs to. Every row lands in exactly one.
 *
 * Cancelled wins over everything, including a recorded outcome: a deal that was
 * signed and then died is not part of "Signed — proposal accepted" any more.
 * Because every count in this file is derived from this function, that single
 * line is what keeps dead deals out of every other chip's total.
 */
function bucketOf(row: Filterable): string {
  if (row.isCancelled) return CANCELLED;
  if (row.outcome) return row.outcome;
  if (!row.when) return UNSCHEDULED;
  return row.isPast ? NOT_RAN : UPCOMING;
}

const SYNTHETIC = new Set([NOT_RAN, UPCOMING, UNSCHEDULED, CANCELLED]);

/**
 * @param rows        appointments currently in view (already search-filtered)
 * @param configured  outcome labels from Settings, in configured order
 * @param searching   a search box is non-empty, so All is showing cancelled
 *                    deals too (see visibleRows) and must count them
 */
export function buildOutcomeFilters(
  rows: Filterable[],
  configured: string[] = [],
  searching = false
): OutcomeFilterGroups {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const key = bucketOf(r);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  // A state chip that matches nothing is noise; All always anchors the row.
  //
  // All counts the LIVE deals, because live deals are what All renders — with
  // the one exception that a running search reaches the cancelled ones, and the
  // chip has to agree with the rows under it. Cancelled goes last: it closes
  // the row rather than interrupting it.
  const cancelled = counts.get(CANCELLED) ?? 0;
  const states = [
    { key: ALL_OUTCOMES, label: "All", count: searching ? rows.length : rows.length - cancelled },
    { key: NOT_RAN, label: "Not ran", count: counts.get(NOT_RAN) ?? 0 },
    { key: UPCOMING, label: "Upcoming", count: counts.get(UPCOMING) ?? 0 },
    { key: UNSCHEDULED, label: "Unscheduled", count: counts.get(UNSCHEDULED) ?? 0 },
    { key: CANCELLED, label: "Cancelled", count: cancelled },
  ].filter((f) => f.key === ALL_OUTCOMES || f.count > 0);

  const configuredSet = new Set(configured);
  const retired = [...counts.keys()]
    .filter((k) => !SYNTHETIC.has(k) && !configuredSet.has(k))
    .sort();

  // Configured order first (it already clusters by group), retired ones last.
  const outcomes = [...configured, ...retired].map((label) => ({
    key: label,
    label,
    count: counts.get(label) ?? 0,
  }));

  return { states, outcomes };
}

export function matchesOutcomeFilter(row: Filterable, filter: string): boolean {
  if (filter === ALL_OUTCOMES) return !row.isCancelled;
  return bucketOf(row) === filter;
}

/**
 * The rows the list actually renders.
 *
 * Browsing hides cancelled deals; SEARCHING finds them. That asymmetry is the
 * whole point of archiving rather than deleting — typing a customer's name and
 * getting "no appointments match" reads as the deal having been thrown away,
 * and reps would stop trusting the list. The row still shows its red Cancelled
 * stage chip, so nothing is disguised as live.
 *
 * A search widens All only. Picking a chip is an explicit choice about what you
 * want to see, and stays honoured.
 *
 * @param searching  the search box holds a non-empty query
 */
export function visibleRows<T extends Filterable>(
  rows: T[],
  filter: string,
  searching: boolean
): T[] {
  if (searching && filter === ALL_OUTCOMES) return rows;
  return rows.filter((r) => matchesOutcomeFilter(r, filter));
}
