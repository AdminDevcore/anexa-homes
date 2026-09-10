import { describe, it, expect } from "vitest";
import {
  ALL_OUTCOMES,
  CANCELLED,
  NOT_RAN,
  UPCOMING,
  UNSCHEDULED,
  buildOutcomeFilters,
  matchesOutcomeFilter,
  visibleRows,
} from "@/lib/appointment-filters";

const hail = { outcome: "Hail Damage", when: "Jul 25", isPast: true, isCancelled: false };
const noShow = { outcome: "No Show", when: "Jul 27", isPast: true, isCancelled: false };
const overdue = { outcome: null, when: "Jul 29", isPast: true, isCancelled: false };
const upcoming = { outcome: null, when: "Aug 9", isPast: false, isCancelled: false };
const unscheduled = { outcome: null, when: null, isPast: false, isCancelled: false };
/** A dead deal. Note it still carries an outcome — it was sold, then cancelled. */
const cancelled = { outcome: "Hail Damage", when: "Jul 20", isPast: true, isCancelled: true };
const cancelledUnscheduled = { outcome: null, when: null, isPast: false, isCancelled: true };

const CONFIGURED = ["Hail Damage", "Wind Damage", "Retail Roof", "No Show", "No Damage"];
const rows = [hail, hail, noShow, overdue, overdue, upcoming, unscheduled];

describe("state chips", () => {
  it("are All, Not ran, Upcoming, Unscheduled in that order", () => {
    expect(buildOutcomeFilters(rows, CONFIGURED).states.map((f) => f.label)).toEqual([
      "All",
      "Not ran",
      "Upcoming",
      "Unscheduled",
    ]);
  });

  it("add Cancelled, last, only when something is cancelled", () => {
    expect(buildOutcomeFilters([...rows, cancelled], CONFIGURED).states.map((f) => f.label)).toEqual([
      "All",
      "Not ran",
      "Upcoming",
      "Unscheduled",
      "Cancelled",
    ]);
    expect(buildOutcomeFilters(rows, CONFIGURED).states.map((f) => f.label)).not.toContain(
      "Cancelled"
    );
  });

  it("count All as the ACTIVE deals — what All actually renders", () => {
    const { states } = buildOutcomeFilters([overdue, cancelled, cancelledUnscheduled], CONFIGURED);
    expect(states.find((f) => f.key === ALL_OUTCOMES)!.count).toBe(1);
    expect(states.find((f) => f.key === CANCELLED)!.count).toBe(2);
  });

  // Searching reaches cancelled deals (see visibleRows), so All must count them
  // or the chip would disagree with the rows underneath it.
  it("count All as everything while a search is running", () => {
    const { states } = buildOutcomeFilters([overdue, cancelled], CONFIGURED, true);
    expect(states.find((f) => f.key === ALL_OUTCOMES)!.count).toBe(2);
  });

  it("drop the ones matching nothing, but always keep All", () => {
    expect(buildOutcomeFilters([overdue], CONFIGURED).states.map((f) => f.label)).toEqual([
      "All",
      "Not ran",
    ]);
    expect(buildOutcomeFilters([], CONFIGURED).states.map((f) => f.label)).toEqual(["All"]);
  });
});

describe("outcome chips", () => {
  // The point of this change: unused outcomes must stay visible.
  it("include every configured outcome, even at zero, in configured order", () => {
    const { outcomes } = buildOutcomeFilters(rows, CONFIGURED);
    expect(outcomes.map((f) => f.label)).toEqual(CONFIGURED);
    expect(outcomes.find((f) => f.label === "Wind Damage")!.count).toBe(0);
    expect(outcomes.find((f) => f.label === "Hail Damage")!.count).toBe(2);
  });

  it("still show an outcome recorded on a lead but since deleted from Settings", () => {
    // "Ran" is being retired in Settings; the lead already carrying it must
    // stay reachable by some filter.
    const { outcomes } = buildOutcomeFilters(
      [{ outcome: "Ran", when: "d", isPast: true, isCancelled: false }],
      CONFIGURED
    );
    const retired = outcomes.find((f) => f.label === "Ran");
    expect(retired).toBeDefined();
    expect(retired!.count).toBe(1);
    // ...and it sorts after the configured ones.
    expect(outcomes.at(-1)!.label).toBe("Ran");
  });

  // A deal that was sold and then cancelled must not inflate "Signed — proposal
  // accepted": that chip is a list of live work, and the row is not in it.
  it("do not count cancelled deals, even ones carrying that outcome", () => {
    const { outcomes } = buildOutcomeFilters([hail, cancelled], CONFIGURED);
    expect(outcomes.find((f) => f.label === "Hail Damage")!.count).toBe(1);
  });

  it("is empty when nothing is configured and nothing is recorded", () => {
    expect(buildOutcomeFilters([overdue, unscheduled], []).outcomes).toEqual([]);
  });

  it("counts follow the rows passed in, so search narrowing updates them", () => {
    const { outcomes } = buildOutcomeFilters([hail], CONFIGURED);
    expect(outcomes.find((f) => f.label === "Hail Damage")!.count).toBe(1);
    expect(outcomes.find((f) => f.label === "No Show")!.count).toBe(0);
  });
});

