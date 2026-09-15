/**
 * THE GOLDEN DEALS — shared by the Stage 0 characterization tests.
 *
 * Pricing rework, Stage 0 (docs/PRICING_LOGIC.md §8.6). The tests that import
 * this file pin what the pricing code on origin/main ed3b832 produces, figure by
 * figure, so every later stage can show which numbers it moved and prove it
 * moved nothing else.
 *
 * A pinned figure may change only in the stage approved to change it, and the
 * commit that changes it says so.
 *
 * Figures are read through the projections at the bottom of this file, which
 * name them in the approved vocabulary rather than today's field names. A
 * Stage 2 rename edits a projection, never a pinned value.
 *
 * Every figure is in the CREDITS NOT APPLIED state unless its name says
 * `CreditsApplied`.
 *
 * Not a test file (no `.test.ts`), so vitest does not collect it.
 */
import { adderTotals, type AdderLine } from "@/lib/solar-adders";
import { compareOffers, type OfferProduct } from "@/lib/solar-compare";
import type { CreditClaims, CreditRates } from "@/lib/solar-credit-ladder";
import { financeRowForProduct, type LenderProductTerms } from "@/lib/solar-finance-row";
import { lenderProductLabel } from "@/lib/solar-lender-product";
import {
  batteryChargeCents,
  grossPpwFromNet,
  priceStorageStored,
  priceStoredPurchase,
  year1Production,
  type SolarAssumptions,
} from "@/lib/solar-money";
import { buildProposalSnapshot, type ProposalPaymentOption } from "@/lib/solar-proposal";
import { proposalAlternatives, type CatalogueProgramme } from "@/lib/solar-proposal-options";
import type { SignTodayRule } from "@/lib/solar-sign-today";

/** SOLAR_ASSUMPTION_DEFAULTS (server/modules/solar/settings.ts), copied: that module imports Prisma. */
export const ASSUMPTIONS: SolarAssumptions = {
  derateFactor: 0.84,
  annualDegradationPct: 0.5,
  utilityEscalationPct: 3.5,
  kwhPerKwYear: 1450,
  utilityMeterFeeCents: 1000,
  defaultGrossPpwCents: 350,
  defaultDealerFeePct: 18,
  minOffsetPct: 0,
  maxOffsetPct: 150,
};

export const CREDIT_RATES: CreditRates = { itcPct: 30, energyCommunityPct: 10, domesticContentPct: 10 };

/** What a new deal ticks on ed3b832: the ITC, and neither bonus. */
export const ITC_ONLY: CreditClaims = { itc: true, energyCommunity: false, domesticContent: false };

export const GENERATED_AT = new Date("2026-09-15T12:00:00Z");

export type DealKey = "workedExample" | "cappedPartner" | "cash";

export type PerWattDeal = {
  product: "cash" | "loan";
  systemType: "pv" | "pv_storage";
  kw: number;
  /** What the rep sold the system at, before any lender's cut. */
  basePpwCents: number;
  feePct: number;
  adders: { label: string; amountCents: number; financedOnTop: boolean }[];
  batteryQty: number;
  /** Catalogue price of one battery. */
  batteryEachCents: number;
  aprPct: number | null;
  termMonths: number | null;
  claims: CreditClaims;
  rule: {
    maxFinalPpwCents: number | null;
    finalPpwMode: "cap" | "flat";
    ppwBasis: "final" | "gross" | "base";
    minBasePpwCents: number | null;
  };
  signToday: SignTodayRule;
  signTodayTypedCents: number;
  lenderName: string | null;
  programmeName: string | null;
  /** Other programmes on the payment menu, beside the quoted one. */
  otherProgrammes: CatalogueProgramme[];
  usageKwh: number;
  billCents: number;
};

const WORKED_EXAMPLE_LINES: AdderLine[] = [
  { id: "mpu", label: "Main panel upgrade", basis: "flat", flatCents: 270_000, millsPerWatt: null, qty: 1 },
  { id: "steep", label: "Steep roof", basis: "perWatt", flatCents: null, millsPerWatt: 100, qty: 1 },
];

