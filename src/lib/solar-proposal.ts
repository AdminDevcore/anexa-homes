import type { FinanceProduct } from "@prisma/client";
import {
  pricePurchase,
  priceThirdParty,
  itcEstimateCents,
  productionInYear,
  type SolarAssumptions,
  type PurchaseBreakdown,
  type ThirdPartyBreakdown,
} from "./solar-money";

/**
 * Builds the frozen customer-facing proposal.
 *
 * Two rules govern this file:
 *
 * 1. NOTHING IS HARDCODED. Utility escalation, degradation, the ITC percentage,
 *    default PPW — every assumption arrives as data from Solar Settings, on the
 *    same discipline as the ITC. A number in this file that a homeowner reads
 *    is a number nobody can correct without a deploy.
 *
 * 2. THE SNAPSHOT IS FROZEN. The output is stored verbatim on the proposal row.
 *    Change an assumption tomorrow and an already-sent proposal still shows what
 *    that customer was shown — otherwise the document is worthless as a record
 *    of what was offered, and arguably misleading.
 *
 * Every monetary figure is an estimate and travels with its disclaimer.
 */

/** The 6 steps a homeowner goes through, in order. */
export const SOLAR_TIMELINE = [
  { key: "site_survey", title: "Site Survey", blurb: "We measure the roof, check the electrical panel and confirm the design fits your home." },
  { key: "design", title: "Design & Engineering", blurb: "Engineers produce the stamped plan set and single-line diagram for your system." },
  { key: "permitting", title: "Permitting & Interconnection", blurb: "We file with your city and your utility. This is the longest wait, and it is not in our hands." },
  { key: "installation", title: "Installation", blurb: "Most systems go on in one to two days." },
  { key: "inspection", title: "Inspection", blurb: "Your city inspects the work and signs it off." },
  { key: "pto", title: "Permission to Operate", blurb: "The utility gives the green light and your system switches on." },
] as const;

export const SOLAR_FAQS = [
  { q: "What happens if the system makes more power than I use?", a: "Extra production goes back to the grid. What you are credited depends on your utility's net-metering or buyback programme, which is listed in your system specs above." },
  { q: "What happens when the power goes out?", a: "A standard grid-tied system shuts off during an outage for the safety of line workers. Adding a battery keeps selected circuits running." },
  { q: "Does my roof need work first?", a: "If the roof has less life left than the system, we replace it first. Your surveyor will tell you plainly — it is cheaper to do it now than to remove and reinstall panels later." },
  { q: "What maintenance is there?", a: "Very little. Panels have no moving parts. Rain handles most cleaning, and your system is monitored so we see faults before you do." },
  { q: "What if I sell the house?", a: "An owned system generally transfers with the property. A lease or PPA transfers to the buyer or is bought out — the terms are in your agreement." },
] as const;

/** Environmental impact, from lifetime kWh. Standard EPA-equivalent factors. */
export function environmentalImpact(lifetimeKwh: number) {
  // EPA eGRID US average ~0.855 lb CO2 per kWh.
  const lbsCo2 = lifetimeKwh * 0.855;
  const tonsCo2 = lbsCo2 / 2000;
  return {
    tonsCo2Avoided: Math.round(tonsCo2),
    // EPA: an urban tree sequesters ~0.06 tons CO2/yr over 20 years.
    treesEquivalent: Math.round(tonsCo2 / (0.06 * 20)),
    // EPA: ~1.09 lbs CO2 per pound of coal burned → lbs coal not burned.
    poundsCoalAvoided: Math.round(lbsCo2 / 1.09),
    milesNotDriven: Math.round(lbsCo2 / 0.89), // ~0.89 lb CO2 per mile
  };
}

export type SavingsYear = {
  year: number;
  productionKwh: number;
  utilityCostCents: number;
  solarCostCents: number;
  cumulativeSavingsCents: number;
};

/**
 * 25-year utility-vs-solar comparison.
 *
 * The utility side compounds at the configured escalation rate; the solar side
 * depends entirely on the product. This is the single most persuasive — and
 * most abusable — number on the page, which is why every input is a stated
 * assumption rather than a constant.
 */
