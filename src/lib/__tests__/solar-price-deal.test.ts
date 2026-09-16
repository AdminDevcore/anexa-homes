import { describe, expect, it } from "vitest";
import { priceDeal } from "@/lib/solar-price-deal";
import { priceStoredPurchase } from "@/lib/solar-money";
import { CREDIT_RATES_DEFAULT } from "@/lib/solar-credit-ladder";

/**
 * `priceDeal()` — the one function for both credit states (§8.3 stage 3).
 *
 * The assertions below are the business model's own arithmetic (§8.1) and the
 * owner's own worked figures for D9, not a restatement of what the code does.
 * Where a figure can be reached two ways it is reached both ways and compared,
 * so the flag and the arithmetic prove each other rather than one asserting the
 * other.
 */

/** 10 kW quoted at $4.00/W, fee already inside that rate. */
const KW10 = {
  product: "loan" as const,
  systemType: "pv" as const,
  systemSizeKwDc: 10,
  baseFinalPpwCents: 400,
  addersInsideRuleCents: 0,
};

const ALL_CREDITS = { rates: CREDIT_RATES_DEFAULT, claims: { itc: true, energyCommunity: true, domesticContent: true } };
const NO_CREDITS = { rates: CREDIT_RATES_DEFAULT, claims: { itc: false, energyCommunity: false, domesticContent: false } };

describe("the ladder, before any credit", () => {
  it("prices base, gross, fee and final exactly as §8.1 states them", () => {
    const d = priceDeal({ ...KW10, dealerFeePct: 25, ...ALL_CREDITS });
    // final = sold $/W × watts, the fee already inside the quoted rate.
    expect(d.finalPriceCents).toBe(4_000_000);
    // base = final less the lender's cut. gross = base + adders + equipment.
    expect(d.baseKeptCents).toBe(3_000_000);
    expect(d.grossPriceCents).toBe(3_000_000);
    expect(d.dealerFeeCents).toBe(1_000_000);
    // final = gross ÷ (1 − fee), to the cent.
    expect(d.finalPriceCents).toBe(Math.round(d.grossPriceCents / (1 - 25 / 100)));
  });

  it("is the same ladder the 25 price sites use today, so Stage 4 moves nothing", () => {
    const mine = priceDeal({ ...KW10, dealerFeePct: 25, addersInsideRuleCents: 250_000, ...ALL_CREDITS });
    const theirs = priceStoredPurchase({
      product: "loan",
      systemSizeKwDc: 10,
      stickerPpwCents: 400,
      dealerFeePct: 25,
      adderTotalCents: 250_000,
      maxFinalPpwCents: null,
    }).breakdown;
    expect(mine.finalPriceCents).toBe(theirs.contractPriceCents);
    expect(mine.baseKeptCents).toBe(theirs.baseKeptCents);
    expect(mine.grossPriceCents).toBe(theirs.grossPriceCents);
    expect(mine.dealerFeeCents).toBe(theirs.dealerFeeCents);
    // The customer's own breakdown still reaches its own total.
    expect(mine.baseFinalCents + mine.addersFinalCents + mine.equipmentFinalCents).toBe(
      mine.finalPriceCents
    );
  });

  it("takes no dealer fee on cash, whatever it is handed", () => {
    const d = priceDeal({ ...KW10, product: "cash", dealerFeePct: 25, ...ALL_CREDITS });
    expect(d.dealerFeeCents).toBe(0);
    expect(d.dealerFeePct).toBe(0);
    expect(d.baseKeptCents).toBe(d.finalPriceCents);
    // No lender, so no partner price rule to report on.
    expect(d.priceRule).toBeNull();
  });
});

