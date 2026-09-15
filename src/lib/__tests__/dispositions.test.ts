import { describe, it, expect } from "vitest";
import {
  DEFAULT_APPOINTMENT_DISPOSITIONS,
  DEFAULT_SOLAR_APPOINTMENT_DISPOSITIONS,
  inferCountsAs,
  outcomeCategory,
  parseDispositions,
} from "@/lib/dispositions";

describe("inferCountsAs", () => {
  it.each([
    ["No show — nobody home", "not_ran"],
    ["No-show", "not_ran"],
    ["Homeowner not home", "not_ran"],
    ["Cancelled before arrival", "cancelled"],
    ["Customer canceled", "cancelled"],
    ["Rescheduled", "rescheduled"],
    ["Rescheduled — no show", "rescheduled"],
    ["Signed — proposal accepted", "ran"],
    ["Not interested", "ran"],
    ["Homeowner Not Interested", "ran"],
    ["Renter / not the owner", "ran"],
    ["No Damage", "ran"],
  ])("%s → %s", (label, expected) => {
    expect(inferCountsAs(label)).toBe(expected);
  });
});

describe("parseDispositions", () => {
  it("infers a category for a legacy string list", () => {
    expect(parseDispositions(["Signed", "No show"])).toEqual([
      { group: null, label: "Signed", countsAs: "ran" },
      { group: null, label: "No show", countsAs: "not_ran" },
    ]);
  });

  it("infers for a stored object saved before categories existed", () => {
    expect(parseDispositions([{ group: "Didn't run", label: "Cancelled before arrival" }])).toEqual([
      { group: "Didn't run", label: "Cancelled before arrival", countsAs: "cancelled" },
    ]);
  });

  // A company may decide a no-show still counts as a sit. Its choice wins.
  it("keeps an explicit countsAs over the wording", () => {
    expect(parseDispositions([{ group: null, label: "No show", countsAs: "ran" }])[0].countsAs).toBe("ran");
  });

  it("ignores an unknown countsAs and falls back to the wording", () => {
    expect(parseDispositions([{ group: null, label: "No show", countsAs: "maybe" }])[0].countsAs).toBe(
      "not_ran"
    );
  });
});

describe("outcomeCategory", () => {
  const list = parseDispositions([{ group: null, label: "No show", countsAs: "ran" }]);

  it("uses the configured category, case-insensitively", () => {
    expect(outcomeCategory("no show", list)).toBe("ran");
  });

  it("falls back to the wording for an outcome no longer configured", () => {
    expect(outcomeCategory("Cancelled before arrival", list)).toBe("cancelled");
  });
});

describe("default lists", () => {
  it("solar can record every category out of the box", () => {
    const cats = new Set(DEFAULT_SOLAR_APPOINTMENT_DISPOSITIONS.map((d) => d.countsAs));
    expect([...cats].sort()).toEqual(["cancelled", "not_ran", "ran", "rescheduled"]);
  });

  // Solar only: the roofing picker must offer exactly what it offered before.
  it("roofing keeps the same twelve labels in the same order", () => {
    expect(DEFAULT_APPOINTMENT_DISPOSITIONS.map((d) => d.label)).toEqual([
      "Hail Damage",
      "Wind Damage",
      "Mixed Storm Damage",
      "Adjuster Needed",
      "Retail Roof",
      "Retail Gutters",
      "Retail Exterior",
      "No Damage",
      "Too New",
      "Existing Contractor",
      "Homeowner Not Interested",
      "Bad Lead",
    ]);
  });
});
