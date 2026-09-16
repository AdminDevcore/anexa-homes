import { describe, expect, it } from "vitest";
import { financeRowForProduct, type LenderProductTerms } from "@/lib/solar-finance-row";
import {
  capStickerToFinalPpw,
  pricePurchase,
  type FinalPpwMode,
  type PriceBasis,
  type SolarAssumptions,
} from "@/lib/solar-money";

/**
 * THE ROW STILL PRICES WHAT IT PRICED BEFORE.
 *
 * `financeRowForProduct` used to cap by hand and then call `pricePurchase` on
 * whatever sticker came back. Stage 4c replaced that pair with one `priceDeal()`.
 *
 * `solar-no-rule-equivalence.test.ts` already proves `priceDeal === priceStoredPurchase`,
 * and `priceStoredPurchase` is visibly `capStickerToFinalPpw` followed by
 * `pricePurchase`. Chaining those two facts says this conversion is safe BY
 * CONSTRUCTION — which is exactly the kind of reasoning that has been wrong
 * twice in this work: once about `savingsModel` blocking a site, once about cash
 * diverging between the two paths. Both stories were plausible and both died on
 * contact with a test.
 *
 * So the old arithmetic is written out here, literally as it read before the
 * edit, and the row is measured against it. The primitives it used are still
 * exported, so this is the real comparison and not a paraphrase of one.
 *
 * `grossPpwCents` is always supplied, which pins `uncappedPpwCents` to the typed
 * price. The target-net derivation and the company-default gross-up feed that
 * same variable and are covered in solar-finance-row.test.ts; leaving them live
 * here would measure those instead of the cap-and-price collapse under test.
 */

const A: SolarAssumptions = {
  derateFactor: 0.84,
  annualDegradationPct: 0.5,
  utilityEscalationPct: 3.5,
  kwhPerKwYear: 1450,
  utilityMeterFeeCents: 1000,
  companyDefaultBasePpwCents: 350,
  defaultDealerFeePct: 18,
  minOffsetPct: 0,
  maxOffsetPct: 150,
};

const SYSTEM_KW = 10.4;
const STICKER = 412;

const ADDERS = [
  { label: "no adders", adderTotalCents: 0, onTopAdderTotalCents: 0 },
  { label: "inside the rule", adderTotalCents: 250_000, onTopAdderTotalCents: 0 },
  { label: "financed on top", adderTotalCents: 0, onTopAdderTotalCents: 700_000 },
  { label: "both", adderTotalCents: 250_000, onTopAdderTotalCents: 700_000 },
];

const BATTERIES = [0, 1_400_000];

/** Null is "this partner publishes no rule"; the rest are real Amos-shaped ones. */
const RULES: { label: string; max: number | null; mode: FinalPpwMode }[] = [
  { label: "no rule", max: null, mode: "cap" },
  { label: "cap 550c", max: 550, mode: "cap" },
  { label: "cap 300c (binds)", max: 300, mode: "cap" },
  { label: "flat 550c", max: 550, mode: "flat" },
];

const BASES: PriceBasis[] = ["final", "gross"];

function terms(over: Partial<LenderProductTerms> = {}): LenderProductTerms {
  return {
    id: "prod-1",
    product: "loan",
    aprPct: 6.99,
    termMonths: 300,
    dealerFeePct: 25,
    leaseRateCentsPerKwMonth: null,
    rateMillsPerKwh: null,
    escalatorPct: null,
    termYears: null,
    maxFinalPpwCents: null,
    finalPpwMode: "cap",
    ppwBasis: "final",
    ...over,
  };
}

/**
 * `financeRowForProduct` exactly as it read before Stage 4c, transcribed.
 *
 * Kept deliberately literal — same argument names, same `?? undefined`, same
 * adders into the ceiling and the battery kept out of it — because a tidied-up
 * version would be measuring my transcription rather than the old code.
 */
function theOldWay(args: {
  product: "cash" | "loan";
  dealerFeePct: number;
  uncappedPpwCents: number;
  adderTotalCents: number;
  onTopAdderTotalCents: number;
  batteryPriceCents: number;
  lp: LenderProductTerms | null;
}) {
  const { lp } = args;
  const cap = capStickerToFinalPpw({
    stickerPpwCents: args.uncappedPpwCents,
    maxFinalPpwCents: lp?.maxFinalPpwCents ?? null,
    mode: lp?.finalPpwMode ?? undefined,
    basis: lp?.ppwBasis ?? undefined,
    systemSizeKwDc: SYSTEM_KW,
    dealerFeePct: args.dealerFeePct,
    adderTotalCents: args.adderTotalCents,
  });
  const grossPpwCents = cap.stickerPpwCents;
  const breakdown = pricePurchase({
    product: args.product,
    systemSizeKwDc: SYSTEM_KW,
    stickerPpwCents: grossPpwCents,
    dealerFeePct: args.dealerFeePct,
    adderTotalCents: args.adderTotalCents,
    onTopAdderTotalCents: args.onTopAdderTotalCents,
    batteryPriceCents: args.batteryPriceCents,
  });
  return { grossPpwCents, contractPriceCents: breakdown.contractPriceCents };
}