describe("both credit states, from one ladder", () => {
  const d = priceDeal({ ...KW10, dealerFeePct: 25, ...ALL_CREDITS, monetizerPayoutRate: 50 });

  it("credits applied: net final = final − credits − sign-today", () => {
    // 30 + 10 + 10 = 50% of the final price.
    expect(d.applied.creditAmountCents).toBe(2_000_000);
    expect(d.applied.netFinalPriceCents).toBe(d.finalPriceCents - 2_000_000);
    // net gross = net final × (1 − fee)
    expect(d.applied.netGrossPriceCents).toBe(Math.round(2_000_000 * 0.75));
  });

  it("credits not applied claims nothing and signs the whole final price", () => {
    expect(d.notApplied.credits).toEqual([]);
    expect(d.notApplied.creditAmountCents).toBe(0);
    expect(d.notApplied.netFinalPriceCents).toBe(d.finalPriceCents);
  });

  it("the lender is asked for the net final — the sign-today credit inside it (D2)", () => {
    const withCredit = priceDeal({
      ...KW10, dealerFeePct: 25, ...ALL_CREDITS, signTodayCreditCents: 150_000,
    });
    expect(withCredit.applied.signTodayCents).toBe(150_000);
    expect(withCredit.applied.lenderAmountCents).toBe(withCredit.applied.netFinalPriceCents);
    expect(withCredit.applied.netFinalPriceCents).toBe(4_000_000 - 2_000_000 - 150_000);
  });

  it("the sign-today credit applies in BOTH states — it is not a federal credit", () => {
    const x = priceDeal({ ...KW10, dealerFeePct: 25, ...ALL_CREDITS, signTodayCreditCents: 150_000 });
    expect(x.notApplied.signTodayCents).toBe(150_000);
    expect(x.notApplied.netFinalPriceCents).toBe(4_000_000 - 150_000);
  });

  it("never returns a negative bottom line, however much a rep types", () => {
    const x = priceDeal({ ...KW10, dealerFeePct: 25, ...ALL_CREDITS, signTodayCreditCents: 999_999_99 });
    expect(x.applied.netFinalPriceCents).toBe(0);
    expect(x.applied.signTodayCents).toBe(2_000_000); // clamped to what was left
  });
});

describe("credits never move commission", () => {
  it("the redline basis is identical with every credit claimed and with none", () => {
    const on = priceDeal({ ...KW10, dealerFeePct: 25, ...ALL_CREDITS });
    const off = priceDeal({ ...KW10, dealerFeePct: 25, ...NO_CREDITS });
    expect(on.baseKeptCents).toBe(off.baseKeptCents);
    expect(on.basePpwCents).toBe(off.basePpwCents);
    expect(on.systemWatts).toBe(off.systemWatts);
    // And the two states of ONE deal cannot differ on it either: the base is
    // not a per-state figure at all, which is what makes this structural.
    expect(on).not.toHaveProperty("applied.baseKeptCents");
  });
});

describe("D9: whether a credit dollar earns or loses, and by how much", () => {
  /** Revenue is reachable two ways; both must agree. */
  const deltaPerCreditDollar = (feePct: number) => {
    const d = priceDeal({ ...KW10, dealerFeePct: feePct, ...ALL_CREDITS, monetizerPayoutRate: 50 });
    const applied = d.applied.revenueCents!;
    const notApplied = d.notApplied.revenueCents!;
    return { d, measured: (applied - notApplied) / d.applied.creditAmountCents };
  };

  it("a 25% fee at a 50% payout LOSES 25 cents per credit dollar", () => {
    const { d, measured } = deltaPerCreditDollar(25);
    expect(d.margin.losesMoneyOnCreditDollars).toBe(true);
    expect(d.margin.creditDollarMarginPct).toBe(-25);
    expect(measured).toBeCloseTo(-0.25, 10);
  });

  it("a 65% fee at a 50% payout GAINS 15 cents per credit dollar", () => {
    const { d, measured } = deltaPerCreditDollar(65);
    expect(d.margin.losesMoneyOnCreditDollars).toBe(false);
    expect(d.margin.creditDollarMarginPct).toBe(15);
    expect(measured).toBeCloseTo(0.15, 10);
  });

  it("an 18% fee at a 50% payout loses 32 cents — the owner's own figure", () => {
    const { d } = deltaPerCreditDollar(18);
    expect(d.margin.creditDollarMarginPct).toBe(-32);
  });

  it("says nothing rather than guessing when no payout rate is supplied", () => {
    const d = priceDeal({ ...KW10, dealerFeePct: 25, ...ALL_CREDITS });
    expect(d.applied.revenueCents).toBeNull();
    expect(d.margin.monetizerPayoutRate).toBeNull();
    expect(d.margin.losesMoneyOnCreditDollars).toBeNull();
  });

  it("revenue = net gross + credit amount × payout", () => {
    const d = priceDeal({ ...KW10, dealerFeePct: 25, ...ALL_CREDITS, monetizerPayoutRate: 50 });
    expect(d.applied.revenueCents).toBe(
      d.applied.netGrossPriceCents + Math.round((d.applied.creditAmountCents * 50) / 100)
    );
  });
});

