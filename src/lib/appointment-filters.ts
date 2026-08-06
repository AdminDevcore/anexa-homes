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

export type OutcomeFilter = { key: string; label: string; count: number };

/** Chips split into the two rows the UI renders. */
export type OutcomeFilterGroups = {
  /** All / Not ran / Upcoming / Unscheduled — where an appointment stands. */
  states: OutcomeFilter[];
  /** One per configured outcome — what happened. Zero-count entries are kept. */
  outcomes: OutcomeFilter[];
};

type Filterable = { outcome: string | null; when: string | null; isPast: boolean };

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

/** The single bucket a row belongs to. Every row lands in exactly one. */
function bucketOf(row: Filterable): string {
  if (row.outcome) return row.outcome;
  if (!row.when) return UNSCHEDULED;
  return row.isPast ? NOT_RAN : UPCOMING;
}

const SYNTHETIC = new Set([NOT_RAN, UPCOMING, UNSCHEDULED]);

/**
 * @param rows        appointments currently in view (already search-filtered)
 * @param configured  outcome labels from Settings, in configured order
 */
export function buildOutcomeFilters(
  rows: Filterable[],
  configured: string[] = []
): OutcomeFilterGroups {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const key = bucketOf(r);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  // A state chip that matches nothing is noise; All always anchors the row.
  const states = [
    { key: ALL_OUTCOMES, label: "All", count: rows.length },
    { key: NOT_RAN, label: "Not ran", count: counts.get(NOT_RAN) ?? 0 },
    { key: UPCOMING, label: "Upcoming", count: counts.get(UPCOMING) ?? 0 },
    { key: UNSCHEDULED, label: "Unscheduled", count: counts.get(UNSCHEDULED) ?? 0 },
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
  if (filter === ALL_OUTCOMES) return true;
  return bucketOf(row) === filter;
}
