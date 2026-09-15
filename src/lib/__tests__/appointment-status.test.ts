import { describe, it, expect } from "vitest";
import {
  ALL,
  CANCELLED,
  NEEDS_OUTCOME,
  NOT_RAN,
  RAN,
  RESCHEDULED,
  SCHEDULED,
  UNSCHEDULED,
  buildStatusFilters,
  matchesRepFilter,
  matchesStatusFilter,
  repCounts,
  statusOf,
  visibleStatusRows,
  type StatusRow,
} from "@/lib/appointment-status";

const row = (o: Partial<StatusRow> = {}): StatusRow => ({
  outcome: null,
  outcomeCategory: null,
  when: "Sep 20",
  isPast: false,
  isCancelled: false,
  rescheduleCount: 0,
  assigned: true,
  ...o,
});

const SIGNED = "Signed — proposal accepted";
const scheduled = row();
const needsOutcome = row({ isPast: true });
const signed = row({ outcome: SIGNED, outcomeCategory: "ran", isPast: true });
const noShow = row({ outcome: "No show — nobody home", outcomeCategory: "not_ran", isPast: true });
const cancelledBefore = row({ outcome: "Cancelled before arrival", outcomeCategory: "cancelled", isPast: true });
const rescheduledOutcome = row({ outcome: "Rescheduled", outcomeCategory: "rescheduled", isPast: true });
const unscheduled = row({ when: null });
/** Sold, then the deal died. */
const deadSigned = row({ outcome: SIGNED, outcomeCategory: "ran", isPast: true, isCancelled: true });
/** Moved twice, then signed: both Ran AND Rescheduled. */
const movedThenSigned = row({ outcome: SIGNED, outcomeCategory: "ran", isPast: true, rescheduleCount: 2 });

const ROWS = [
  scheduled,
  needsOutcome,
  signed,
  noShow,
  cancelledBefore,
  rescheduledOutcome,
  unscheduled,
  deadSigned,
  movedThenSigned,
];
const STATUS_KEYS = [SCHEDULED, NEEDS_OUTCOME, RAN, NOT_RAN, UNSCHEDULED, CANCELLED];
const CONFIGURED = [SIGNED, "Not interested", "No show — nobody home", "Rescheduled", "Cancelled before arrival"];

describe("statusOf", () => {
  it("puts each appointment where it stands", () => {
    expect(statusOf(scheduled)).toBe(SCHEDULED);
    expect(statusOf(needsOutcome)).toBe(NEEDS_OUTCOME);
    expect(statusOf(signed)).toBe(RAN);
    expect(statusOf(noShow)).toBe(NOT_RAN);
    expect(statusOf(cancelledBefore)).toBe(CANCELLED);
    expect(statusOf(unscheduled)).toBe(UNSCHEDULED);
  });

  it("a dead deal is Cancelled even though it carries a Ran outcome", () => {
    expect(statusOf(deadSigned)).toBe(CANCELLED);
  });

  // A Rescheduled outcome is not a result: the visit is still owed.
  it("a Rescheduled outcome falls through to the appointment time", () => {
    expect(statusOf(rescheduledOutcome)).toBe(NEEDS_OUTCOME);
    expect(statusOf({ ...rescheduledOutcome, isPast: false })).toBe(SCHEDULED);
    expect(statusOf({ ...rescheduledOutcome, when: null })).toBe(UNSCHEDULED);
  });

  it("a recorded result wins over a missing time", () => {
    expect(statusOf(row({ outcome: SIGNED, outcomeCategory: "ran", when: null }))).toBe(RAN);
  });
});

