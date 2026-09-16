import { describe, expect, it } from "vitest";
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
