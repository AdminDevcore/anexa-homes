import { describe, it, expect } from "vitest";
import {
  ALL_OUTCOMES,
  NOT_RAN,
  UPCOMING,
  UNSCHEDULED,
  buildOutcomeFilters,
  matchesOutcomeFilter,
} from "@/lib/appointment-filters";

const hail = { outcome: "Hail Damage", when: "Jul 25", isPast: true };
const noShow = { outcome: "No Show", when: "Jul 27", isPast: true };
const overdue = { outcome: null, when: "Jul 29", isPast: true };
const upcoming = { outcome: null, when: "Aug 9", isPast: false };
const unscheduled = { outcome: null, when: null, isPast: false };

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
      [{ outcome: "Ran", when: "d", isPast: true }],
      CONFIGURED
    );
    const retired = outcomes.find((f) => f.label === "Ran");
    expect(retired).toBeDefined();
    expect(retired!.count).toBe(1);
    // ...and it sorts after the configured ones.
    expect(outcomes.at(-1)!.label).toBe("Ran");
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
  it("All matches everything", () => {
    for (const row of rows) expect(matchesOutcomeFilter(row, ALL_OUTCOMES)).toBe(true);
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
      matchesOutcomeFilter({ outcome: "Hail Damage", when: "Aug 9", isPast: false }, "Hail Damage")
    ).toBe(true);
  });

  it("a zero-count outcome filter simply matches nothing", () => {
    for (const row of rows) expect(matchesOutcomeFilter(row, "Wind Damage")).toBe(false);
  });

  it("partitions the rows — every row matches exactly one non-All chip", () => {
    const { states, outcomes } = buildOutcomeFilters(rows, CONFIGURED);
    const keys = [...states, ...outcomes].filter((f) => f.key !== ALL_OUTCOMES).map((f) => f.key);
    for (const row of rows) {
      expect(keys.filter((k) => matchesOutcomeFilter(row, k))).toHaveLength(1);
    }
  });
});
