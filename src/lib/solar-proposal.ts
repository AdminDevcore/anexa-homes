import type { FinanceProduct } from "@prisma/client";
import {
  pricePurchase,
  priceThirdParty,
  itcEstimateCents,
  productionInYear,
  deriveUtilityRateMills,
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
  /** What the utility would have charged for the WHOLE home, this year. */
  utilityCostCents: number;
  /** Grid power still bought after solar, this year. */
  residualGridCents: number;
  /** What solar itself costs this year (purchase price in yr 1, or the lease/PPA payment). */
  solarPaymentCents: number;
  /** residualGrid + solarPayment — the total cost of the solar path this year. */
  solarCostCents: number;
  cumulativeSavingsCents: number;
};

export type SavingsModel = {
  years: SavingsYear[];
  /**
   * Utility bill avoided, BEFORE paying for the system: Σ(utility) − Σ(residual grid).
   *
   * This is the number most solar proposals print as "25-year savings". It is
   * not savings — it is the gross reduction in the utility bill, and it ignores
   * the cheque the customer writes for the system. Anexa labels it exactly what
   * it is and shows `netSavingsCents` as the headline.
   */
  utilityCostAvoidedCents: number;
  /** Σ(solar payments): the purchase price, or the lease/PPA payments over the term. */
  solarPaidCents: number;
  /**
   * The honest figure: utility avoided − what solar cost.
   *   net = Σ(utility) − Σ(residual grid) − Σ(solar payments)
   * Negative is a legitimate answer and is rendered as such.
   */
  netSavingsCents: number;
  /** Kept as an alias of netSavingsCents so existing callers stay correct. */
  totalSavingsCents: number;
  /** First year in which cumulative savings turn positive; null if never. */
  paybackYear: number | null;
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
}): SavingsModel {
  const a = args.assumptions;
  const horizon = args.years ?? 25;
  const rows: SavingsYear[] = [];
  let cumulative = 0;
  let utilityTotal = 0;
  let residualTotal = 0;
  let solarPaidCents = 0;
  let paybackYear: number | null = null;

  for (let year = 1; year <= horizon; year++) {
    const production = productionInYear(args.year1ProductionKwh, year, a);

    // What the utility would have charged for the whole home's usage.
    const utilityRate = args.currentRateMillsPerKwh * Math.pow(1 + a.utilityEscalationPct / 100, year - 1);
    const utilityCostCents = Math.round((args.annualUsageKwh * utilityRate) / 10);

    // Grid power still needed after solar covers what it can.
    const gridKwh = Math.max(0, args.annualUsageKwh - production);
    const residualGridCents = Math.round((gridKwh * utilityRate) / 10);

    // What the solar itself costs this year — kept SEPARATE from the residual
    // grid bill so the proposal can show "bill avoided" and "net of what you
    // paid for the system" as two different, correctly-labelled numbers.
    let solarPaymentCents = 0;
    if (args.product === "cash" || args.product === "loan") {
      // The system is paid for up front (or financed outside this model), so
      // year-one carries the contract price and later years carry nothing.
      if (year === 1) solarPaymentCents = args.purchase?.contractPriceCents ?? 0;
    } else {
      const esc = Math.pow(1 + (args.escalatorPct ?? 0) / 100, year - 1);
      const withinTerm = !args.termYears || year <= args.termYears;
      if (withinTerm) {
        solarPaymentCents =
          args.product === "ppa"
            ? Math.round((production * (args.ppaRateMills ?? 0) * esc) / 10)
            : Math.round((args.leaseMonthlyCents ?? 0) * 12 * esc);
      }
    }

    const solarCostCents = residualGridCents + solarPaymentCents;
    cumulative += utilityCostCents - solarCostCents;
    utilityTotal += utilityCostCents;
    residualTotal += residualGridCents;
    solarPaidCents += solarPaymentCents;
    if (paybackYear === null && cumulative > 0) paybackYear = year;

    rows.push({
      year,
      productionKwh: Math.round(production),
      utilityCostCents,
      residualGridCents,
      solarPaymentCents,
      solarCostCents,
      cumulativeSavingsCents: cumulative,
    });
  }

  return {
    years: rows,
    utilityCostAvoidedCents: utilityTotal - residualTotal,
    solarPaidCents,
    netSavingsCents: cumulative,
    totalSavingsCents: cumulative,
    paybackYear,
  };
}

