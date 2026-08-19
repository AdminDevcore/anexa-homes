import { describe, it, expect } from "vitest";
import {
  annualFromMonthlyKwh,
  annualUsageFromBill,
  monthlyBillFromUsage,
  resolveUtilityRateMills,
  targetSystem,
} from "@/lib/solar-energy";

const A = { kwhPerKwYear: 1450, derateFactor: 0.84, targetOffsetPct: 100 };

describe("usage from a bill and a rate", () => {
  it("turns $200 a month at $0.20/kWh into 12,000 kWh a year", () => {
    // 20,000 cents ÷ 200 mills = 1,000 kWh a month.
    expect(annualUsageFromBill(20_000, 200)).toBe(12_000);
  });

  it("refuses to divide by a rate of zero rather than returning Infinity", () => {
    // An Infinity here reaches the offset calculation, which is how a proposal
    // ends up quoting a five-figure percentage.
    expect(annualUsageFromBill(20_000, 0)).toBeNull();
    expect(annualUsageFromBill(20_000, null)).toBeNull();
    expect(annualUsageFromBill(0, 200)).toBeNull();
    expect(annualUsageFromBill(-100, 200)).toBeNull();
  });
});

describe("usage from a typical month", () => {
  it("multiplies by twelve", () => {
    expect(annualFromMonthlyKwh(1_000)).toBe(12_000);
  });

  it("treats nothing as nothing, not as zero usage", () => {
    expect(annualFromMonthlyKwh(0)).toBeNull();
    expect(annualFromMonthlyKwh(NaN)).toBeNull();
    expect(annualFromMonthlyKwh(null)).toBeNull();
  });
});

describe("the bill implied by a usage", () => {
  it("closes the triangle: 12,000 kWh at $0.20 is $200 a month", () => {
    expect(monthlyBillFromUsage(12_000, 200)).toBe(20_000);
  });

  it("round-trips against annualUsageFromBill", () => {
    const usage = annualUsageFromBill(18_000, 154)!;
    expect(monthlyBillFromUsage(usage, 154)).toBeCloseTo(18_000, -2);
  });
});

describe("one rate, one place", () => {
  it("prefers the rate the customer actually told us", () => {
    // The bill and usage imply 154 mills; the rep was told 200.
    expect(
      resolveUtilityRateMills({
        utilityRateMills: 200,
        avgMonthlyBillCents: 18_000,
        annualUsageKwh: 14_000,
      })
    ).toBe(200);
  });

  it("falls back to what the bill implies", () => {
    expect(
      resolveUtilityRateMills({
        utilityRateMills: null,
        avgMonthlyBillCents: 18_000,
        annualUsageKwh: 14_000,
      })
    ).toBe(154);
  });

  it("returns null when neither is derivable, so nothing gets invented", () => {
    expect(
      resolveUtilityRateMills({ utilityRateMills: null, avgMonthlyBillCents: null, annualUsageKwh: 14_000 })
    ).toBeNull();
    expect(
      resolveUtilityRateMills({ utilityRateMills: 0, avgMonthlyBillCents: 0, annualUsageKwh: 0 })
    ).toBeNull();
  });
});

describe("the target system", () => {
  it("sizes 12,000 kWh to about 9.9 kW and 25 panels", () => {
    // 12,000 ÷ (1450 × 0.84) = 9.85 kW ; 9,852W ÷ 400W = 24.6 → 25
    const t = targetSystem({ annualUsageKwh: 12_000, assumptions: A, panelWatts: 400 })!;
    expect(t.kwDc).toBeCloseTo(9.85, 2);
    expect(t.panels).toBe(25);
  });

  it("rounds panels UP, because you cannot install a fifth of one", () => {
    // 11,790 ÷ (1450 × 0.84) = 9.680 kW → 9,680W ÷ 400W = 24.2 panels.
    // Deliberately a fraction BELOW .5: rounding to nearest gives 24 and leaves
    // the house short, which is the bug this pins.
    const t = targetSystem({ annualUsageKwh: 11_790, assumptions: A, panelWatts: 400 })!;
    expect(t.kwDc).toBeCloseTo(9.68, 2);
    expect(t.panels).toBe(25);
  });

  it("follows the company's target offset", () => {
    const at = (targetOffsetPct: number) =>
      targetSystem({ annualUsageKwh: 12_000, assumptions: { ...A, targetOffsetPct }, panelWatts: 400 })!
        .kwDc;
    expect(at(90)).toBeCloseTo(at(100) * 0.9, 6);
    expect(at(110)).toBeCloseTo(at(100) * 1.1, 6);
  });

  it("still gives a kW figure when the catalogue has no default panel", () => {
    // Which is the state production is in today, so this is not hypothetical.
    const t = targetSystem({ annualUsageKwh: 12_000, assumptions: A, panelWatts: null })!;
    expect(t.kwDc).toBeCloseTo(9.85, 2);
    expect(t.panels).toBeNull();
  });

  it("has no target without usage", () => {
    expect(targetSystem({ annualUsageKwh: null, assumptions: A, panelWatts: 400 })).toBeNull();
    expect(targetSystem({ annualUsageKwh: 0, assumptions: A, panelWatts: 400 })).toBeNull();
  });

  it("has no target when the production assumptions are nonsense", () => {
    const broken = { ...A, kwhPerKwYear: 0 };
    expect(targetSystem({ annualUsageKwh: 12_000, assumptions: broken, panelWatts: 400 })).toBeNull();
  });
});
