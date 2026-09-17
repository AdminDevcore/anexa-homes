import { describe, expect, it } from "vitest";
import { proposalAlternatives, type CatalogueProgramme } from "@/lib/solar-proposal-options";
import {
  basePpwFromSticker,
  capStickerToFinalUnit,
  grossPpwFromNet,
  type FinalPpwMode,
  type PriceBasis,
  type SolarAssumptions,
} from "@/lib/solar-money";

/**
 * THE BATTERY PRICE ON THE MENU IS THE PRICE IT WAS BEFORE.
 *
 * Stage 4c replaced this site's `capStickerToFinalUnit` with `priceDeal()`.
 * Unlike every other site converted so far, the old call was a CEILING ONLY —
 * nothing was priced, one field was read — so the collapse is not "two calls
 * became one" but "a primitive became a whole ladder, of which one number is
 * kept".
 *
 * That is a faithful substitution only if `priceDeal`'s storage branch caps on
 * exactly the same arguments. It does, by inspection. Inspection has been wrong
 * twice in this work, so the old call is transcribed here and the menu measured
 * against it.
 *
 * The two figures already pinned in solar-proposal-storage-price.test.ts
 * ($11,250 uncapped, $10,000 held to the partner's ceiling) cover one fee and
 * one rule. This covers the grid: the fee a programme charges, whether the
 * partner publishes a ceiling, whether that ceiling is a cap or a flat price,
 * which rung it fixes, and whether adders are in play.
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

const BATTERY_QTY = 2;
const QUOTED_STICKER_PER_BATTERY = 900_000;
/** The quoted deal is cash here, so its sticker IS its base — as in the fixtures. */
const QUOTED_FEE = 0;

const FEES = [0, 20, 25, 65];
const CAPS: (number | null)[] = [null, 1_000_000, 700_000];
const MODES: FinalPpwMode[] = ["cap", "flat"];
const BASES: PriceBasis[] = ["final", "gross"];
const ADDERS = [0, 250_000];

function programme(over: {
  dealerFeePct: number;
  maxFinalPricePerBatteryCents: number | null;
  finalBatteryPriceMode: FinalPpwMode;
  batteryPriceBasis: PriceBasis;
}): CatalogueProgramme {
  return {
    id: "p1",
    product: "loan",
    name: "Storage 25 Y",
    aprPct: 6.99,
    termMonths: 300,
    dealerFeePct: over.dealerFeePct,
    leaseRateCentsPerKwMonth: null,
    rateMillsPerKwh: null,
    escalatorPct: null,
    termYears: null,
    factorWithPaydownMicros: null,
    factorWithoutPaydownMicros: null,
    paydownPct: null,
    paydownMonths: null,
    rank: 0,
    financesStorageOnly: true,
    batteryPriceBasis: over.batteryPriceBasis,
    lender: {
      id: "l1",
      name: "Climate First",
      rank: 0,
      applyUrl: null,
      logoUrl: null,
      maxFinalPpwCents: null,
      finalPpwMode: "cap",
      maxFinalPricePerBatteryCents: over.maxFinalPricePerBatteryCents,
      finalBatteryPriceMode: over.finalBatteryPriceMode,
    },
  };
}

function menu(p: CatalogueProgramme, adderTotalCents: number) {
  return proposalAlternatives({
    quoted: {
      product: "cash",
      lenderProductId: null,
      lenderId: null,
      grossPpwCents: 0,
      dealerFeePct: QUOTED_FEE,
    },
    programmes: [p],
    approvedLenderIds: null,
    design: { systemSizeKwDc: 0 },
    systemType: "storage",
    storage: {
      batteryQty: BATTERY_QTY,
      stickerPricePerBatteryCents: QUOTED_STICKER_PER_BATTERY,
    },
    adders: adderTotalCents > 0 ? [{ label: "Panel upgrade", amountCents: adderTotalCents }] : [],
    adderTotalCents,
    onTopAdderTotalCents: 0,
    assumptions: A,
    targetNetPpwCents: null,
  });
}

/**
 * The line this site read before Stage 4c, transcribed.
 *
 * Deliberately literal: same argument names, same `?? null`, the adders INSIDE
 * the rule only, and the fee the row resolved — which on these fixtures is the
 * programme's own, since a programme fee always outranks the deal's copy.
 */
function theOldWay(args: {
  dealerFeePct: number;
  maxFinalPricePerBatteryCents: number | null;
  finalBatteryPriceMode: FinalPpwMode;
  batteryPriceBasis: PriceBasis;
  adderTotalCents: number;
}) {
  const baseBatteryCents = basePpwFromSticker(QUOTED_STICKER_PER_BATTERY, QUOTED_FEE);
  return capStickerToFinalUnit({
    stickerPerUnitCents:
      grossPpwFromNet(baseBatteryCents, args.dealerFeePct) ?? baseBatteryCents,
    maxFinalPerUnitCents: args.maxFinalPricePerBatteryCents ?? null,
    mode: args.finalBatteryPriceMode,
    basis: args.batteryPriceBasis,
    units: BATTERY_QTY,
    dealerFeePct: args.dealerFeePct,
    adderTotalCents: args.adderTotalCents,
  }).stickerPerUnitCents;
}

describe("the per-battery price on the payment menu is unchanged by the conversion", () => {
  for (const dealerFeePct of FEES) {
    for (const cap of CAPS) {
      for (const finalBatteryPriceMode of MODES) {
        for (const batteryPriceBasis of BASES) {
          for (const adderTotalCents of ADDERS) {
            const label =
              `fee ${dealerFeePct}%, ` +
              `${cap == null ? "no ceiling" : `${finalBatteryPriceMode} ${cap}c`} on ${batteryPriceBasis}, ` +
              `adders ${adderTotalCents}`;
            it(label, () => {
              const p = programme({
                dealerFeePct,
                maxFinalPricePerBatteryCents: cap,
                finalBatteryPriceMode,
                batteryPriceBasis,
              });

              const [alt] = menu(p, adderTotalCents);
              expect(alt).toBeDefined();

              expect(alt.finance.stickerPricePerBatteryCents).toBe(
                theOldWay({
                  dealerFeePct,
                  maxFinalPricePerBatteryCents: cap,
                  finalBatteryPriceMode,
                  batteryPriceBasis,
                  adderTotalCents,
                })
              );

              // A storage row must never carry a rate on watts it does not have.
              expect(alt.finance.grossPpwCents).toBe(0);
            });
          }
        }
      }
    }
  }
});

describe("the two figures the storage suite already pins still read the same", () => {
  it("re-grosses the deal's own base by the programme's fee", () => {
    const [alt] = menu(
      programme({
        dealerFeePct: 20,
        maxFinalPricePerBatteryCents: null,
        finalBatteryPriceMode: "cap",
        batteryPriceBasis: "final",
      }),
      0
    );
    // $9,000 base ÷ (1 − 20%) = $11,250 a battery.
    expect(alt.finance.stickerPricePerBatteryCents).toBe(1_125_000);
  });

  it("holds a programme to what its partner will fund a battery for", () => {
    const [alt] = menu(
      programme({
        dealerFeePct: 20,
        maxFinalPricePerBatteryCents: 1_000_000,
        finalBatteryPriceMode: "cap",
        batteryPriceBasis: "final",
      }),
      0
    );
    expect(alt.finance.stickerPricePerBatteryCents).toBe(1_000_000);
  });
});
