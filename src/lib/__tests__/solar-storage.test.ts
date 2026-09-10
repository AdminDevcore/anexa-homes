import { describe, it, expect } from "vitest";
import {
  autoBatteryCount,
  usableKwh,
  backupHours,
  wholeHomeBackup,
  touSavings,
  type TouAssumptions,
} from "@/lib/solar-storage";

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

describe("autoBatteryCount", () => {
  const POWERWALL = 13_500;

  it("carries the worked example the setting is written from", () => {
    // 20,000 kWh ÷ 365 = 54.79/day, × 55% = 30.14 kWh of night load.
    // Against a 13.5 kWh Powerwall that is 2.23 units, so three.
    const sized = autoBatteryCount({
      basisKwh: 20_000,
      nightSharePct: 55,
      batteryRatingWh: POWERWALL,
    });
    expect(sized).not.toBeNull();
    expect(sized!.qty).toBe(3);
    expect(sized!.nightKwhPerDay).toBeCloseTo(30.14, 2);
    expect(sized!.coveredKwh).toBeCloseTo(40.5, 2);
    expect(sized!.capped).toBe(false);
  });

  it("counts by the battery, not by the system", () => {
    // The same 40 kWh night load, quoted on two different products: one unit
    // that covers it whole, or four small ones that add up to the same.
    const big = autoBatteryCount({
      basisKwh: 26_545,
      nightSharePct: 55,
      batteryRatingWh: 40_000,
    });
    const small = autoBatteryCount({
      basisKwh: 26_545,
      nightSharePct: 55,
      batteryRatingWh: 10_000,
    });
    expect(big!.nightKwhPerDay).toBeCloseTo(40.0, 1);
    expect(big!.qty).toBe(1);
    expect(small!.qty).toBe(4);
  });

  it("rounds up — a partial battery is not something anybody installs", () => {
    const qty = (basisKwh: number) =>
      autoBatteryCount({ basisKwh, nightSharePct: 55, batteryRatingWh: POWERWALL })!.qty;

    // 2.00 exactly: 27 kWh of night load off a 13.5 kWh unit.
    expect(qty((27 / 0.55) * 365)).toBe(2);
    // A hair over two still costs a third unit. That is the point of the rule:
    // the night is covered or it is not.
    expect(qty((27.1 / 0.55) * 365)).toBe(3);
    expect(qty((39.9 / 0.55) * 365)).toBe(3);
    expect(qty((40.6 / 0.55) * 365)).toBe(4);
  });

  it("never sizes below one battery", () => {
    // A tiny array on a big battery still needs the battery it is quoting.
    const sized = autoBatteryCount({
      basisKwh: 400,
      nightSharePct: 55,
      batteryRatingWh: 40_000,
    });
    expect(sized!.qty).toBe(1);
  });

  it("stops at the cap and says it did", () => {
    // Usage typed in watt-hours instead of kilowatt-hours is the realistic way
    // this happens, and it must not quote a hundred batteries.
    const sized = autoBatteryCount({
      basisKwh: 20_000_000,
      nightSharePct: 55,
      batteryRatingWh: POWERWALL,
    });
    expect(sized!.qty).toBe(20);
    expect(sized!.capped).toBe(true);
  });

  it("honours a caller's own ceiling", () => {
    const sized = autoBatteryCount({
      basisKwh: 100_000,
      nightSharePct: 55,
      batteryRatingWh: POWERWALL,
      maxQty: 4,
    });
    expect(sized!.qty).toBe(4);
    expect(sized!.capped).toBe(true);
  });

  it("is null, not one, when there is nothing to size from", () => {
    // Every one of these leaves the deal's existing count alone. Answering "1"
    // would halve a real system the moment a figure went briefly missing.
    expect(
      autoBatteryCount({ basisKwh: 0, nightSharePct: 55, batteryRatingWh: POWERWALL })
    ).toBeNull();
    expect(
      autoBatteryCount({ basisKwh: null, nightSharePct: 55, batteryRatingWh: POWERWALL })
    ).toBeNull();
    expect(
      autoBatteryCount({ basisKwh: 20_000, nightSharePct: 55, batteryRatingWh: null })
    ).toBeNull();
    expect(
      autoBatteryCount({ basisKwh: 20_000, nightSharePct: 55, batteryRatingWh: 0 })
    ).toBeNull();
  });

  it("is null when the night share is not a share", () => {
    const bad = (nightSharePct: number | null) =>
      autoBatteryCount({ basisKwh: 20_000, nightSharePct, batteryRatingWh: POWERWALL });
    expect(bad(0)).toBeNull();
    expect(bad(-10)).toBeNull();
    expect(bad(101)).toBeNull();
    expect(bad(null)).toBeNull();
    expect(bad(100)).not.toBeNull();
  });
});

describe("wholeHomeBackup", () => {
  // Two Powerwalls, the reference stack this company quotes most.
  const KWH = 27;

  it("carries the worked example the setting is written from", () => {
    // 15,000 kWh ÷ 8760 h = 1712 W average. × 1.3 = 2226 W while the grid is
    // down, and 27 kWh divided by that is a little over twelve hours.
    const b = wholeHomeBackup({ usableKwh: KWH, annualUsageKwh: 15_000, outageDrawFactor: 1.3 });
    expect(b).not.toBeNull();
    expect(b!.averageLoadWatts).toBeCloseTo(1712.3, 1);
    expect(b!.loadWatts).toBeCloseTo(2226.0, 1);
    expect(b!.hours).toBeCloseTo(12.13, 2);
  });

  it("gives a bigger house fewer hours off the same battery", () => {
    // The whole reason the profile list went away: one company-wide wattage
    // told a 900 sq ft condo and a 4,000 sq ft house the same thing.
    const small = wholeHomeBackup({ usableKwh: KWH, annualUsageKwh: 9_000, outageDrawFactor: 1.3 });
    const big = wholeHomeBackup({ usableKwh: KWH, annualUsageKwh: 30_000, outageDrawFactor: 1.3 });
    expect(small!.hours).toBeGreaterThan(big!.hours);
    // And the ratio is the ratio of the usage, because nothing else differs.
    expect(small!.hours / big!.hours).toBeCloseTo(30_000 / 9_000, 6);
  });

  it("treats a factor of 1 as the plain average, no margin", () => {
    const b = wholeHomeBackup({ usableKwh: KWH, annualUsageKwh: 15_000, outageDrawFactor: 1 });
    expect(b!.loadWatts).toBeCloseTo(b!.averageLoadWatts, 6);
  });

  it("is null with no storage, so the chapter omits itself", () => {
    expect(
      wholeHomeBackup({ usableKwh: 0, annualUsageKwh: 15_000, outageDrawFactor: 1.3 })
    ).toBeNull();
  });

  it("is null with no usage on file rather than quoting an endless runtime", () => {
    // A zero draw divides into infinity. "∞ hours of backup" on a customer's
    // proposal is a worse way to discover a blank Energy step than the line
    // simply not being there.
    for (const usage of [null, undefined, 0]) {
      expect(wholeHomeBackup({ usableKwh: KWH, annualUsageKwh: usage, outageDrawFactor: 1.3 })).toBeNull();
    }
  });

  it("is null when the factor is missing or not a multiplier", () => {
    for (const factor of [null, undefined, 0, -1]) {
      expect(
        wholeHomeBackup({ usableKwh: KWH, annualUsageKwh: 15_000, outageDrawFactor: factor })
      ).toBeNull();
    }
  });
});