/** An equipment line as the customer sees it — catalogue data only, never invented. */
export type SnapshotEquipment = {
  manufacturer: string | null;
  model: string;
  /** Modules: watts/panel. Inverters: rated output W. Batteries: usable Wh. */
  ratingW: number | null;
  qty: number;
};

export type SolarProposalSnapshot = {
  /**
   * Bumped when the shape changes, so old proposals still render.
   * v2 adds the energy profile, equipment detail, layout image, company
   * identity, representative and the utility-avoided/net-savings split.
   */
  schemaVersion: 1 | 2;
  generatedAt: string;
  /** Who generated it — recorded on the document, not shown to the customer. */
  generatedById: string | null;
  /** Human-facing document reference, e.g. "SP-1042-V2". */
  reference: string;
  customer: { name: string; address: string };
  company: {
    name: string;
    phone: string | null;
    email: string | null;
    logoUrl: string | null;
    address: string | null;
  };
  /** The rep the homeowner actually deals with. Null fields are omitted. */
  representative: { name: string; phone: string | null; email: string | null } | null;
  /** Section 2 — what the customer pays for power today. */
  energy: {
    utilityProvider: string | null;
    ratePlan: string | null;
    annualUsageKwh: number;
    avgMonthlyBillCents: number | null;
    /** usage × derived rate. Null when the rate could not be derived. */
    currentAnnualCostCents: number | null;
  };
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
    /** Null when the site has not been surveyed. */
    tsrfPct: number | null;
    module: SnapshotEquipment | null;
    inverter: SnapshotEquipment | null;
    battery: SnapshotEquipment | null;
  };
  /**
   * The panel layout drawing. Null means no usable layout — the section is
   * OMITTED rather than rendered with a placeholder or an aerial photo.
   *
   * Holds the FILE ID, not a URL. A URL would have had to embed the public
   * share token, which would then be frozen into the snapshot and leak into
   * every internal preview of it. Each renderer builds its own URL from this id:
   * the portal uses the authenticated file route, the customer's copy uses the
   * token-scoped one. The id is an identity, not a secret.
   */
  layout: {
    fileId: string;
    provider: string | null;
    externalRef: string | null;
    /** True until an authorised user marks the drawing final. */
    preliminary: boolean;
  } | null;
  financing: {
    product: FinanceProduct;
    /** Cash/loan only. */
    contractPriceCents: number | null;
    grossPpwCents: number | null;
    basePriceCents: number | null;
    adderTotalCents: number | null;
    finalPpwCents: number | null;
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
    /** Free-text state/local incentive summary. Null = section omitted. */
    stateIncentiveNote: string | null;
  };
  savings: SavingsModel;
  environmental: ReturnType<typeof environmentalImpact>;
  /** Every assumption, recorded so the document explains its own numbers. */
  assumptions: SolarAssumptions & { currentRateMillsPerKwh: number };
  disclaimers: { incentive: string; estimate: string };
};

/** The standing non-binding-estimate wording. Shown on every proposal. */
export const ESTIMATE_DISCLAIMER =
  "This proposal is an estimate, not a binding offer or a guarantee of financing. Production, savings and utility rates are projections based on the assumptions listed and will vary with weather, usage, equipment availability and utility rate changes. Financing is subject to credit approval and lender terms. Figures do not constitute tax advice.";

