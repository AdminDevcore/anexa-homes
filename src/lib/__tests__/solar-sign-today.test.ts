import { describe, it, expect } from "vitest";
import { resolveSignToday, SIGN_TODAY_MAX_CENTS } from "../solar-sign-today";

/**
 * The rule under test throughout: WHO decides the figure, and over what.
 *
 * The worked example is the Amos-shaped deal — a 12.76 kW array whose system
 * price is $70,180 at $5.50/W, with $120,000 of storage riding on top at
 * catalogue price. Every "above a cap" case has to come out of the ARRAY, or
 * the battery becomes the discount.
 */
const WATTS = 12_760;
const SYSTEM = 70_180_00;

const resolve = (
  rule: Parameters<typeof resolveSignToday>[0]["rule"],
  typedCents = 0,
  over: Partial<Parameters<typeof resolveSignToday>[0]> = {}
) => resolveSignToday({ rule, systemPriceCents: SYSTEM, systemWatts: WATTS, typedCents, ...over });

describe("no rule — the rep's own figure", () => {
  it("hands back what he typed", () => {
    const r = resolve({ mode: "none", fixedCents: null, capPpwCents: null }, 1_500_00);
    expect(r.cents).toBe(1_500_00);
    expect(r.source).toBe("typed");
    expect(r.editable).toBe(true);
  });

  it("treats a lender with no rule at all the same as `none`", () => {
    expect(resolve(null, 2_000_00).cents).toBe(2_000_00);
    expect(resolve(undefined, 2_000_00).editable).toBe(true);
  });

  it("never lets a negative or a NaN reach a household's page", () => {
    expect(resolve(null, -5_000_00).cents).toBe(0);
    expect(resolve(null, Number.NaN).cents).toBe(0);
  });

  it("holds the ceiling", () => {
    expect(resolve(null, 999_999_00).cents).toBe(SIGN_TODAY_MAX_CENTS);
  });
});

describe("fixed — the partner's own offer", () => {
  const FIXED = { mode: "fixed" as const, fixedCents: 1_000_00, capPpwCents: null };

  it("gives the partner's figure on every deal, whatever the rep typed", () => {
    const r = resolve(FIXED, 7_500_00);
    expect(r.cents).toBe(1_000_00);
    expect(r.source).toBe("lender_fixed");
    // Not the rep's to change, and not his to remove.
    expect(r.editable).toBe(false);
  });

  it("gives nothing when the partner is half configured", () => {
    const r = resolve({ mode: "fixed", fixedCents: null, capPpwCents: null }, 3_000_00);
    // NOT the typed figure: that would put a rep's own discount on screen
    // under a partner's name.
    expect(r.cents).toBe(0);
    expect(r.editable).toBe(false);
  });
});

describe("above a cap — whatever the system is priced over it", () => {
  const cap = (capPpwCents: number | null) =>
    ({ mode: "above_cap" as const, fixedCents: null, capPpwCents });

  it("is the excess over the cap, on the array alone", () => {
    // $5.00/W of a $5.50/W system: fifty cents a watt, over 12,760 W.
    const r = resolve(cap(500), 0);
    expect(r.cents).toBe(6_380_00);
    expect(r.source).toBe("above_cap");
    expect(r.editable).toBe(false);
    expect(r.capPpwCents).toBe(500);
  });

  it("gives nothing when the deal is priced at or under the cap", () => {
    expect(resolve(cap(550)).cents).toBe(0);
    expect(resolve(cap(600)).cents).toBe(0);
  });

  it("ignores the battery entirely", () => {
    // The same call with storage on the job is the same credit: the system
    // price passed in is the array, and a $120,000 Powerwall order is not a
    // $120,000 discount.
    const withStorage = resolveSignToday({
      rule: cap(500),
      systemPriceCents: SYSTEM,
      systemWatts: WATTS,
      typedCents: 0,
    });
    expect(withStorage.cents).toBe(6_380_00);
  });

  it("ignores whatever the rep typed", () => {
    expect(resolve(cap(500), 25_000_00).cents).toBe(6_380_00);
  });

  it("gives nothing on a storage-only job, which has no watts to be per", () => {
    const r = resolve(cap(500), 0, { systemWatts: 0, systemPriceCents: 0 });
    expect(r.cents).toBe(0);
  });

  it("gives nothing when the partner set a mode but no cap", () => {
    expect(resolve(cap(null), 4_000_00).cents).toBe(0);
  });

  it("holds the ceiling on a derived figure too", () => {
    // A cap of a cent a watt on this system would derive over $70,000.
    expect(resolve(cap(1)).cents).toBeLessThanOrEqual(SIGN_TODAY_MAX_CENTS);
  });
});