describe("a storage-only deal climbs the same ladder over batteries", () => {
  const storage = priceDeal({
    product: "loan",
    systemType: "storage",
    systemSizeKwDc: 0,
    baseFinalPpwCents: 0,
    baseFinalPerBatteryCents: 2_400_000,
    batteryQty: 2,
    dealerFeePct: 25,
    addersInsideRuleCents: 0,
    ...ALL_CREDITS,
  });

  it("prices per battery, and reports no per-watt rate at all", () => {
    expect(storage.finalPriceCents).toBe(4_800_000);
    expect(storage.systemWatts).toBe(0);
    // A $/W derived from a battery count is a number somebody would quote aloud.
    expect(storage.basePpwCents).toBe(0);
    expect(storage.finalPpwCents).toBe(0);
    expect(storage.applied.netFinalPpwCents).toBe(0);
  });

  it("still applies the credits to the final price", () => {
    expect(storage.applied.creditAmountCents).toBe(2_400_000);
    expect(storage.applied.netFinalPriceCents).toBe(2_400_000);
  });
});

describe("a lease or PPA sells electricity, so there is no ladder and no credit", () => {
  const lease = priceDeal({
    product: "lease",
    systemSizeKwDc: 10,
    baseFinalPpwCents: 0,
    dealerFeePct: 25,
    addersInsideRuleCents: 0,
    leasePaymentCents: 18_500,
    escalatorPct: 2.9,
    termYears: 25,
    year1ProductionKwh: 14_000,
    ...ALL_CREDITS,
  });

  it("has no system price to credit", () => {
    expect(lease.finalPriceCents).toBe(0);
    expect(lease.applied.creditAmountCents).toBe(0);
    expect(lease.applied.credits).toEqual([]);
    expect(lease.notApplied.creditAmountCents).toBe(0);
  });

  it("still knows how big the array is, so a per-watt rule can pay on it", () => {
    expect(lease.systemWatts).toBe(10_000);
  });
});

describe("the partner's price rule", () => {
  it("says when it held the price down, so a screen can print why", () => {
    // Amos: $5.50/W flat, fee included, on a deal typed well above it.
    const d = priceDeal({
      ...KW10, baseFinalPpwCents: 800, dealerFeePct: 65,
      priceRulePpwCents: 550, priceRuleMode: "cap", ...ALL_CREDITS,
    });
    expect(d.priceRule?.capped).toBe(true);
    expect(d.finalPriceCents).toBeLessThanOrEqual(550 * 10_000);
  });

  it("leaves a deal already under the ceiling exactly where it is", () => {
    const d = priceDeal({
      ...KW10, dealerFeePct: 25, priceRulePpwCents: 550, priceRuleMode: "cap", ...ALL_CREDITS,
    });
    expect(d.priceRule?.capped).toBe(false);
    expect(d.finalPriceCents).toBe(4_000_000);
  });
});