export function buildProposalSnapshot(args: {
  reference: string;
  generatedById: string | null;
  customer: { name: string; address: string };
  company: {
    name: string;
    phone: string | null;
    email: string | null;
    logoUrl: string | null;
    address?: string | null;
  };
  representative?: { name: string; phone: string | null; email: string | null } | null;
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
    ratePlan?: string | null;
    netMeteringProgram: string | null;
    avgMonthlyBillCents: number | null;
    tsrfPct?: number | null;
    module?: SnapshotEquipment | null;
    inverter?: SnapshotEquipment | null;
    battery?: SnapshotEquipment | null;
  };
  layout?: { fileId: string; provider: string | null; externalRef: string | null; preliminary: boolean } | null;
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
  stateIncentiveNote?: string | null;
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

  // Today's rate, derived from the customer's OWN bill. There is deliberately no
  // fallback: this used to default to 150 mills when the bill was missing, which
  // produced a confident 25-year savings projection built on a rate nobody had
  // ever seen. The readiness validator blocks generation when it cannot be
  // derived, so by the time we get here it is a real number.
  const currentRateMillsPerKwh =
    deriveUtilityRateMills(design.avgMonthlyBillCents, design.annualUsageKwh) ?? 0;

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
    schemaVersion: 2,
    generatedAt: args.now.toISOString(),
    generatedById: args.generatedById,
    reference: args.reference,
    customer: args.customer,
    company: {
      name: args.company.name,
      phone: args.company.phone,
      email: args.company.email,
      logoUrl: args.company.logoUrl,
      address: args.company.address ?? null,
    },
    representative: args.representative ?? null,
    energy: {
      utilityProvider: design.utilityProvider,
      ratePlan: design.ratePlan ?? null,
      annualUsageKwh: design.annualUsageKwh,
      avgMonthlyBillCents: design.avgMonthlyBillCents,
      // usage × today's rate. Null rather than 0 when the rate is unknown, so
      // the renderer omits the line instead of printing "$0 a year".
      currentAnnualCostCents:
        currentRateMillsPerKwh > 0
          ? Math.round((design.annualUsageKwh * currentRateMillsPerKwh) / 10)
          : null,
    },
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
      tsrfPct: design.tsrfPct ?? null,
      module: design.module ?? null,
      inverter: design.inverter ?? null,
      battery: design.battery ?? null,
    },
    layout: args.layout ?? null,
    financing: {
      product: finance.product,
      contractPriceCents: purchase?.contractPriceCents ?? null,
      grossPpwCents: purchase ? finance.grossPpwCents : null,
      basePriceCents: purchase?.grossPriceCents ?? null,
      // Null, not 0, when there are no adders: the renderer omits the row
      // rather than printing an "Adders $0" line the customer has to parse.
      adderTotalCents: purchase && purchase.adderTotalCents > 0 ? purchase.adderTotalCents : null,
      finalPpwCents: purchase ? Math.round(purchase.finalPpwCents) : null,
      // Lease/PPA carry no APR. Gating here as well as at the write means a
      // stale value left on the row by a product switch can never reach a
      // customer as a fabricated lender term.
      monthlyPaymentCents: isPurchase ? null : finance.monthlyPaymentCents,
      rateMillsPerKwh: finance.product === "ppa" ? finance.rateMillsPerKwh : null,
      escalatorPct: isPurchase ? null : finance.escalatorPct,
      termYears: finance.termYears,
      aprPct: finance.product === "loan" ? finance.aprPct : null,
      lender: finance.product === "loan" ? args.lender : null,
      // Null, not zero: an unconfigured credit omits the line entirely rather
      // than showing the customer "$0 federal credit".
      itcEstimateCents: a.federalItcPct == null ? null : itc,
      itcPct: a.federalItcPct,
      stateIncentiveNote: args.stateIncentiveNote ?? null,
    },
    savings,
    environmental: environmentalImpact(lifetimeKwh),
    assumptions: { ...a, currentRateMillsPerKwh },
    disclaimers: { incentive: args.incentiveDisclaimer, estimate: ESTIMATE_DISCLAIMER },
  };
}
