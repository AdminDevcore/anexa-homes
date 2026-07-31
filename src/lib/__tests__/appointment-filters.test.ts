import { describe, it, expect } from "vitest";
import {
  ALL_OUTCOMES,
  NOT_RAN,
  UPCOMING,
  UNSCHEDULED,
  buildOutcomeFilters,
  matchesOutcomeFilter,
} from "@/lib/appointment-filters";

const ran = { outcome: "Ran", when: "Jul 25", isPast: true };
const noShow = { outcome: "No Show", when: "Jul 27", isPast: true };
const overdue = { outcome: null, when: "Jul 29", isPast: true };
const upcoming = { outcome: null, when: "Aug 9", isPast: false };
const unscheduled = { outcome: null, when: null, isPast: false };

const roofing = [ran, ran, noShow, overdue, overdue, upcoming, unscheduled];

describe("buildOutcomeFilters", () => {
  it("puts All first, then Not ran, outcomes, then the nothing-to-record states", () => {
    expect(buildOutcomeFilters(roofing).map((f) => f.label)).toEqual([
      "All",
      "Not ran",
      "Ran",
      "No Show",
      "Upcoming",
      "Unscheduled",
    ]);
  });

  it("counts every row exactly once across the non-All filters", () => {
    const filters = buildOutcomeFilters(roofing);
    const all = filters.find((f) => f.key === ALL_OUTCOMES)!;
    const rest = filters.filter((f) => f.key !== ALL_OUTCOMES);
    expect(all.count).toBe(roofing.length);
    expect(rest.reduce((sum, f) => sum + f.count, 0)).toBe(roofing.length);
  });

  it("orders outcomes by frequency, then alphabetically", () => {
    const rows = [
      { outcome: "Zeta", when: "d", isPast: true },
      { outcome: "Alpha", when: "d", isPast: true },
      { outcome: "Common", when: "d", isPast: true },
      { outcome: "Common", when: "d", isPast: true },
    ];
    expect(buildOutcomeFilters(rows).map((f) => f.label)).toEqual(["All", "Common", "Alpha", "Zeta"]);
  });

  // Solar records entirely different outcomes; the filters must follow the data.
  it("derives solar's vocabulary with no code change", () => {
    const solar = [
      { outcome: "Signed — proposal accepted", when: "d", isPast: true },
      { outcome: "Credit not approved", when: "d", isPast: true },
      { outcome: null, when: "d", isPast: true },
    ];
    expect(buildOutcomeFilters(solar).map((f) => f.label)).toEqual([
      "All",
      "Not ran",
      "Credit not approved",
      "Signed — proposal accepted",
    ]);
  });

  it("drops filters that would match nothing, but always keeps All", () => {
    expect(buildOutcomeFilters([]).map((f) => f.label)).toEqual(["All"]);
    expect(buildOutcomeFilters([ran]).map((f) => f.label)).toEqual(["All", "Ran"]);
  });
});

describe("matchesOutcomeFilter", () => {
  it("All matches everything", () => {
    for (const row of roofing) expect(matchesOutcomeFilter(row, ALL_OUTCOMES)).toBe(true);
  });

  // The whole point of the chase list: tomorrow's appointment is not a data gap.
  it("Not ran is past-and-unlogged only — never an upcoming appointment", () => {
    expect(matchesOutcomeFilter(overdue, NOT_RAN)).toBe(true);
    expect(matchesOutcomeFilter(upcoming, NOT_RAN)).toBe(false);
    expect(matchesOutcomeFilter(unscheduled, NOT_RAN)).toBe(false);
    expect(matchesOutcomeFilter(ran, NOT_RAN)).toBe(false);
  });

  it("Upcoming is future-and-unlogged", () => {
    expect(matchesOutcomeFilter(upcoming, UPCOMING)).toBe(true);
    expect(matchesOutcomeFilter(overdue, UPCOMING)).toBe(false);
  });

  // A logged outcome wins over timing — a rep who logs early still shows as logged.
  it("an outcome filter matches that exact label, regardless of timing", () => {
    expect(matchesOutcomeFilter(ran, "Ran")).toBe(true);
    expect(matchesOutcomeFilter(noShow, "Ran")).toBe(false);
    expect(matchesOutcomeFilter({ outcome: "Ran", when: "Aug 9", isPast: false }, "Ran")).toBe(true);
  });

  it("Unscheduled means no date", () => {
    expect(matchesOutcomeFilter(unscheduled, UNSCHEDULED)).toBe(true);
    expect(matchesOutcomeFilter(overdue, UNSCHEDULED)).toBe(false);
  });

  it("partitions the rows — every row matches exactly one non-All filter", () => {
    const keys = buildOutcomeFilters(roofing)
      .filter((f) => f.key !== ALL_OUTCOMES)
      .map((f) => f.key);
    for (const row of roofing) {
      expect(keys.filter((k) => matchesOutcomeFilter(row, k))).toHaveLength(1);
    }
  });
});