/** Credit Humen's shape in production: an UNNAMED programme, so its label carries the fee. */
const UNNAMED_SECOND_PROGRAMME: CatalogueProgramme = {
  id: "programme-second",
  product: "loan",
  name: null,
  aprPct: 0,
  termMonths: 360,
  dealerFeePct: 25,
  leaseRateCentsPerKwMonth: null,
  rateMillsPerKwh: null,
  escalatorPct: null,
  termYears: null,
  factorWithPaydownMicros: null,
  factorWithoutPaydownMicros: null,
  paydownPct: null,
  paydownMonths: null,
  rank: 2,
  ppwBasis: "final",
  batteryPriceBasis: "final",
  lender: {
    id: "lender-second",
    name: "Second Lender",
    rank: 2,
    applyUrl: null,
    logoUrl: null,
    maxFinalPpwCents: 1000,
    finalPpwMode: "cap",
    signTodayMode: "fixed",
    signTodayFixedCents: 0,
    signTodayCapPpwCents: null,
  },
};

export const DEALS: Record<DealKey, PerWattDeal> = {
  /** docs/PRICING_LOGIC.md §4: every figure in §4.2 comes from this deal. */
  workedExample: {
    product: "loan",
    systemType: "pv_storage",
    kw: 10,
    basePpwCents: 300,
    feePct: 25,
    adders: adderTotals(WORKED_EXAMPLE_LINES, 10_000).lines.map((l) => ({
      label: l.label,
      amountCents: l.amountCents,
      financedOnTop: false,
    })),
    batteryQty: 1,
    batteryEachCents: 1_500_000,
    aprPct: 6.99,
    termMonths: 300,
    claims: ITC_ONLY,
    rule: { maxFinalPpwCents: null, finalPpwMode: "cap", ppwBasis: "final", minBasePpwCents: null },
    signToday: { mode: "none", fixedCents: null, capPpwCents: null },
    signTodayTypedCents: 0,
    lenderName: "Example Lender",
    programmeName: null,
    otherProgrammes: [],
    usageKwh: 12_000,
    billCents: 18_000,
  },
  /**
   * Amos 30 Year Solar as production has it configured: a $5.50/W cap on the
   * final price, a $2.00/W floor, sign-today above a $6.00/W cap, and deals
   * storing a 65% fee. 12.76 kW at $1.93/W with two $36,000 batteries, the deal
   * the system-price card test is built on, plus a re-roof outside the rule.
   */
  cappedPartner: {
    product: "loan",
    systemType: "pv_storage",
    kw: 12.76,
    basePpwCents: 193,
    feePct: 65,
    adders: [{ label: "Re-roof", amountCents: 700_000, financedOnTop: true }],
    batteryQty: 2,
    batteryEachCents: 3_600_000,
    aprPct: 0,
    termMonths: 360,
    claims: ITC_ONLY,
    rule: { maxFinalPpwCents: 550, finalPpwMode: "cap", ppwBasis: "final", minBasePpwCents: 200 },
    signToday: { mode: "above_cap", fixedCents: null, capPpwCents: 600 },
    signTodayTypedCents: 0,
    lenderName: "Capped Partner",
    programmeName: "30 Year Solar",
    otherProgrammes: [UNNAMED_SECOND_PROGRAMME],
    usageKwh: 15_000,
    billCents: 22_000,
  },
  cash: {
    product: "cash",
    systemType: "pv",
    kw: 8,
    basePpwCents: 310,
    feePct: 0,
    adders: [{ label: "Critter guard", amountCents: 150_000, financedOnTop: false }],
    batteryQty: 0,
    batteryEachCents: 0,
    aprPct: null,
    termMonths: null,
    claims: ITC_ONLY,
    rule: { maxFinalPpwCents: null, finalPpwMode: "cap", ppwBasis: "final", minBasePpwCents: null },
    signToday: { mode: "none", fixedCents: null, capPpwCents: null },
    signTodayTypedCents: 50_000,
    lenderName: null,
    programmeName: null,
    otherProgrammes: [],
    usageKwh: 10_000,
    billCents: 15_000,
  },
};

/**
 * Amos 20 Year Battery as production has it: 50% fee, a $12,000 flat price per
 * battery on the GROSS basis, storage-only paper. Two batteries at a $10,000 base.
 */
