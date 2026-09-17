import { describe, expect, it } from "vitest";
import { priceDeal } from "@/lib/solar-price-deal";
import {
  pricePurchase,
  priceStoredPurchase,
  priceStoragePurchase,
  priceStorageStored,
} from "@/lib/solar-money";

/**
 * A PRICE WITH NO PARTNER RULE IS THE SAME PRICE, WHICHEVER DOOR IT CAME IN BY.
 *
 * Stage 4c needs this before it can rewire a single site. The customer's
 * document calls `pricePurchase` directly; `priceDeal()` routes the same deal
 * through `priceStoredPurchase`, and the storage branch through
 * `priceStorageStored` rather than `priceStoragePurchase`. Those are DIFFERENT
 * FUNCTIONS, and the split is deliberate: the `…Stored` pair re-applies the
 * partner's CURRENT ceiling, because a saved sticker is only as capped as the
 * lender was on the day it was saved.
 *
 * With no rule to apply they should collapse to the same numbers. "Should" was
 * doing real work in that sentence, so it is measured here rather than assumed
 * — and measured BEFORE the document is touched, so a divergence shows up as a
 * red test instead of as a moved figure on paper a household is holding.
 *
 * `ppwBasis` is the specific reason for doubt: it defaults to `final` on the
 * stored path even when the rule is null, and a basis default that touched the
 * sticker would shift every deal.
 */

const FEES = [0, 18, 25, 65];

/** The adder shapes that price differently: none, inside the rule, on top of it. */
const ADDERS = [
  { label: "no adders", adderTotalCents: 0, onTopAdderTotalCents: 0 },
  { label: "inside the rule", adderTotalCents: 250_000, onTopAdderTotalCents: 0 },
  { label: "financed on top", adderTotalCents: 0, onTopAdderTotalCents: 700_000 },
  { label: "both", adderTotalCents: 250_000, onTopAdderTotalCents: 700_000 },
];

const BATTERIES = [0, 1_400_000];

describe("pricePurchase === priceStoredPurchase with no ceiling", () => {
  for (const dealerFeePct of FEES) {
    for (const a of ADDERS) {
      for (const batteryPriceCents of BATTERIES) {
        it(`fee ${dealerFeePct}%, ${a.label}, battery ${batteryPriceCents}`, () => {
          const input = {
            product: "loan" as const,
            systemSizeKwDc: 10.4,
            stickerPpwCents: 412,
            dealerFeePct,
            adderTotalCents: a.adderTotalCents,
            onTopAdderTotalCents: a.onTopAdderTotalCents,
            batteryPriceCents,
          };
          const stored = priceStoredPurchase({ ...input, maxFinalPpwCents: null });
          expect(stored.breakdown).toEqual(pricePurchase(input));
          expect(stored.cap.capped).toBe(false);
        });
      }
    }
  }

  it("holds on cash, which carries no fee and no partner", () => {
    const input = {
      product: "cash" as const,
      systemSizeKwDc: 8,
      stickerPpwCents: 300,
      dealerFeePct: 0,
      adderTotalCents: 120_000,
      onTopAdderTotalCents: 0,
      batteryPriceCents: 0,
    };
    expect(priceStoredPurchase({ ...input, maxFinalPpwCents: null }).breakdown).toEqual(
      pricePurchase(input)
    );
  });

  it("an UNDEFINED ceiling behaves exactly like a null one", () => {
    // The document would pass `undefined`, not `null` — `PriceDealInput` leaves
    // the rule optional. A difference between the two here would be invisible
    // at every call site and wrong at all of them.
    const input = {
      product: "loan" as const,
      systemSizeKwDc: 10,
      stickerPpwCents: 400,
      dealerFeePct: 25,
      adderTotalCents: 250_000,
      onTopAdderTotalCents: 0,
      batteryPriceCents: 0,
    };
    expect(priceStoredPurchase({ ...input, maxFinalPpwCents: undefined }).breakdown).toEqual(
      priceStoredPurchase({ ...input, maxFinalPpwCents: null }).breakdown
    );
  });
});

describe("priceStoragePurchase === priceStorageStored with no ceiling", () => {
  for (const dealerFeePct of FEES) {
    for (const a of ADDERS) {
      it(`fee ${dealerFeePct}%, ${a.label}`, () => {
        const input = {
          product: "loan" as const,
          batteryQty: 2,
          stickerPricePerBatteryCents: 2_000_000,
          dealerFeePct,
          adderTotalCents: a.adderTotalCents,
          onTopAdderTotalCents: a.onTopAdderTotalCents,
        };
        const stored = priceStorageStored({
          ...input,
          maxFinalPricePerBatteryCents: null,
        });
        expect(stored.breakdown).toEqual(priceStoragePurchase(input));
        expect(stored.cap.capped).toBe(false);
      });
    }
  }
});


/**
 * AND WITH A RULE: `priceDeal()` IS THE PRIMITIVE IT WRAPS.
 *
 * The 50 cases above license only the sites that pass NO ceiling — the
 * customer's document, which is priced from an already-capped sticker.
 * `commission-pricing.ts` passes a real one: a cap or a `flat` price, on any of
 * the three bases. That is a different code path, and the number it produces
 * (`baseKeptCents`) is what a rep's redline multiplies, so it is proved before
 * that site is rewired rather than after.
 */
