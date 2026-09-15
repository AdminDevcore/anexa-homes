import { describe, it, expect } from "vitest";
import {
  VPP_DEFAULT_MAX_BATTERIES,
  vppCreditCents,
  vppPaidBatteryCount,
} from "@/lib/solar-provider-terms";

/**
 * THE BATTERY PROGRAMME HAS A CEILING.
 *
 * The business rule: $200 per battery per year, at most six batteries, at most
 * $1,200 a year. `resolveVppCredits` multiplied the rate by the design's raw
 * count with no clamp at all, so a ten-battery design quoted $2,000 a year — on
 * the customer's own signed proposal, under a twenty-five-year projection built
 * on that figure.
 *
 * The rate is per-provider data and the ceiling now is too, defaulting to six.
 */

const RATE = 20_000; // $200 a battery a year
const rebate = (qty: unknown, maxBatteries?: number | null) =>
  vppCreditCents({
    perBatteryCents: RATE,
    paidBatteries: vppPaidBatteryCount({ batteryQty: qty as number, maxBatteries }),
  });

describe("the quantity table, exactly as specified", () => {
  it.each([
    [0, 20_000], // untyped-but-chosen reads as one — see vppPaidBatteryCount
    [1, 20_000],
    [2, 40_000],
    [3, 60_000],
    [4, 80_000],
    [5, 100_000],
    [6, 120_000],
    [7, 120_000], // capped
    [10, 120_000], // capped
    [100, 120_000], // capped
  ])("%i batteries earns $%i (cents)", (qty, expected) => {
    expect(rebate(qty)).toBe(expected);
  });

  it("never pays more than $1,200 a year, whatever is posted", () => {
    for (const qty of [7, 8, 12, 50, 1000, 1e9]) {
      expect(rebate(qty)).toBeLessThanOrEqual(120_000);
    }
  });

  it("caps the count itself, not merely the money", () => {
    // The count is printed beside the figure and the customer's card divides by
    // it to show a per-battery rate — so a capped deal must not advertise
    // $1,200 ÷ 10 = $120 a battery for a programme that publishes $200.
    expect(vppPaidBatteryCount({ batteryQty: 10 })).toBe(6);
    expect(rebate(10) / vppPaidBatteryCount({ batteryQty: 10 })).toBe(RATE);
  });
});

describe("hostile and malformed quantities", () => {
  it("earns nothing on a NEGATIVE count", () => {
    // It used to floor to one, which paid a rebate on nonsense.
    expect(vppPaidBatteryCount({ batteryQty: -1 })).toBe(0);
    expect(rebate(-1)).toBe(0);
    expect(rebate(-100)).toBe(0);
  });

  it("earns nothing on null, undefined, NaN or Infinity", () => {
    for (const bad of [null, undefined, NaN, Infinity, -Infinity]) {
      expect(vppPaidBatteryCount({ batteryQty: bad as number })).toBe(0);
      expect(rebate(bad)).toBe(0);
    }
  });

  it("earns nothing on a string, however numeric it looks", () => {
    // A count arrives from JSON a caller can post. "6" is not 6.
    for (const bad of ["6", "", "six", {}, [], true]) {
      expect(vppPaidBatteryCount({ batteryQty: bad as unknown as number })).toBe(0);
    }
  });

  it("FLOORS a fraction rather than rounding it up", () => {
    // Half a battery is not installed, and rounding up quotes money for
    // hardware nobody is fitting.
    expect(vppPaidBatteryCount({ batteryQty: 2.9 })).toBe(2);
    expect(rebate(2.9)).toBe(40_000);
    expect(vppPaidBatteryCount({ batteryQty: 6.9 })).toBe(6);
  });

  it("cannot be pushed over the ceiling by a tampered maximum", () => {
    // A ceiling is a rule about the programme, so it is read off the provider
    // row — never off the request. This asserts the clamp behaves for the
    // values an admin could type.
    expect(vppPaidBatteryCount({ batteryQty: 10, maxBatteries: 0 })).toBe(0);
    expect(vppPaidBatteryCount({ batteryQty: 10, maxBatteries: -5 })).toBe(0);
    expect(vppPaidBatteryCount({ batteryQty: 10, maxBatteries: 2.7 })).toBe(2);
  });
});

describe("the rate itself", () => {
  it("pays nothing when the programme has no rate on file", () => {
    for (const rate of [null, undefined, 0, -100, NaN]) {
      expect(vppCreditCents({ perBatteryCents: rate as number, paidBatteries: 4 })).toBe(0);
    }
  });

  it("honours a programme that publishes something other than $200", () => {
    // The ceiling and the rate are both the provider's own, which is why
    // neither is a constant in the code.
    expect(vppCreditCents({ perBatteryCents: 25_000, paidBatteries: 6 })).toBe(150_000);
  });
});

describe("the default ceiling", () => {
  it("is six, which is the $1,200 rule at the $200 rate", () => {
    expect(VPP_DEFAULT_MAX_BATTERIES).toBe(6);
    expect(RATE * VPP_DEFAULT_MAX_BATTERIES).toBe(120_000);
  });

  it("applies when a provider has stated no ceiling of its own", () => {
    expect(vppPaidBatteryCount({ batteryQty: 99, maxBatteries: null })).toBe(6);
    expect(vppPaidBatteryCount({ batteryQty: 99, maxBatteries: undefined })).toBe(6);
  });

  it("gives way to a provider that has", () => {
    expect(vppPaidBatteryCount({ batteryQty: 99, maxBatteries: 3 })).toBe(3);
    expect(vppPaidBatteryCount({ batteryQty: 99, maxBatteries: 12 })).toBe(12);
  });
});