export const STORAGE_DEAL = {
  batteryQty: 2,
  basePerBatteryCents: 1_000_000,
  feePct: 50,
  maxFinalPricePerBatteryCents: 1_200_000,
  finalBatteryPriceMode: "flat" as const,
  batteryPriceBasis: "gross" as const,
  aprPct: 0,
  termMonths: 240,
  claims: ITC_ONLY,
  signToday: { mode: "above_cap", fixedCents: null, capPpwCents: 600 } satisfies SignTodayRule,
  lenderName: "Battery Partner",
  programmeName: "20 Year Battery",
  usageKwh: 13_000,
  billCents: 21_000,
};

const sum = (xs: number[]) => xs.reduce((n, x) => n + x, 0);

/** Run one per-watt deal through every pure pricing site, the way the app calls each. */
export function priceToday(d: PerWattDeal) {
  const watts = Math.round(d.kw * 1000);
  const inside = sum(d.adders.filter((a) => !a.financedOnTop).map((a) => a.amountCents));
  const onTop = sum(d.adders.filter((a) => a.financedOnTop).map((a) => a.amountCents));
  const battery = batteryChargeCents({
    systemType: d.systemType,
    batteryQty: d.batteryQty,
    dealPerBatteryCents: null,
    cataloguePerBatteryCents: d.batteryEachCents,
  });
  const feePct = d.product === "cash" ? 0 : d.feePct;
  const typedSticker = d.product === "cash" ? d.basePpwCents : grossPpwFromNet(d.basePpwCents, feePct)!;

  const priced = priceStoredPurchase({
    product: d.product,
    systemSizeKwDc: d.kw,
    stickerPpwCents: typedSticker,
    dealerFeePct: feePct,
    adderTotalCents: inside,
    onTopAdderTotalCents: onTop,
    batteryPriceCents: battery,
    maxFinalPpwCents: d.rule.maxFinalPpwCents,
    finalPpwMode: d.rule.finalPpwMode,
    ppwBasis: d.rule.ppwBasis,
  });

  const lenderProduct: LenderProductTerms | null =
    d.product === "cash"
      ? null
      : {
          id: "programme-quoted",
          product: d.product,
          aprPct: d.aprPct,
          termMonths: d.termMonths,
          dealerFeePct: d.feePct,
          leaseRateCentsPerKwMonth: null,
          rateMillsPerKwh: null,
          escalatorPct: null,
          termYears: null,
          maxFinalPpwCents: d.rule.maxFinalPpwCents,
          finalPpwMode: d.rule.finalPpwMode,
          ppwBasis: d.rule.ppwBasis,
          batteryPriceBasis: "final",
        };

  const row = financeRowForProduct(
    {
      product: d.product,
      grossPpwCents: typedSticker,
      dealerFeePct: feePct,
      adderTotalCents: inside,
      onTopAdderTotalCents: onTop,
      batteryPriceCents: battery,
      aprPct: d.aprPct,
      loanTermMonths: d.termMonths,
      lenderProductId: lenderProduct?.id ?? null,
    },
    { systemSizeKwDc: d.kw, assumptions: ASSUMPTIONS, lenderProduct, targetNetPpwCents: null }
  );

  const production = year1Production(d.kw, ASSUMPTIONS, null);

  const offer: OfferProduct = {
    id: "programme-quoted",
    lenderId: "lender-quoted",
    lenderName: d.lenderName ?? "Lender",
    label: d.programmeName ?? "Programme",
    product: "loan",
    aprPct: d.aprPct,
    termMonths: d.termMonths,
    dealerFeePct: d.feePct,
    leaseRateCentsPerKwMonth: null,
    rateMillsPerKwh: null,
    escalatorPct: null,
    termYears: null,
    factorWithPaydownMicros: null,
    factorWithoutPaydownMicros: null,
    paydownPct: null,
    paydownMonths: null,
    maxFinalPpwCents: d.rule.maxFinalPpwCents,
    finalPpwMode: d.rule.finalPpwMode,
    ppwBasis: d.rule.ppwBasis,
    signTodayMode: d.signToday.mode,
    signTodayFixedCents: d.signToday.fixedCents,
    signTodayCapPpwCents: d.signToday.capPpwCents,
    isActive: true,
  };
  const offers: Parameters<typeof compareOffers>[0] =
    d.product === "cash" ? [{ kind: "cash" }] : [offer, { kind: "cash" }];
  const columns = compareOffers(offers, {
    systemSizeKwDc: d.kw,
    year1ProductionKwh: production,
    adderTotalCents: inside,
    onTopAdderTotalCents: onTop,
    batteryPriceCents: battery,
    downPaymentCents: 0,
    basePpwCents: d.basePpwCents,
    annualDegradationPct: ASSUMPTIONS.annualDegradationPct,
    credits: { rates: CREDIT_RATES, claims: d.claims, signTodayTypedCents: d.signTodayTypedCents },
  });

  const alternatives = proposalAlternatives({
    quoted: {
      product: d.product,
      lenderProductId: lenderProduct?.id ?? null,
      lenderId: lenderProduct ? "lender-quoted" : null,
      grossPpwCents: row.grossPpwCents,
      dealerFeePct: row.dealerFeePct,
    },
    programmes: d.otherProgrammes,
    approvedLenderIds: null,
    design: { systemSizeKwDc: d.kw },
    batteryPriceCents: battery,
    systemType: d.systemType,
    storage: null,
    adders: d.adders,
    adderTotalCents: inside,
    onTopAdderTotalCents: onTop,
    assumptions: ASSUMPTIONS,
    targetNetPpwCents: null,
  });

  const snapshot = buildProposalSnapshot({
    reference: "SP-GOLDEN",
    generatedById: null,
    customer: { name: "Golden Household", address: "1 Example St" },
    company: { name: "Example Solar", phone: null, email: null, logoUrl: null },
    design: {
      systemSizeKwDc: d.kw,
      year1ProductionKwh: production,
      offsetPct: (production / d.usageKwh) * 100,
      annualUsageKwh: d.usageKwh,
      moduleLabel: "400 W module",
      moduleQty: Math.round(watts / 400),
      inverterLabel: null,
      batteryLabel: d.batteryQty > 0 ? "Battery" : null,
      batteryQty: d.batteryQty,
      mountType: "roof",
      utilityProvider: null,
      avgMonthlyBillCents: d.billCents,
    },
    finance: {
      product: d.product,
      grossPpwCents: row.grossPpwCents,
      batteryPriceCents: battery,
      dealerFeePct: row.dealerFeePct,
      adderTotalCents: row.adderTotalCents,
      onTopAdderTotalCents: row.onTopAdderTotalCents,
      adders: d.adders,
      rateMillsPerKwh: null,
      monthlyPaymentCents: null,
      escalatorPct: null,
      termYears: null,
      aprPct: row.aprPct,
      loanMonthlyPaymentCents: null,
      loanTermMonths: row.loanTermMonths,
      downPaymentCents: null,
    },
    lender: d.lenderName,
    // As generation labels the quoted programme (proposal-generate.ts).
    lenderProductLabel:
      d.product === "cash"
        ? null
        : lenderProductLabel({
            product: d.product,
            name: d.programmeName,
            aprPct: d.aprPct,
            termMonths: d.termMonths,
            dealerFeePct: d.feePct,
          }),
    loanFactors: null,
    creditRates: CREDIT_RATES,
    creditClaims: d.claims,
    signTodayTypedCents: d.signTodayTypedCents,
    signTodayRule: d.signToday,
    alternatives,
    assumptions: ASSUMPTIONS,
    systemType: d.systemType,
    now: GENERATED_AT,
  });

  return { watts, inside, onTop, battery, typedSticker, priced, row, production, columns, alternatives, snapshot };
}