const RULES = [
  { maxFinalPpwCents: 550, finalPpwMode: "cap" as const },
  { maxFinalPpwCents: 550, finalPpwMode: "flat" as const },
  { maxFinalPpwCents: 300, finalPpwMode: "cap" as const },
];
const BASES = ["final", "gross", "base"] as const;

describe("priceDeal's ladder === priceStoredPurchase, ceiling and all", () => {
  for (const rule of RULES) {
    for (const ppwBasis of BASES) {
      for (const dealerFeePct of [0, 25, 65]) {
        it(`${rule.finalPpwMode} ${rule.maxFinalPpwCents}c on ${ppwBasis}, fee ${dealerFeePct}%`, () => {
          const common = {
            product: "loan" as const,
            systemSizeKwDc: 10.4,
            dealerFeePct,
            adderTotalCents: 250_000,
            onTopAdderTotalCents: 700_000,
            batteryPriceCents: 1_400_000,
          };
          const b = priceStoredPurchase({
            ...common,
            stickerPpwCents: 800,
            maxFinalPpwCents: rule.maxFinalPpwCents,
            finalPpwMode: rule.finalPpwMode,
            ppwBasis,
          }).breakdown;
          const d = priceDeal({
            product: "loan",
            systemType: "pv_storage",
            systemSizeKwDc: common.systemSizeKwDc,
            baseFinalPpwCents: 800,
            dealerFeePct,
            addersInsideRuleCents: common.adderTotalCents,
            addersOutsideRuleCents: common.onTopAdderTotalCents,
            equipmentChargesCents: common.batteryPriceCents,
            priceRulePpwCents: rule.maxFinalPpwCents,
            priceRuleMode: rule.finalPpwMode,
            ppwBasis,
          });
          // The two figures commission-pricing.ts actually reads.
          expect(d.baseKeptCents).toBe(b.baseKeptCents);
          expect(d.finalPriceCents).toBe(b.contractPriceCents);
          // And the rest of the ladder, so a later site finds no surprise.
          expect(d.grossPriceCents).toBe(b.grossPriceCents);
          expect(d.dealerFeeCents).toBe(b.dealerFeeCents);
          expect(d.baseFinalCents).toBe(b.baseStickerCents);
          expect(d.addersFinalCents).toBe(b.adderStickerCents);
          expect(d.equipmentFinalCents).toBe(b.batteryStickerCents);
        });
      }
    }
  }

  it("storage: priceDeal === priceStorageStored, ceiling and all", () => {
    const b = priceStorageStored({
      product: "loan",
      batteryQty: 2,
      stickerPricePerBatteryCents: 2_000_000,
      dealerFeePct: 50,
      adderTotalCents: 250_000,
      onTopAdderTotalCents: 0,
      maxFinalPricePerBatteryCents: 1_200_000,
      finalBatteryPriceMode: "flat",
      batteryPriceBasis: "gross",
    }).breakdown;
    const d = priceDeal({
      product: "loan",
      systemType: "storage",
      systemSizeKwDc: 0,
      baseFinalPpwCents: 0,
      baseFinalPerBatteryCents: 2_000_000,
      batteryQty: 2,
      dealerFeePct: 50,
      addersInsideRuleCents: 250_000,
      addersOutsideRuleCents: 0,
      priceRulePerBatteryCents: 1_200_000,
      priceRuleBatteryMode: "flat",
      batteryPriceBasis: "gross",
    });
    expect(d.baseKeptCents).toBe(b.baseKeptCents);
    expect(d.finalPriceCents).toBe(b.contractPriceCents);
  });

  /**
   * CASH: BOTH PATHS ZERO THE FEE. I HAD THIS WRONG.
   *
   * I claimed `priceDeal` diverged here — that it forces the fee to zero on
   * cash while the primitive applies whatever it is handed — and wrote that
   * into §8.29 and a commit message as a real behaviour change "the goldens
   * cannot catch". It is false. `priceUnits` does the same thing at
   * solar-money.ts:401:
   *
   *     const rawPct = input.product === "cash" ? 0 : input.dealerFeePct;
   *
   * The claim came from reading `pricePurchase`'s signature and the generic
   * `0 < pct < 100` guard instead of measuring. Writing the test falsified it
   * on the first run. It is kept, inverted to assert the truth, so the next
   * person who wonders whether cash diverges gets a measured answer rather than
   * a plausible story.
   */
  it("treats cash identically in both paths, stray fee and all", () => {
    const primitive = priceStoredPurchase({
      product: "cash",
      systemSizeKwDc: 10,
      stickerPpwCents: 400,
      dealerFeePct: 25,
      adderTotalCents: 0,
      onTopAdderTotalCents: 0,
      batteryPriceCents: 0,
      maxFinalPpwCents: null,
    }).breakdown;
    const d = priceDeal({
      product: "cash",
      systemSizeKwDc: 10,
      baseFinalPpwCents: 400,
      dealerFeePct: 25,
      addersInsideRuleCents: 0,
    });
    expect(d.dealerFeePct).toBe(0);
    expect(primitive.baseKeptCents).toBe(d.baseKeptCents);
    expect(primitive.contractPriceCents).toBe(d.finalPriceCents);
    // Cash has no lender, so nothing is taken out between base and final.
    expect(d.baseKeptCents).toBe(d.finalPriceCents);
  });
});