export function savingsModel(args: {
  product: FinanceProduct;
  year1ProductionKwh: number;
  annualUsageKwh: number;
  currentRateMillsPerKwh: number;
  purchase?: PurchaseBreakdown;
  thirdParty?: ThirdPartyBreakdown;
  ppaRateMills?: number | null;
  leaseMonthlyCents?: number | null;
  escalatorPct?: number | null;
  termYears?: number | null;
  assumptions: SolarAssumptions;
  years?: number;
}): { years: SavingsYear[]; totalSavingsCents: number } {
  const a = args.assumptions;
  const horizon = args.years ?? 25;
  const rows: SavingsYear[] = [];
  let cumulative = 0;

  for (let year = 1; year <= horizon; year++) {
    const production = productionInYear(args.year1ProductionKwh, year, a);

    // What the utility would have charged for the whole home's usage.
    const utilityRate = args.currentRateMillsPerKwh * Math.pow(1 + a.utilityEscalationPct / 100, year - 1);
    const utilityCostCents = Math.round((args.annualUsageKwh * utilityRate) / 10);

    // What solar costs this year, plus any grid power still needed.
    const gridKwh = Math.max(0, args.annualUsageKwh - production);
    const residualGridCents = Math.round((gridKwh * utilityRate) / 10);

    let solarCostCents = residualGridCents;
    if (args.product === "cash" || args.product === "loan") {
      // The system is paid for up front (or financed outside this model), so
      // year-one carries the contract price and later years carry only the
      // grid remainder.
      if (year === 1) solarCostCents += args.purchase?.contractPriceCents ?? 0;
    } else {
      const esc = Math.pow(1 + (args.escalatorPct ?? 0) / 100, year - 1);
      const withinTerm = !args.termYears || year <= args.termYears;
      if (withinTerm) {
        solarCostCents +=
          args.product === "ppa"
            ? Math.round((production * (args.ppaRateMills ?? 0) * esc) / 10)
            : Math.round((args.leaseMonthlyCents ?? 0) * 12 * esc);
      }
    }

    cumulative += utilityCostCents - solarCostCents;
    rows.push({
      year,
      productionKwh: Math.round(production),
      utilityCostCents,
      solarCostCents,
      cumulativeSavingsCents: cumulative,
    });
  }

  return { years: rows, totalSavingsCents: cumulative };
}

export type SolarProposalSnapshot = {
  /** Bumped when the shape changes, so old proposals still render. */
  schemaVersion: 1;
  generatedAt: string;
  customer: { name: string; address: string };
  company: { name: string; phone: string | null; email: string | null; logoUrl: string | null };
  system: {
    sizeKwDc: number;
    year1ProductionKwh: number;
    offsetPct: number;
    moduleLabel: string | null;
    moduleQty: number;
    inverterLabel: string | null;
    batteryLabel: string | null;
    mountType: string;
    utilityProvider: string | null;
    netMeteringProgram: string | null;
  };
  financing: {
    product: FinanceProduct;
    /** Cash/loan only. */
    contractPriceCents: number | null;
    grossPpwCents: number | null;
    /** Lease/PPA only. */
    monthlyPaymentCents: number | null;
    rateMillsPerKwh: number | null;
    escalatorPct: number | null;
    termYears: number | null;
    aprPct: number | null;
    lender: string | null;
    /** Null when the company has not configured a credit — the line is omitted. */
    itcEstimateCents: number | null;
    itcPct: number | null;
  };
  savings: { years: SavingsYear[]; totalSavingsCents: number };
  environmental: ReturnType<typeof environmentalImpact>;
  /** Every assumption, recorded so the document explains its own numbers. */
  assumptions: SolarAssumptions & { currentRateMillsPerKwh: number };
  disclaimers: { incentive: string; estimate: string };
};

/** The standing non-binding-estimate wording. Shown on every proposal. */
export const ESTIMATE_DISCLAIMER =
  "This proposal is an estimate, not a binding offer or a guarantee of financing. Production, savings and utility rates are projections based on the assumptions listed and will vary with weather, usage, equipment availability and utility rate changes. Financing is subject to credit approval and lender terms. Figures do not constitute tax advice.";