export type PricedToday = ReturnType<typeof priceToday>;

/** The storage-only deal through the per-battery ladder and the document. */
export function storageToday() {
  const s = STORAGE_DEAL;
  const typedSticker = grossPpwFromNet(s.basePerBatteryCents, s.feePct)!;
  const priced = priceStorageStored({
    product: "loan",
    batteryQty: s.batteryQty,
    stickerPricePerBatteryCents: typedSticker,
    dealerFeePct: s.feePct,
    adderTotalCents: 0,
    onTopAdderTotalCents: 0,
    maxFinalPricePerBatteryCents: s.maxFinalPricePerBatteryCents,
    finalBatteryPriceMode: s.finalBatteryPriceMode,
    batteryPriceBasis: s.batteryPriceBasis,
  });
  const sticker = priced.cap.stickerPerUnitCents;

  const alternatives = proposalAlternatives({
    quoted: {
      product: "loan",
      lenderProductId: "programme-quoted",
      lenderId: "lender-quoted",
      grossPpwCents: 0,
      dealerFeePct: s.feePct,
    },
    programmes: [],
    approvedLenderIds: null,
    design: { systemSizeKwDc: 0 },
    systemType: "storage",
    storage: { batteryQty: s.batteryQty, stickerPricePerBatteryCents: sticker },
    adders: [],
    adderTotalCents: 0,
    onTopAdderTotalCents: 0,
    assumptions: ASSUMPTIONS,
    targetNetPpwCents: null,
  });

  const snapshot = buildProposalSnapshot({
    reference: "SP-GOLDEN-STORAGE",
    generatedById: null,
    customer: { name: "Golden Household", address: "1 Example St" },
    company: { name: "Example Solar", phone: null, email: null, logoUrl: null },
    design: {
      systemSizeKwDc: 0,
      year1ProductionKwh: 0,
      offsetPct: 0,
      annualUsageKwh: s.usageKwh,
      moduleLabel: null,
      moduleQty: 0,
      inverterLabel: null,
      batteryLabel: "Battery",
      batteryQty: s.batteryQty,
      mountType: "roof",
      utilityProvider: null,
      avgMonthlyBillCents: s.billCents,
    },
    finance: {
      product: "loan",
      grossPpwCents: 0,
      stickerPricePerBatteryCents: sticker,
      dealerFeePct: s.feePct,
      adderTotalCents: 0,
      onTopAdderTotalCents: 0,
      adders: [],
      rateMillsPerKwh: null,
      monthlyPaymentCents: null,
      escalatorPct: null,
      termYears: null,
      aprPct: s.aprPct,
      loanMonthlyPaymentCents: null,
      loanTermMonths: s.termMonths,
      downPaymentCents: null,
    },
    lender: s.lenderName,
    lenderProductLabel: lenderProductLabel({
      product: "loan",
      name: s.programmeName,
      aprPct: s.aprPct,
      termMonths: s.termMonths,
      dealerFeePct: s.feePct,
    }),
    loanFactors: null,
    creditRates: CREDIT_RATES,
    creditClaims: s.claims,
    signTodayTypedCents: 0,
    signTodayRule: s.signToday,
    alternatives,
    assumptions: ASSUMPTIONS,
    systemType: "storage",
    now: GENERATED_AT,
  });

  return { typedSticker, priced, alternatives, snapshot };
}