describe("a LOAN row prices exactly as the hand-rolled cap-then-price did", () => {
  for (const rule of RULES) {
    for (const ppwBasis of BASES) {
      for (const dealerFeePct of [0, 25, 65]) {
        for (const a of ADDERS) {
          for (const batteryPriceCents of BATTERIES) {
            it(`${rule.label} on ${ppwBasis}, fee ${dealerFeePct}%, ${a.label}, battery ${batteryPriceCents}`, () => {
              const lp = terms({
                dealerFeePct,
                maxFinalPpwCents: rule.max,
                finalPpwMode: rule.mode,
                ppwBasis,
              });

              const row = financeRowForProduct(
                {
                  product: "loan",
                  grossPpwCents: STICKER,
                  adderTotalCents: a.adderTotalCents,
                  onTopAdderTotalCents: a.onTopAdderTotalCents,
                  batteryPriceCents,
                },
                { systemSizeKwDc: SYSTEM_KW, assumptions: A, lenderProduct: lp }
              );

              // The programme's fee wins, so that is the fee the old arithmetic
              // ran at too. If this ever drifts the comparison below is
              // meaningless, so it is asserted rather than assumed.
              expect(row.dealerFeePct).toBe(dealerFeePct);
              expect(row.dealerFeeSource).toBe("programme");

              const old = theOldWay({
                product: "loan",
                dealerFeePct,
                uncappedPpwCents: STICKER,
                adderTotalCents: a.adderTotalCents,
                onTopAdderTotalCents: a.onTopAdderTotalCents,
                batteryPriceCents,
                lp,
              });

              expect(row.grossPpwCents).toBe(old.grossPpwCents);
              expect(row.contractPriceCents).toBe(old.contractPriceCents);
            });
          }
        }
      }
    }
  }
});

describe("a CASH row is untouched by any partner rule, before or after", () => {
  for (const rule of RULES) {
    for (const a of ADDERS) {
      it(`${rule.label}, ${a.label}`, () => {
        // The guard in financeRowForProduct drops the lender product on cash
        // (`f.product !== "cash"`), so no ceiling was ever applied to a cash
        // deal and none is applied now. This is the divergence I expected to
        // find between the two paths — `priceStoredPurchase` independently
        // nulls the rule on cash — and the reason it cannot bite.
        const row = financeRowForProduct(
          {
            product: "cash",
            grossPpwCents: STICKER,
            dealerFeePct: 65, // a stray fee, to prove cash ignores it
            adderTotalCents: a.adderTotalCents,
            onTopAdderTotalCents: a.onTopAdderTotalCents,
          },
          {
            systemSizeKwDc: SYSTEM_KW,
            assumptions: A,
            lenderProduct: terms({
              product: "cash",
              maxFinalPpwCents: rule.max,
              finalPpwMode: rule.mode,
            }),
          }
        );

        expect(row.dealerFeePct).toBe(0);
        expect(row.dealerFeeSource).toBe("none");

        const old = theOldWay({
          product: "cash",
          dealerFeePct: 0,
          uncappedPpwCents: STICKER,
          adderTotalCents: a.adderTotalCents,
          onTopAdderTotalCents: a.onTopAdderTotalCents,
          batteryPriceCents: 0,
          lp: null,
        });

        expect(row.grossPpwCents).toBe(old.grossPpwCents);
        expect(row.contractPriceCents).toBe(old.contractPriceCents);
        // The sticker survives whatever the partner publishes.
        expect(row.grossPpwCents).toBe(STICKER);
      });
    }
  }
});

describe("lease and PPA still price nothing here", () => {
  it.each(["lease", "ppa"] as const)("%s zeroes the purchase block", (product) => {
    const row = financeRowForProduct(
      { product, grossPpwCents: STICKER, adderTotalCents: 250_000 },
      { systemSizeKwDc: SYSTEM_KW, assumptions: A }
    );
    expect(row.grossPpwCents).toBe(0);
    expect(row.contractPriceCents).toBe(0);
    expect(row.adderTotalCents).toBe(0);
    expect(row.dealerFeePct).toBe(0);
    expect(row.dealerFeeSource).toBe("none");
  });
});
