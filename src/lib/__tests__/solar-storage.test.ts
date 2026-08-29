import { describe, it, expect } from "vitest";
import {
  usableKwh,
  backupHours,
  backupTable,
  touSavings,
  type BackupProfile,
  type TouAssumptions,
} from "@/lib/solar-storage";

const PROFILES: BackupProfile[] = [
  { id: "a", name: "Essentials", loadWatts: 1000, rank: 0 },
  { id: "b", name: "Essentials + AC", loadWatts: 3500, rank: 1 },
  { id: "c", name: "Whole home", loadWatts: 5000, rank: 2 },
];

const TOU: TouAssumptions = { peakSharePct: 30, cyclesPerDay: 1, roundTripEfficiencyPct: 90 };

describe("usableKwh", () => {
  it("reads watt-hours off the catalogue row", () => {
    // SolarEquipment.ratingW holds Wh on a battery: "Powerwall 3 · 13500Wh".
    expect(usableKwh(13_500, 2)).toBe(27);
    expect(usableKwh(13_500, 1)).toBe(13.5);
  });

  it("is zero when there is no battery or no count", () => {
    expect(usableKwh(null, 2)).toBe(0);
    expect(usableKwh(undefined, 2)).toBe(0);
    expect(usableKwh(0, 2)).toBe(0);
    expect(usableKwh(13_500, 0)).toBe(0);
    expect(usableKwh(13_500, -1)).toBe(0);
  });
});

describe("backupHours", () => {
  it("divides capacity by the load", () => {
    expect(backupHours(27, 1000)).toBeCloseTo(27, 5);
    expect(backupHours(27, 3500)).toBeCloseTo(7.714, 3);
  });

  it("returns null rather than Infinity on a zero load", () => {
    expect(backupHours(27, 0)).toBeNull();
    expect(backupHours(27, -1)).toBeNull();
  });
});

describe("backupTable", () => {
  it("comes back in rank order, lowest load first", () => {
    const rows = backupTable(27, [...PROFILES].reverse());
    expect(rows.map((r) => r.name)).toEqual(["Essentials", "Essentials + AC", "Whole home"]);
    expect(rows[0].hours).toBeCloseTo(27, 5);
  });

  it("is empty when nothing is stored, so the chapter is omitted not zeroed", () => {
    expect(backupTable(0, PROFILES)).toEqual([]);
  });

  it("drops a profile with no load rather than printing an infinite runtime", () => {
    const rows = backupTable(27, [...PROFILES, { id: "d", name: "Broken", loadWatts: 0, rank: 9 }]);
    expect(rows).toHaveLength(3);
  });
});

describe("touSavings", () => {
  it("shifts what the battery holds, capped by what the peak window uses", () => {
    // 12,000 kWh/yr, 30% in peak = 9.863 kWh/day of peak usage.
    // 27 kWh of storage exceeds that, so peak usage is the binding limit.
    // 9.863 x 365 x ($0.24 - $0.09) x 0.90 = $486.00
    const r = touSavings({
      usableKwh: 27,
      annualUsageKwh: 12_000,
      peakRateMills: 240,
      offPeakRateMills: 90,
      ...TOU,
    });
    expect(r).not.toBeNull();
    expect(r!.shiftedKwhPerDay).toBeCloseTo(9.863, 2);
    expect(r!.annualSavingsCents).toBe(48_600);
  });

  it("is capped by the battery on a house that uses more than it holds", () => {
    const r = touSavings({
      usableKwh: 5,
      annualUsageKwh: 40_000,
      peakRateMills: 240,
      offPeakRateMills: 90,
      ...TOU,
    });
    expect(r!.shiftedKwhPerDay).toBe(5);
  });

  it("cycles the battery more than once when the company says so", () => {
    const once = touSavings({
      usableKwh: 5, annualUsageKwh: 40_000, peakRateMills: 240, offPeakRateMills: 90, ...TOU,
    });
    const twice = touSavings({
      usableKwh: 5, annualUsageKwh: 40_000, peakRateMills: 240, offPeakRateMills: 90,
      ...TOU, cyclesPerDay: 2,
    });
    // Within a cent, not exactly double: the figure is rounded once at the end,
    // so doubling a rounded number and rounding a doubled one differ by a cent.
    // Rounding once is the correct half of that pair.
    expect(Math.abs(twice!.annualSavingsCents - once!.annualSavingsCents * 2)).toBeLessThanOrEqual(1);
  });

  it("is NULL, never zero, when a rate is missing", () => {
    expect(
      touSavings({ usableKwh: 27, annualUsageKwh: 12_000, peakRateMills: null, offPeakRateMills: 90, ...TOU })
    ).toBeNull();
    expect(
      touSavings({ usableKwh: 27, annualUsageKwh: 12_000, peakRateMills: 240, offPeakRateMills: null, ...TOU })
    ).toBeNull();
  });

  it("is NULL when the spread is zero or inverted — there is nothing to arbitrage", () => {
    expect(
      touSavings({ usableKwh: 27, annualUsageKwh: 12_000, peakRateMills: 90, offPeakRateMills: 90, ...TOU })
    ).toBeNull();
    expect(
      touSavings({ usableKwh: 27, annualUsageKwh: 12_000, peakRateMills: 80, offPeakRateMills: 90, ...TOU })
    ).toBeNull();
  });

  it("is NULL with no storage and with no usage on file", () => {
    expect(
      touSavings({ usableKwh: 0, annualUsageKwh: 12_000, peakRateMills: 240, offPeakRateMills: 90, ...TOU })
    ).toBeNull();
    expect(
      touSavings({ usableKwh: 27, annualUsageKwh: 0, peakRateMills: 240, offPeakRateMills: 90, ...TOU })
    ).toBeNull();
  });
});