// ── Projections: today's fields, in the approved vocabulary ─────────────────

const r4 = (n: number) => Math.round(n * 10_000) / 10_000;

type Breakdown = ReturnType<typeof priceStoredPurchase>["breakdown"];
type UnitBreakdown = ReturnType<typeof priceStorageStored>["breakdown"];
type Row = ReturnType<typeof financeRowForProduct>;
type Column = ReturnType<typeof compareOffers>[number];

export const ladderFigures = (b: Breakdown) => ({
  basePriceCents: b.basePriceCents,
  basePpwCents: r4(b.basePpwCents),
  addersCents: b.adderTotalCents,
  addersOutsideRuleCents: b.onTopAdderTotalCents,
  equipmentChargesCents: b.batteryPriceCents,
  grossPriceCents: b.grossPriceCents,
  grossPpwCents: r4(b.grossPpwCents),
  dealerFeeCents: b.dealerFeeCents,
  finalCents: b.contractPriceCents,
  finalPpwCents: r4(b.finalPpwCents),
  baseFinalCents: b.baseStickerCents,
  addersFinalCents: b.adderStickerCents,
  addersOutsideRuleFinalCents: b.onTopAdderStickerCents,
  equipmentFinalCents: b.batteryStickerCents,
});

export const unitLadderFigures = (b: UnitBreakdown) => ({
  units: b.units,
  basePriceCents: b.basePriceCents,
  basePerUnitCents: r4(b.basePerUnitCents),
  addersCents: b.adderTotalCents,
  grossPriceCents: b.grossPriceCents,
  dealerFeeCents: b.dealerFeeCents,
  finalCents: b.contractPriceCents,
  finalPerUnitCents: r4(b.finalPerUnitCents),
  baseFinalCents: b.baseStickerCents,
  addersFinalCents: b.adderStickerCents,
});