describe("the ladder is a complete substitute for PurchaseBreakdown", () => {
  /**
   * WHY THIS IS FIELD-BY-FIELD, AND WHY THE FIXTURE CARRIES ON-TOP ADDERS.
   *
   * Stage 4 connects the price sites to `priceDeal()`, and a site can only be
   * connected if every money figure it reads off `PurchaseBreakdown` has a home
   * here. `onTopAdderStickerCents` did not: `ladderFrom` never copied it, and
   * `system-price.tsx:782` reads it to name a financed roof separately.
   *
   * The fixture gives the deal a $7,000 ON-TOP adder on purpose. Priced with
   * none, `onTopAdderStickerCents` is zero on both sides and the assertion for
   * it passes while proving nothing — which is exactly how the field came to be
   * missing in the first place.
   *
   * (`marginCents` is deliberately NOT mirrored here. It is
   * `grossPriceCents - equipmentCostCents`, `PriceDealInput` carries no cost,
   * and no caller in `src/` passes one — so on `DealPrice` it could only ever
   * have reported zero.)
   */
  it("carries every money figure the document's breakdown reads", () => {
    const ON_TOP = 700_000;
    const d = priceDeal({
      ...KW10, dealerFeePct: 25, addersInsideRuleCents: 250_000,
      addersOutsideRuleCents: ON_TOP, ...ALL_CREDITS,
    });
    const b = priceStoredPurchase({
      product: "loan",
      systemSizeKwDc: 10,
      stickerPpwCents: 400,
      dealerFeePct: 25,
      adderTotalCents: 250_000,
      onTopAdderTotalCents: ON_TOP,
      maxFinalPpwCents: null,
    }).breakdown;

    expect(d.systemWatts).toBe(b.systemWatts);
    expect(d.baseKeptCents).toBe(b.baseKeptCents);
    expect(d.basePpwCents).toBe(b.basePpwCents);
    // `b.adderTotalCents` is BOTH halves — `priceUnits` sums them — so it is the
    // TOTAL rung that has to equal it, not the inside-rule one. Pinning the
    // inside-rule field against the total is exactly what let `addersCents`
    // double-count the on-top money without a red test.
    expect(d.addersCents).toBe(b.adderTotalCents);
    expect(d.addersInsideRuleCents).toBe(b.adderTotalCents - b.onTopAdderTotalCents);
    expect(d.addersOutsideRuleCents).toBe(b.onTopAdderTotalCents);
    // Disjoint, and they reach the total between them.
    expect(d.addersInsideRuleCents + d.addersOutsideRuleCents).toBe(d.addersCents);
    // Against the figures actually passed in, so the arithmetic above cannot be
    // satisfied by two wrong numbers agreeing: 250_000 went in inside the rule,
    // and the old double-count read 250_000 + 2 x ON_TOP on the total.
    expect(d.addersInsideRuleCents).toBe(250_000);
    expect(d.addersCents).toBe(250_000 + ON_TOP);
    expect(d.addersOutsideRuleFinalCents).toBe(b.onTopAdderStickerCents);
    expect(d.equipmentChargesCents).toBe(b.batteryPriceCents);
    expect(d.equipmentFinalCents).toBe(b.batteryStickerCents);
    expect(d.grossPriceCents).toBe(b.grossPriceCents);
    expect(d.grossPpwCents).toBe(b.grossPpwCents);
    expect(d.dealerFeeCents).toBe(b.dealerFeeCents);
    expect(d.finalPriceCents).toBe(b.contractPriceCents);
    expect(d.finalPpwCents).toBe(b.finalPpwCents);
    expect(d.baseFinalCents).toBe(b.baseStickerCents);
    expect(d.addersFinalCents).toBe(b.adderStickerCents);

    // The assertion above is only worth anything if the figure is real.
    expect(d.addersOutsideRuleFinalCents).toBeGreaterThan(0);
  });

  it("keeps the customer's own breakdown reaching its own total", () => {
    const d = priceDeal({ ...KW10, dealerFeePct: 25, addersInsideRuleCents: 250_000, ...ALL_CREDITS });
    expect(d.baseFinalCents + d.addersFinalCents + d.equipmentFinalCents).toBe(d.finalPriceCents);
  });
});