describe("buildStatusFilters", () => {
  it("always shows every status, in order, even with nothing to count", () => {
    const { states } = buildStatusFilters([], CONFIGURED);
    expect(states.map((f) => f.label)).toEqual([
      "All",
      "Scheduled",
      "Needs outcome",
      "Ran",
      "Not ran",
      "Rescheduled",
      "Unscheduled",
      "Cancelled",
    ]);
    expect(states.every((f) => f.count === 0)).toBe(true);
  });

  it("counts each status, with Rescheduled overlapping them", () => {
    const counts = Object.fromEntries(buildStatusFilters(ROWS, CONFIGURED).states.map((f) => [f.key, f.count]));
    expect(counts).toEqual({
      [ALL]: 8, // every live deal; deadSigned is hidden while browsing
      [SCHEDULED]: 1,
      [NEEDS_OUTCOME]: 2, // needsOutcome + rescheduledOutcome
      [RAN]: 2, // signed + movedThenSigned
      [NOT_RAN]: 1,
      [RESCHEDULED]: 2, // rescheduledOutcome + movedThenSigned
      [UNSCHEDULED]: 1,
      [CANCELLED]: 2, // cancelledBefore + deadSigned
    });
  });

  it("counts everything in All while a search is running", () => {
    expect(buildStatusFilters(ROWS, CONFIGURED, true).states[0].count).toBe(ROWS.length);
  });

  it("lists every configured outcome, counts live deals only, and appends retired ones", () => {
    const { outcomes } = buildStatusFilters(
      [...ROWS, row({ outcome: "Old outcome", outcomeCategory: "ran" })],
      CONFIGURED
    );
    expect(outcomes.map((f) => f.label)).toEqual([...CONFIGURED, "Old outcome"]);
    expect(outcomes.find((f) => f.label === SIGNED)!.count).toBe(2);
    expect(outcomes.find((f) => f.label === "Not interested")!.count).toBe(0);
  });
});

describe("matchesStatusFilter", () => {
  it("the statuses partition the rows: each row is in exactly one", () => {
    for (const r of ROWS) {
      expect(STATUS_KEYS.filter((k) => matchesStatusFilter(r, k))).toHaveLength(1);
    }
  });

  it("Rescheduled overlaps the statuses and skips dead deals", () => {
    expect(matchesStatusFilter(movedThenSigned, RESCHEDULED)).toBe(true);
    expect(matchesStatusFilter(movedThenSigned, RAN)).toBe(true);
    expect(matchesStatusFilter(rescheduledOutcome, RESCHEDULED)).toBe(true);
    expect(matchesStatusFilter(row({ rescheduleCount: 1, isCancelled: true }), RESCHEDULED)).toBe(false);
    expect(matchesStatusFilter(signed, RESCHEDULED)).toBe(false);
  });

  it("an outcome chip matches live deals with that exact outcome", () => {
    expect(matchesStatusFilter(signed, SIGNED)).toBe(true);
    expect(matchesStatusFilter(deadSigned, SIGNED)).toBe(false);
    expect(matchesStatusFilter(noShow, SIGNED)).toBe(false);
  });
});

describe("visibleStatusRows", () => {
  const rows = [scheduled, deadSigned];

  it("hides dead deals while browsing and reaches them while searching", () => {
    expect(visibleStatusRows(rows, ALL, false)).toEqual([scheduled]);
    expect(visibleStatusRows(rows, ALL, true)).toEqual(rows);
  });

  it("a search does not widen a chosen chip", () => {
    expect(visibleStatusRows(rows, SCHEDULED, true)).toEqual([scheduled]);
  });
});

describe("rep filter", () => {
  const rows = [row({ assigned: false }), row(), row({ assigned: false, isCancelled: true })];

  it("matches by whether a rep is assigned", () => {
    expect(rows.filter((r) => matchesRepFilter(r, "unassigned"))).toHaveLength(2);
    expect(rows.filter((r) => matchesRepFilter(r, "assigned"))).toHaveLength(1);
    expect(rows.filter((r) => matchesRepFilter(r, "any"))).toHaveLength(3);
  });

  // The rep counts must agree with the All chip beside them.
  it("counts live deals while browsing, everything while searching", () => {
    expect(repCounts(rows, false)).toEqual({ any: 2, assigned: 1, unassigned: 1 });
    expect(repCounts(rows, true)).toEqual({ any: 3, assigned: 1, unassigned: 2 });
  });
});
