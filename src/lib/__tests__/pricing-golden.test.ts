import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StoragePriceCard, SystemPriceCard } from "@/components/portal/solar/system-price";
import { buildCreditLadder } from "@/lib/solar-credit-ladder";
import {
  snapshotPriceSource,
  solarContractRevenueCents,
  solarDealValue,
  solarLeadValueCents,
} from "@/lib/solar-deal-value";
import { lenderProductLabel } from "@/lib/solar-lender-product";
import { programmeMonthlyCents } from "@/lib/solar-loan";
import { priceStoredPurchase } from "@/lib/solar-money";
import { managerOverrideCents, solarRepPayCents, type SolarPayTerms } from "@/lib/solar-pay";
import type { SolarProposalSnapshot } from "@/lib/solar-proposal";
import { resolveSignToday } from "@/lib/solar-sign-today";
import { frozenPriceLadder, resolveReportedSystem } from "@/lib/solar-system-of-record";
import {
  CREDIT_RATES,
  DEALS,
  ITC_ONLY,
  STORAGE_DEAL,
  columnFigures,
  ladderFigures,
  optionFigures,
  priceToday,
  rowFigures,
  storageToday,
  unitLadderFigures,
  type DealKey,
  type PerWattDeal,
  type PricedToday,
} from "./pricing-golden-deals";

/**
 * GOLDEN: WHAT EVERY PURE PRICING SITE PRODUCES TODAY.
 *
 * Pricing rework, Stage 0. Characterization, not specification: these pin the
 * figures origin/main ed3b832 produces for the golden deals (see
 * pricing-golden-deals.ts), including the figures the rework is approved to
 * change. When a stage changes one on purpose, its commit updates the snapshot
 * and says which figure moved and why. Any other movement is a regression.
 *
 * The worked example is also asserted by value, so docs/PRICING_LOGIC.md §4
 * cannot drift from the code without a test failing.
 */

const KEYS = Object.keys(DEALS) as DealKey[];
const TODAY = Object.fromEntries(KEYS.map((k) => [k, priceToday(DEALS[k])])) as Record<DealKey, PricedToday>;
const STORAGE = storageToday();

function perDeal<T>(fn: (d: PerWattDeal, t: PricedToday) => T): Record<DealKey, T> {
  return Object.fromEntries(KEYS.map((k) => [k, fn(DEALS[k], TODAY[k])])) as Record<DealKey, T>;
}

const quotedOption = (s: SolarProposalSnapshot) => {
  const q = (s.options ?? []).find((o) => o.quoted);
  if (!q) throw new Error("the snapshot has no quoted option");
  return q;
};

const REDLINE: SolarPayTerms = {
  basis: "redline",
  redlineCentsPerWatt: 200,
  millsPerWatt: null,
  redlinePerBatteryCents: null,
  perBatteryFlatCents: null,
};
const PER_WATT: SolarPayTerms = { ...REDLINE, basis: "per_watt", redlineCentsPerWatt: null, millsPerWatt: 150 };

/**
 * What a price card prints: its `data-testid` figures, every dollar amount in
 * reading order (the storage card has no test ids), and the rung labels that
 * carry a rate.
 */
function cardFigures(html: string) {
  const figures: Record<string, string> = {};
  for (const m of html.matchAll(/data-testid="([^"]+)"[^>]*>([^<]*)</g)) figures[m[1]] = m[2];
  return {
    figures,
    amounts: html.match(/\$[0-9][0-9,]*(?:\.[0-9]+)?(?:\/W)?/g) ?? [],
    feeLabels: html.match(/Dealer fee[^<]*/g) ?? [],
    ruleNotes: html.match(/after the \$[^<]*/g) ?? [],
  };
}