describe("the rate the deal is actually priced at", () => {
  it("is the sticker it was handed when no partner publishes a rule", () => {
    const d = priceDeal({ ...KW10, dealerFeePct: 25, ...ALL_CREDITS });
    expect(d.stickerPerUnitCents).toBe(400);
  });

  it("is the CAPPED sticker once the ceiling bites, not the typed one", () => {
    const d = priceDeal({
      ...KW10, baseFinalPpwCents: 800, dealerFeePct: 65,
      priceRulePpwCents: 550, priceRuleMode: "cap", ...ALL_CREDITS,
    });
    expect(d.priceRule?.capped).toBe(true);
    expect(d.stickerPerUnitCents).toBeLessThan(800);
    // `proposal-generate.ts` WRITES this figure back to SolarFinance, so it has
    // to be the rate the deal is priced at and not merely a flag that it moved.
    expect(d.stickerPerUnitCents).toBe(d.baseFinalPpwCents);
  });

  it("is the PER-BATTERY rate on a storage job, where every per-watt figure is 0", () => {
    // The case that rules out reusing `baseFinalPpwCents`: it reads 0 here,
    // because a storage job has no installed watts to divide by. A site that
    // wrote THAT back would price a battery deal at nothing.
    const d = priceDeal({
      product: "loan", systemType: "storage", systemSizeKwDc: 0,
      baseFinalPpwCents: 0, baseFinalPerBatteryCents: 2_000_000, batteryQty: 2,
      dealerFeePct: 50, addersInsideRuleCents: 0, ...ALL_CREDITS,
    });
    expect(d.baseFinalPpwCents).toBe(0);
    expect(d.stickerPerUnitCents).toBe(2_000_000);
  });

  it("carries the capped per-battery rate under a flat partner rule", () => {
    const d = priceDeal({
      product: "loan", systemType: "storage", systemSizeKwDc: 0,
      baseFinalPpwCents: 0, baseFinalPerBatteryCents: 2_000_000, batteryQty: 2,
      dealerFeePct: 50, addersInsideRuleCents: 0,
      priceRulePerBatteryCents: 1_200_000, priceRuleBatteryMode: "flat",
      batteryPriceBasis: "gross", ...ALL_CREDITS,
    });
    expect(d.stickerPerUnitCents).not.toBe(2_000_000);
    expect(d.finalPriceCents).toBe(d.stickerPerUnitCents * 2);
  });

  it("is zero on a lease, which sells electricity and has no unit to price", () => {
    const d = priceDeal({
      product: "lease", systemSizeKwDc: 10, baseFinalPpwCents: 0,
      dealerFeePct: 25, addersInsideRuleCents: 0,
      leasePaymentCents: 18_500, escalatorPct: 2.9, termYears: 25,
      year1ProductionKwh: 14_000, ...ALL_CREDITS,
    });
    expect(d.stickerPerUnitCents).toBe(0);
  });
});

describe("the naming rule holds on the result itself", () => {
  it('no field on a priced deal carries the word "contract"', () => {
    const d = priceDeal({ ...KW10, dealerFeePct: 25, ...ALL_CREDITS, monetizerPayoutRate: 50 });
    const names = [
      ...Object.keys(d),
      ...Object.keys(d.applied),
      ...Object.keys(d.notApplied),
      ...Object.keys(d.margin),
    ];
    expect(names.filter((n) => /contract/i.test(n))).toEqual([]);
  });
});
