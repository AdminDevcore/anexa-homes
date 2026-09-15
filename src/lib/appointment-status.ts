import type { OutcomeCategory } from "@/lib/dispositions";

/**
 * Solar's Appointments list: where each appointment STANDS, and who has it.
 *
 * Roofing's list is appointment-filters.ts and is deliberately untouched; the
 * owner asked for this on solar only.
 *
 * Every appointment lands in exactly one STATUS. Rescheduled is not a status:
 * it is history, and it overlaps them. A deal moved twice and then signed is
 * both Ran and Rescheduled.
 */

export const ALL = "__all__";
/** A time in the future. */
export const SCHEDULED = "__scheduled__";
/** The time has passed and nobody recorded what happened: the chase list. */
export const NEEDS_OUTCOME = "__needs_outcome__";
/** The outcome counts as ran. */
export const RAN = "__ran__";
/** The outcome counts as not ran (a no-show). */
export const NOT_RAN = "__not_ran__";
/** Moved at least once, or carrying an outcome tagged Rescheduled. Overlaps. */
export const RESCHEDULED = "__rescheduled__";
/** No appointment time at all. */
export const UNSCHEDULED = "__unscheduled__";
/** The deal is dead, or the outcome counts as cancelled. */
export const CANCELLED = "__cancelled__";

export type StatusFilter = { key: string; label: string; count: number };
export type StatusFilterGroups = { states: StatusFilter[]; outcomes: StatusFilter[] };

export type StatusRow = {
  outcome: string | null;
  /** What `outcome` counts as, resolved on the server. Null exactly when outcome is. */
  outcomeCategory: OutcomeCategory | null;
  when: string | null;
  isPast: boolean;
  /** The deal sits in a stage flagged `isLost`. Hidden while browsing. */
  isCancelled: boolean;
  rescheduleCount: number;
  assigned: boolean;
};

const STATUS_KEYS = new Set([SCHEDULED, NEEDS_OUTCOME, RAN, NOT_RAN, UNSCHEDULED, CANCELLED]);

/** The one status a row belongs to. First match wins. */
export function statusOf(row: StatusRow): string {
  if (row.isCancelled || row.outcomeCategory === "cancelled") return CANCELLED;
  if (row.outcomeCategory === "ran") return RAN;
  if (row.outcomeCategory === "not_ran") return NOT_RAN;
  // A Rescheduled outcome is not a result: the visit is still owed.
  if (!row.when) return UNSCHEDULED;
  return row.isPast ? NEEDS_OUTCOME : SCHEDULED;
}

export function isRescheduled(row: StatusRow): boolean {
  return !row.isCancelled && (row.rescheduleCount > 0 || row.outcomeCategory === "rescheduled");
}

/**
 * @param rows        appointments in view (already search- and rep-filtered)
 * @param configured  outcome labels from Settings, in configured order
 * @param searching   the search box is non-empty, so All shows dead deals too
 */
export function buildStatusFilters(
  rows: StatusRow[],
  configured: string[] = [],
  searching = false
): StatusFilterGroups {
  const byStatus = new Map<string, number>();
  const byOutcome = new Map<string, number>();
  let dead = 0;
  let rescheduled = 0;
  for (const r of rows) {
    const s = statusOf(r);
    byStatus.set(s, (byStatus.get(s) ?? 0) + 1);
    if (r.isCancelled) dead++;
    if (isRescheduled(r)) rescheduled++;
    if (r.outcome && !r.isCancelled) byOutcome.set(r.outcome, (byOutcome.get(r.outcome) ?? 0) + 1);
  }
  const n = (key: string) => byStatus.get(key) ?? 0;

  // Every status always shows. The owner wants to see all of them, and a zero
  // is an answer.
  const states: StatusFilter[] = [
    { key: ALL, label: "All", count: searching ? rows.length : rows.length - dead },
    { key: SCHEDULED, label: "Scheduled", count: n(SCHEDULED) },
    { key: NEEDS_OUTCOME, label: "Needs outcome", count: n(NEEDS_OUTCOME) },
    { key: RAN, label: "Ran", count: n(RAN) },
    { key: NOT_RAN, label: "Not ran", count: n(NOT_RAN) },
    { key: RESCHEDULED, label: "Rescheduled", count: rescheduled },
    { key: UNSCHEDULED, label: "Unscheduled", count: n(UNSCHEDULED) },
    { key: CANCELLED, label: "Cancelled", count: n(CANCELLED) },
  ];

  // Configured order first; an outcome recorded on a deal but since deleted
  // from Settings is appended, or those deals would be unreachable by chip.
  const configuredSet = new Set(configured);
  const retired = [...byOutcome.keys()].filter((k) => !configuredSet.has(k)).sort();
  const outcomes = [...configured, ...retired].map((label) => ({
    key: label,
    label,
    count: byOutcome.get(label) ?? 0,
  }));

  return { states, outcomes };
}

export function matchesStatusFilter(row: StatusRow, filter: string): boolean {
  if (filter === ALL) return !row.isCancelled;
  if (filter === RESCHEDULED) return isRescheduled(row);
  if (STATUS_KEYS.has(filter)) return statusOf(row) === filter;
  return !row.isCancelled && row.outcome === filter;
}

/** Browsing hides dead deals; a search on All reaches them, as on roofing. */
export function visibleStatusRows<T extends StatusRow>(rows: T[], filter: string, searching: boolean): T[] {
  if (searching && filter === ALL) return rows;
  return rows.filter((r) => matchesStatusFilter(r, filter));
}

export type RepFilter = "any" | "assigned" | "unassigned";

export const REP_FILTERS: { key: RepFilter; label: string }[] = [
  { key: "any", label: "Any rep" },
  { key: "assigned", label: "Assigned" },
  { key: "unassigned", label: "Unassigned" },
];

export function matchesRepFilter(row: { assigned: boolean }, rep: RepFilter): boolean {
  return rep === "any" || row.assigned === (rep === "assigned");
}

/** Counted over what All shows, so "Any rep" always equals the All chip. */
export function repCounts(
  rows: { assigned: boolean; isCancelled: boolean }[],
  searching: boolean
): Record<RepFilter, number> {
  const pool = searching ? rows : rows.filter((r) => !r.isCancelled);
  const assigned = pool.filter((r) => r.assigned).length;
  return { any: pool.length, assigned, unassigned: pool.length - assigned };
}