describe("matchesOutcomeFilter", () => {
  it("All matches every live deal, and no cancelled one", () => {
    for (const row of rows) expect(matchesOutcomeFilter(row, ALL_OUTCOMES)).toBe(true);
    expect(matchesOutcomeFilter(cancelled, ALL_OUTCOMES)).toBe(false);
  });

  it("Cancelled matches only cancelled deals", () => {
    expect(matchesOutcomeFilter(cancelled, CANCELLED)).toBe(true);
    expect(matchesOutcomeFilter(cancelledUnscheduled, CANCELLED)).toBe(true);
    for (const row of rows) expect(matchesOutcomeFilter(row, CANCELLED)).toBe(false);
  });

  // A cancelled deal keeps its outcome and its date, and must still fall out of
  // every chip that describes live work.
  it("keeps cancelled deals out of the outcome and state chips they'd otherwise land in", () => {
    expect(matchesOutcomeFilter(cancelled, "Hail Damage")).toBe(false);
    expect(matchesOutcomeFilter(cancelled, NOT_RAN)).toBe(false);
    expect(matchesOutcomeFilter(cancelledUnscheduled, UNSCHEDULED)).toBe(false);
  });

  // Tomorrow's appointment is not a data gap.
  it("Not ran is past-and-unlogged only", () => {
    expect(matchesOutcomeFilter(overdue, NOT_RAN)).toBe(true);
    expect(matchesOutcomeFilter(upcoming, NOT_RAN)).toBe(false);
    expect(matchesOutcomeFilter(unscheduled, NOT_RAN)).toBe(false);
    expect(matchesOutcomeFilter(hail, NOT_RAN)).toBe(false);
  });

  it("Upcoming is future-and-unlogged; Unscheduled is dateless", () => {
    expect(matchesOutcomeFilter(upcoming, UPCOMING)).toBe(true);
    expect(matchesOutcomeFilter(overdue, UPCOMING)).toBe(false);
    expect(matchesOutcomeFilter(unscheduled, UNSCHEDULED)).toBe(true);
  });

  it("an outcome filter matches that exact label, regardless of timing", () => {
    expect(matchesOutcomeFilter(hail, "Hail Damage")).toBe(true);
    expect(matchesOutcomeFilter(noShow, "Hail Damage")).toBe(false);
    expect(
      matchesOutcomeFilter({ outcome: "Hail Damage", when: "Aug 9", isPast: false, isCancelled: false },
      "Hail Damage")
    ).toBe(true);
  });

  it("a zero-count outcome filter simply matches nothing", () => {
    for (const row of rows) expect(matchesOutcomeFilter(row, "Wind Damage")).toBe(false);
  });

  it("partitions the rows — every row matches exactly one non-All chip", () => {
    const all = [...rows, cancelled, cancelledUnscheduled];
    const { states, outcomes } = buildOutcomeFilters(all, CONFIGURED);
    const keys = [...states, ...outcomes].filter((f) => f.key !== ALL_OUTCOMES).map((f) => f.key);
    for (const row of all) {
      expect(keys.filter((k) => matchesOutcomeFilter(row, k))).toHaveLength(1);
    }
  });
});

describe("visibleRows", () => {
  const all = [overdue, upcoming, cancelled];

  it("hides cancelled deals while browsing", () => {
    expect(visibleRows(all, ALL_OUTCOMES, false)).toEqual([overdue, upcoming]);
  });

  // Hidden from browsing, present in search. Without this, searching a
  // cancelled customer by name returns "no appointments match", which reads as
  // the deal having been deleted.
  it("reaches cancelled deals once a search is running", () => {
    expect(visibleRows(all, ALL_OUTCOMES, true)).toEqual(all);
  });

  // Search widens All only. A chip is an explicit choice and stays honoured.
  it("does not widen a specific chip", () => {
    expect(visibleRows(all, NOT_RAN, true)).toEqual([overdue]);
    expect(visibleRows(all, CANCELLED, true)).toEqual([cancelled]);
  });
});