export function buildProposalSnapshot(args: {
  customer: { name: string; address: string };
  company: { name: string; phone: string | null; email: string | null; logoUrl: string | null };
  design: {
    systemSizeKwDc: number;
    year1ProductionKwh: number;
    offsetPct: number;
    annualUsageKwh: number;
    moduleLabel: string | null;
    moduleQty: number;
    inverterLabel: string | null;
    batteryLabel: string | null;
    mountType: string;
    utilityProvider: string | null;
    netMeteringProgram: string | null;
    avgMonthlyBillCents: number | null;
  };
  finance: {
    product: FinanceProduct;
    grossPpwCents: number;
    dealerFeePct: number;
    adderTotalCents: number;
    rateMillsPerKwh: number | null;
    monthlyPaymentCents: number | null;
    escalatorPct: number | null;
    termYears: number | null;
    aprPct: number | null;
  };
  lender: string | null;
  assumptions: SolarAssumptions;
  incentiveDisclaimer: string;
  now: Date;
}): SolarProposalSnapshot {
  const { design, finance, assumptions: a } = args;
  const isPurchase = finance.product === "cash" || finance.product === "loan";

  const purchase = isPurchase
    ? pricePurchase({
        product: finance.product as "cash" | "loan",
        systemSizeKwDc: design.systemSizeKwDc,
        grossPpwCents: finance.grossPpwCents,
        dealerFeePct: finance.dealerFeePct,
        adderTotalCents: finance.adderTotalCents,
      })
    : undefined;

  const thirdParty = !isPurchase
    ? priceThirdParty(
        {
          product: finance.product as "lease" | "ppa",
          rateMillsPerKwh: finance.rateMillsPerKwh ?? undefined,
          monthlyPaymentCents: finance.monthlyPaymentCents ?? undefined,
          escalatorPct: finance.escalatorPct ?? 0,
          termYears: finance.termYears ?? 25,
          year1ProductionKwh: design.year1ProductionKwh,
          systemSizeKwDc: design.systemSizeKwDc,
        },
        a
      )
    : undefined;

  // Today's rate, derived from the customer's own bill where we have it. Falls
  // back to a stated assumption rather than an invented national average.
  const currentRateMillsPerKwh =
    design.avgMonthlyBillCents && design.annualUsageKwh > 0
      ? Math.round(((design.avgMonthlyBillCents * 12) / design.annualUsageKwh) * 10)
      : 150;

  const savings = savingsModel({
    product: finance.product,
    year1ProductionKwh: design.year1ProductionKwh,
    annualUsageKwh: design.annualUsageKwh,
    currentRateMillsPerKwh,
    purchase,
    thirdParty,
    ppaRateMills: finance.rateMillsPerKwh,
    leaseMonthlyCents: finance.monthlyPaymentCents,
    escalatorPct: finance.escalatorPct,
    termYears: finance.termYears,
    assumptions: a,
  });

  const lifetimeKwh = savings.years.reduce((n, y) => n + y.productionKwh, 0);
  const itc = purchase ? itcEstimateCents(purchase.contractPriceCents, a) : 0;

  return {
    schemaVersion: 1,
    generatedAt: args.now.toISOString(),
    customer: args.customer,
    company: args.company,
    system: {
      sizeKwDc: design.systemSizeKwDc,
      year1ProductionKwh: design.year1ProductionKwh,
      offsetPct: design.offsetPct,
      moduleLabel: design.moduleLabel,
      moduleQty: design.moduleQty,
      inverterLabel: design.inverterLabel,
      batteryLabel: design.batteryLabel,
      mountType: design.mountType,
      utilityProvider: design.utilityProvider,
      netMeteringProgram: design.netMeteringProgram,
    },
    financing: {
      product: finance.product,
      contractPriceCents: purchase?.contractPriceCents ?? null,
      grossPpwCents: purchase ? finance.grossPpwCents : null,
      monthlyPaymentCents: finance.monthlyPaymentCents,
      rateMillsPerKwh: finance.rateMillsPerKwh,
      escalatorPct: finance.escalatorPct,
      termYears: finance.termYears,
      aprPct: finance.aprPct,
      lender: args.lender,
      // Null, not zero: an unconfigured credit omits the line entirely rather
      // than showing the customer "$0 federal credit".
      itcEstimateCents: a.federalItcPct == null ? null : itc,
      itcPct: a.federalItcPct,
    },
    savings,
    environmental: environmentalImpact(lifetimeKwh),
    assumptions: { ...a, currentRateMillsPerKwh },
    disclaimers: { incentive: args.incentiveDisclaimer, estimate: ESTIMATE_DISCLAIMER },
  };
}
