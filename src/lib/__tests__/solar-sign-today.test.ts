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
const BATTERY = 120_000_00;

/** The company's percentages, as they stand in statute. */
const RATES = { itcPct: 30, energyCommunityPct: 10, domesticContentPct: 10 };
/** All three earned — the 50% this deal actually claims. */
const ALL = { itc: true, energyCommunity: true, domesticContent: true };
/** Nothing earned. The household pays the sticker. */
const NONE = { itc: false, energyCommunity: false, domesticContent: false };

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

  it("counts the storage on the job, which the household also pays for", () => {
    // The battery is hardware the customer signs for, and on a deal whose
    // whole point is landing them on a per-watt figure it cannot sit outside
    // the measurement. With no credits claimed the household owes the sticker,
    // so the whole $120,000 is above a $5.00/W cap and the ceiling catches it.
    const withStorage = resolve(cap(500), 0, { batteryPriceCents: BATTERY });
    expect(withStorage.cents).toBe(SIGN_TODAY_MAX_CENTS);
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

/**
 * THE CAP IS MEASURED ON WHAT THE HOUSEHOLD ACTUALLY NETS.
 *
 * The worked deal is the one on the screen this rule was written for: a
 * 12.76 kW array pinned at $5.50/W by Amos's flat price, $120,000 of storage
 * riding on top at catalogue, and all three federal credits earned.
 *
 *     array                        $70,180
 *   + battery                     $120,000
 *   = price                       $190,180
 *   − credits, 50%                 $95,090
 *   = what the household nets      $95,090   ($7.45 a watt)
 *   − 12.76 kW at the $5.50 cap    $70,180
 *   = handed back                  $24,910
 *
 * ADDERS ARE NOT IN IT, and cannot be: `systemPriceCents` is the array at
 * sticker and the adders were never passed. They raise the price and stay
 * raised, which is the exception the rule was asked for.
 */
describe("above a cap — measured after the credits the job claims", () => {
  const cap = (capPpwCents: number | null) =>
    ({ mode: "above_cap" as const, fixedCents: null, capPpwCents });

  const amos = (claims: typeof ALL) =>
    resolve(cap(550), 0, {
      batteryPriceCents: BATTERY,
      creditRates: RATES,
      creditClaims: claims,
    });

  it("hands back what the net cost exceeds the cap by", () => {
    expect(amos(ALL).cents).toBe(24_910_00);
  });

  it("hands back more when the job claims fewer credits", () => {
    // Only the base 30%: the household nets $133,126, which is $62,946 over
    // the $70,180 the cap allows.
    const itcOnly = amos({ itc: true, energyCommunity: false, domesticContent: false });
    expect(itcOnly.cents).toBe(62_946_00);
  });

  it("measures the sticker itself when the job claims nothing", () => {
    // $190,180 against a $70,180 allowance is $120,000 — past the ceiling,
    // which is the only thing standing between this rule and a free battery.
    expect(amos(NONE).cents).toBe(SIGN_TODAY_MAX_CENTS);
  });

  it("gives nothing when the net cost lands at or under the cap", () => {
    // The array alone, credits claimed: $70,180 nets $35,090, which is half
    // the allowance. No storage, nothing over.
    const arrayOnly = resolve(cap(550), 0, {
      batteryPriceCents: 0,
      creditRates: RATES,
      creditClaims: ALL,
    });
    expect(arrayOnly.cents).toBe(0);
  });

  it("gives nothing on a storage-only job, which has no watts to be per", () => {
    // Unchanged, and load-bearing: with no watts there is no allowance for the
    // battery to be measured against, and every cent of it would be handed back.
    const r = resolve(cap(550), 0, {
      systemWatts: 0,
      systemPriceCents: 0,
      batteryPriceCents: BATTERY,
      creditRates: RATES,
      creditClaims: ALL,
    });
    expect(r.cents).toBe(0);
  });

  it("treats absent credits as none claimed, so an unwired caller quotes the sticker", () => {
    const r = resolve(cap(550), 0, { batteryPriceCents: BATTERY });
    expect(r.cents).toBe(SIGN_TODAY_MAX_CENTS);
  });

  it("gives nothing when the stated percentages take the whole price", () => {
    const r = resolve(cap(550), 0, {
      batteryPriceCents: BATTERY,
      creditRates: { itcPct: 60, energyCommunityPct: 30, domesticContentPct: 30 },
      creditClaims: ALL,
    });
    expect(r.cents).toBe(0);
  });
});

describe("the credits do not reach the other two rules", () => {
  it("leaves a fixed partner's own figure alone", () => {
    const r = resolve({ mode: "fixed", fixedCents: 1_000_00, capPpwCents: null }, 0, {
      batteryPriceCents: BATTERY,
      creditRates: RATES,
      creditClaims: ALL,
    });
    expect(r.cents).toBe(1_000_00);
  });

  it("leaves the rep's typed figure alone", () => {
    const r = resolve(null, 1_500_00, {
      batteryPriceCents: BATTERY,
      creditRates: RATES,
      creditClaims: ALL,
    });
    expect(r.cents).toBe(1_500_00);
  });
});