describe("golden: the worked example, by value (docs/PRICING_LOGIC.md §4.2)", () => {
  const we = TODAY.workedExample;

  it("prices the ladder", () => {
    expect(ladderFigures(we.priced.breakdown)).toMatchObject({
      basePriceCents: 3_000_000,
      addersCents: 370_000,
      equipmentChargesCents: 1_500_000,
      grossPriceCents: 4_870_000,
      dealerFeeCents: 1_623_333,
      finalCents: 6_493_333,
      baseFinalCents: 4_000_000,
      addersFinalCents: 493_333,
      equipmentFinalCents: 2_000_000,
    });
  });

  it("freezes the document", () => {
    const q = quotedOption(we.snapshot);
    expect(q.financing.adders?.map((a) => a.amountCents)).toEqual([360_000, 133_333]);
    expect(q.financing.creditLadder?.credits.map((c) => c.amountCents)).toEqual([1_948_000]);
    expect(q.financing.creditLadder?.netCostCents).toBe(4_545_333);
    expect(q.monthlyCents).toBe(45_852);
    expect(q.creditsApplied?.monthlyCents).toBe(32_096);
    expect(q.creditsApplied?.financedAmountCents).toBe(4_545_333);
  });

  it("quotes the builder shelf", () => {
    expect(we.columns[0]).toMatchObject({ monthlyCents: 32_096, withoutCreditsMonthlyCents: 45_852 });
  });

  it("hands back the sign-today credit above a cap (§4.4)", () => {
    const b = we.priced.breakdown;
    const above = (capPpwCents: number) =>
      resolveSignToday({
        rule: { mode: "above_cap", fixedCents: null, capPpwCents },
        systemPriceCents: b.baseStickerCents,
        batteryPriceCents: b.batteryStickerCents,
        systemWatts: we.watts,
        creditRates: CREDIT_RATES,
        creditClaims: ITC_ONLY,
        typedCents: 0,
      }).cents;
    expect([above(600), above(250), above(200)]).toEqual([0, 1_700_000, 2_200_000]);
  });
});

describe("golden: the lender price rule matrix, by value (docs/PRICING_LOGIC.md §4.3)", () => {
  it("solves the sticker and final for every mode, basis and typed sticker", () => {
    const out: Record<string, [number, number]> = {};
    for (const mode of ["cap", "flat"] as const) {
      for (const basis of ["final", "gross", "base"] as const) {
        for (const typed of [400, 1000]) {
          const r = priceStoredPurchase({
            product: "loan",
            systemSizeKwDc: 10,
            stickerPpwCents: typed,
            dealerFeePct: 30,
            adderTotalCents: 270_000,
            onTopAdderTotalCents: 700_000,
            batteryPriceCents: 0,
            maxFinalPpwCents: 550,
            finalPpwMode: mode,
            ppwBasis: basis,
          });
          out[`${mode}/${basis}/${typed}`] = [r.cap.stickerPpwCents, r.breakdown.contractPriceCents];
        }
      }
    }
    expect(out).toEqual({
      "cap/final/400": [400, 5_385_714],
      "cap/final/1000": [511, 6_495_714],
      "cap/gross/400": [400, 5_385_714],
      "cap/gross/1000": [747, 8_855_714],
      "cap/base/400": [400, 5_385_714],
      "cap/base/1000": [785, 9_235_714],
      "flat/final/400": [511, 6_495_714],
      "flat/final/1000": [511, 6_495_714],
      "flat/gross/400": [747, 8_855_714],
      "flat/gross/1000": [747, 8_855_714],
      "flat/base/400": [786, 9_245_714],
      "flat/base/1000": [786, 9_245_714],
    });
  });
});