export const rowFigures = (row: Row) => ({
  product: row.product,
  stickerPpwCents: row.grossPpwCents,
  dealerFeePct: row.dealerFeePct,
  addersInsideRuleCents: row.adderTotalCents,
  addersOutsideRuleCents: row.onTopAdderTotalCents,
  finalCents: row.contractPriceCents,
  aprPct: row.aprPct,
  loanTermMonths: row.loanTermMonths,
});

export const columnFigures = (c: Column) => ({
  id: c.id,
  product: c.product,
  stickerPpwCents: c.grossPpwCents,
  dealerFeePct: c.dealerFeePct,
  finalCents: c.contractPriceCents,
  grossPpwCents: c.netPpwCents,
  capped: c.capped,
  adderOverrun: c.adderOverrun,
  monthlyHeadlineCents: c.monthlyCents,
  monthlyOnFinalCents: c.withoutCreditsMonthlyCents,
  monthlyWithoutPaydownCents: c.monthlyWithoutPaydownCents,
  paydownCents: c.paydownCents,
  netFinalCreditsAppliedCents: c.netCostAfterCreditsCents,
  totalPaidCents: c.totalPaidCents,
  totalPaidWithoutPaydownCents: c.totalPaidWithoutPaydownCents,
});

export const optionFigures = (o: ProposalPaymentOption) => {
  const f = o.financing;
  const ladder = f.creditLadder ?? null;
  const applied = o.creditsApplied ?? null;
  return {
    // A programme's key carries its row id, which a database test mints fresh.
    key: o.key.replace(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/g, "<id>"),
    label: o.label,
    quoted: o.quoted,
    product: f.product,
    programmeLabel: f.lenderProductLabel ?? null,
    stickerPpwCents: f.grossPpwCents ?? null,
    baseFinalCents: f.basePriceCents ?? null,
    addersFinalCents: f.adderTotalCents ?? null,
    adderLinesFinal: (f.adders ?? []).map((a) => [a.label, a.amountCents]),
    equipmentFinalCents: f.batteryPriceCents ?? null,
    finalCents: f.contractPriceCents ?? null,
    finalPpwCents: f.finalPpwCents ?? null,
    financedCents: f.financedAmountCents ?? null,
    monthlyCents: o.monthlyCents,
    monthlyWithoutPaydownCents: f.loanMonthlyWithoutPaydownCents ?? null,
    paydownCents: f.loanPaydownCents ?? null,
    credits: ladder ? ladder.credits.map((c) => [c.key, c.pct, c.amountCents]) : null,
    creditAmountCents: ladder?.creditTotalCents ?? null,
    signTodayCents: ladder?.signTodayCents ?? null,
    netFinalCreditsAppliedCents: ladder?.netCostCents ?? null,
    monthlyCreditsAppliedCents: applied?.monthlyCents ?? null,
    financedCreditsAppliedCents: applied?.financedAmountCents ?? null,
    totalCreditsAppliedCents: applied?.totalCents ?? null,
    postSolarMonthlyCents: o.postSolarMonthlyCents,
    savings: {
      paidCents: o.savings.solarPaidCents,
      netCents: o.savings.netSavingsCents,
      paybackYear: o.savings.paybackYear,
    },
    savingsCreditsApplied: applied
      ? {
          paidCents: applied.savings.solarPaidCents,
          netCents: applied.savings.netSavingsCents,
          paybackYear: applied.savings.paybackYear,
        }
      : null,
    // The customer-claims disclaimer. D4 replaces it in Stage 1, with sign-off.
    disclaimer: ladder?.disclaimer ?? null,
  };
};
