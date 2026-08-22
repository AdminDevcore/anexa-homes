import { describe, it, expect } from "vitest";
import {
  annualFromMonthlyKwh,
  annualUsageFromBill,
  effectiveUsageKwh,
  monthlyBillFromUsage,
  resolveUtilityRateMills,
} from "@/lib/solar-energy";

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

/**
 * The consumption the array is actually sized against.
 *
 * The bill figure is what the house uses today; the EV charger on this contract
 * is what it will use tomorrow. Offset divides by the sum, and getting that
 * wrong shows a homeowner a coverage nobody sized for.
 */
describe("effectiveUsageKwh", () => {
  it("adds the adjustment to the bill figure", () => {
    expect(effectiveUsageKwh(12_000, 3_000)).toBe(15_000);
  });

  it("is the bill figure alone when nothing was added", () => {
    expect(effectiveUsageKwh(12_000, 0)).toBe(12_000);
    expect(effectiveUsageKwh(12_000, null)).toBe(12_000);
    expect(effectiveUsageKwh(12_000, undefined)).toBe(12_000);
  });

  it("is zero — not NaN — when usage was never captured", () => {
    expect(effectiveUsageKwh(null, null)).toBe(0);
    expect(effectiveUsageKwh(undefined, 3_000)).toBe(3_000);
  });

  it("ignores a negative on either side rather than subtracting", () => {
    expect(effectiveUsageKwh(-5, 3_000)).toBe(3_000);
    expect(effectiveUsageKwh(12_000, -3_000)).toBe(12_000);
  });
});