describe("golden: every pure pricing site, every golden deal", () => {
  it("the ladder (priceStoredPurchase, priceStorageStored)", () => {
    expect({
      ...perDeal((_, t) => ({ cap: t.priced.cap, ...ladderFigures(t.priced.breakdown) })),
      storageOnly: { cap: STORAGE.priced.cap, ...unitLadderFigures(STORAGE.priced.breakdown) },
    }).toMatchSnapshot();
  });

  it("the save (financeRowForProduct)", () => {
    expect(perDeal((_, t) => rowFigures(t.row))).toMatchSnapshot();
  });

  it("the builder shelf (compareOffers)", () => {
    expect(perDeal((_, t) => t.columns.map(columnFigures))).toMatchSnapshot();
  });

  it("the document (proposalAlternatives + buildProposalSnapshot)", () => {
    expect({
      ...perDeal((_, t) => (t.snapshot.options ?? []).map(optionFigures)),
      storageOnly: (STORAGE.snapshot.options ?? []).map(optionFigures),
    }).toMatchSnapshot();
  });

  it("the credit ladder and sign-today credit, called directly", () => {
    expect(
      perDeal((d, t) => {
        const b = t.priced.breakdown;
        const signToday = resolveSignToday({
          rule: d.signToday,
          systemPriceCents: b.baseStickerCents,
          batteryPriceCents: b.batteryStickerCents,
          systemWatts: t.watts,
          creditRates: CREDIT_RATES,
          creditClaims: d.claims,
          typedCents: d.signTodayTypedCents,
        });
        const ladder = buildCreditLadder({
          contractValueCents: b.contractPriceCents,
          quotedPriceCents: b.contractPriceCents,
          rates: CREDIT_RATES,
          claims: d.claims,
          signTodayCreditCents: signToday.cents,
        });
        return {
          signToday,
          credits: ladder ? ladder.credits.map((c) => [c.key, c.pct, c.amountCents]) : null,
          creditAmountCents: ladder?.creditTotalCents ?? null,
          signTodayCents: ladder?.signTodayCents ?? null,
          netFinalCreditsAppliedCents: ladder?.netCostCents ?? null,
        };
      })
    ).toMatchSnapshot();
  });

  it("loan payments on each credit state (programmeMonthlyCents)", () => {
    expect(
      perDeal((d, t) => {
        const final = t.priced.breakdown.contractPriceCents;
        const net = quotedOption(t.snapshot).financing.creditLadder?.netCostCents ?? final;
        const terms = { aprPct: d.aprPct, termMonths: d.termMonths };
        return {
          onFinalCents: programmeMonthlyCents(terms, final),
          onNetFinalCreditsAppliedCents: programmeMonthlyCents(terms, net),
        };
      })
    ).toMatchSnapshot();
  });

  it("deal value and revenue (snapshotPriceSource, solarDealValue, solarLeadValueCents, solarContractRevenueCents)", () => {
    const value = (s: SolarProposalSnapshot) => {
      const src = snapshotPriceSource(quotedOption(s).financing);
      return {
        source: src,
        dealValue: solarDealValue(src),
        leadValueCents: solarLeadValueCents(src),
        revenueCents: solarContractRevenueCents(src),
      };
    };
    expect({ ...perDeal((_, t) => value(t.snapshot)), storageOnly: value(STORAGE.snapshot) }).toMatchSnapshot();
  });

  it("the reported system and its frozen price ladder (resolveReportedSystem, frozenPriceLadder)", () => {
    const reported = (s: SolarProposalSnapshot, kw: number) => {
      const system = resolveReportedSystem({
        proposal: { version: 1, status: "generated", at: null, approved: false, snapshot: s },
        design: null,
      });
      const ladder = frozenPriceLadder(quotedOption(s).financing, kw);
      return {
        system: system && {
          source: system.source,
          product: system.product,
          contractPriceCents: system.contractPriceCents,
          netAfterCreditsCents: system.netAfterCreditsCents,
          monthlyPaymentCents: system.monthlyPaymentCents,
        },
        ladder: ladder && {
          ...ladder,
          credits: ladder.credits && {
            creditTotalCents: ladder.credits.creditTotalCents,
            netCostCents: ladder.credits.netCostCents,
          },
        },
      };
    };
    expect({
      ...perDeal((d, t) => reported(t.snapshot, d.kw)),
      storageOnly: reported(STORAGE.snapshot, 0),
    }).toMatchSnapshot();
  });

  it("rep pay and the manager override (solarRepPayCents, managerOverrideCents)", () => {
    const override = (repNetCents: number, systemWatts: number) =>
      managerOverrideCents({ type: "percentage", percent: 10, flatAmount: 0, perWattMills: 0 }, { systemWatts, repNetCents });
    expect({
      ...perDeal((d, t) => {
        const deal = { systemWatts: t.watts, basePriceCents: t.priced.breakdown.basePriceCents, batteryQty: d.batteryQty };
        const redline = solarRepPayCents(REDLINE, deal);
        const perWatt = solarRepPayCents(PER_WATT, deal);
        return { redline, perWatt, overrideOnRedline: override(redline.amountCents, t.watts) };
      }),
      storageOnly: (() => {
        const deal = {
          systemWatts: 0,
          basePriceCents: STORAGE.priced.breakdown.basePriceCents,
          batteryQty: STORAGE_DEAL.batteryQty,
        };
        return {
          batteryRedline: solarRepPayCents({ ...REDLINE, basis: "battery_redline", redlinePerBatteryCents: 900_000 }, deal),
          batteryFlat: solarRepPayCents({ ...REDLINE, basis: "battery_flat", perBatteryFlatCents: 50_000 }, deal),
        };
      })(),
    }).toMatchSnapshot();
  });

  it("programme labels (lenderProductLabel): an unnamed programme's label carries the fee", () => {
    expect({
      named: lenderProductLabel({ product: "loan", name: "Amos 30 Year Solar", aprPct: 0, termMonths: 360, dealerFeePct: 65 }),
      unnamed: lenderProductLabel({ product: "loan", name: null, aprPct: 0, termMonths: 360, dealerFeePct: 25 }),
    }).toMatchSnapshot();
  });

  it("the builder price cards (SystemPriceCard, StoragePriceCard)", () => {
    const systemCard = (d: PerWattDeal, t: PricedToday) =>
      cardFigures(
        renderToStaticMarkup(
          createElement(SystemPriceCard, {
            systemSizeKwDc: d.kw,
            basePpwCents: d.basePpwCents,
            defaultPpwCents: 350,
            adderTotalCents: t.inside,
            onTopAdderTotalCents: t.onTop,
            batteryPriceCents: t.battery,
            batteryLabel: t.battery > 0 ? "Battery" : null,
            batteryQty: d.batteryQty,
            quotedFeePct: d.product === "cash" ? null : d.feePct,
            quotedMaxFinalPpwCents: d.rule.maxFinalPpwCents,
            quotedFinalPpwMode: d.rule.finalPpwMode,
            quotedPpwBasis: d.rule.ppwBasis,
            quotedMinBasePpwCents: d.rule.minBasePpwCents,
            quotedLabel: d.lenderName,
            canEdit: false,
            onChange: () => {},
          })
        )
      );
    expect({
      ...perDeal(systemCard),
      storageOnly: cardFigures(
        renderToStaticMarkup(
          createElement(StoragePriceCard, {
            batteryQty: STORAGE_DEAL.batteryQty,
            basePerBatteryCents: STORAGE_DEAL.basePerBatteryCents,
            quotedFeePct: STORAGE_DEAL.feePct,
            quotedMaxFinalPerBatteryCents: STORAGE_DEAL.maxFinalPricePerBatteryCents,
            quotedFinalBatteryPriceMode: STORAGE_DEAL.finalBatteryPriceMode,
            quotedBatteryPriceBasis: STORAGE_DEAL.batteryPriceBasis,
            quotedMinBasePerBatteryCents: null,
            quotedLabel: STORAGE_DEAL.lenderName,
            adderTotalCents: 0,
            canEdit: false,
            onChange: () => {},
          })
        )
      ),
    }).toMatchSnapshot();
  });
});
