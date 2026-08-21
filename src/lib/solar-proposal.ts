import type { FinanceProduct } from "@prisma/client";
import { factorQuote, factorMonthlyCents, hasPaymentFactor, type PaymentFactors } from "./solar-loan";
import { resolveUtilityRateMills } from "./solar-energy";
import {
  apportionCents,
  pricePurchase,
  priceThirdParty,
  productionInYear,
  loanPaymentCents,
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

/**
 * Which model produced a proposal's production figure.
 *
 * Recorded on the document because the document lists the assumptions its
 * numbers came from, and "1,450 kWh per kW per year" is a false sentence on a
 * proposal whose production was simulated per plane instead.
 */
export type YieldBasis = {
  source: "pvwatts";
  /** The NSRDB station that answered. */
  station: string | null;
  /** How many arrays were simulated, out of how many there are. */
  arrays: number;
  totalArrays: number;
};

export type SolarProposalSnapshot = {
  /**
   * Bumped when the shape changes, so old proposals still render.
   * v2 adds the energy profile, equipment detail, layout image, company
   * identity, representative and the utility-avoided/net-savings split.
   * v3 names the adders instead of showing one "Additional work" total.
   */
  schemaVersion: 1 | 2 | 3;
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
    /**
     * HISTORICAL. Nothing collects a rate plan any more, so this is null on
     * every new snapshot — but proposals already sent carry a value, and the
     * snapshot is what those customers were shown. Kept so old documents keep
     * rendering exactly as they did.
     */
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
    /** HISTORICAL, like `energy.ratePlan`. Null on every new snapshot. */
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
    /**
     * The extra work, named, as it was priced on the day.
     *
     * v3 and later. A homeowner reading "Additional work — $14,500" on an
     * $82,660 contract, alone at their kitchen table with nobody to ask, has
     * one obvious question and no way to answer it. Naming the line is the
     * difference between a number that looks arbitrary and one that looks
     * justified.
     *
     * COPIED, like every other figure here: a later rename or reprice in the
     * catalogue must not rewrite what this customer was shown. Undefined on a
     * proposal generated before v3, which keeps rendering its single total.
     */
    adders?: { label: string; amountCents: number }[];
    finalPpwCents: number | null;
    /** Lease/PPA only. */
    monthlyPaymentCents: number | null;
    rateMillsPerKwh: number | null;
    escalatorPct: number | null;
    termYears: number | null;
    aprPct: number | null;
    /** Loan only: what the customer pays each month. */
    loanMonthlyPaymentCents: number | null;
    /**
     * True when that figure is the lender's own from an approval, false when it
     * is amortised from the quoted product. The document says which, because a
     * homeowner reading a payment is entitled to know whether it is settled.
     */
    loanPaymentApproved: boolean;
    /**
     * What the payment becomes if the paydown is never made.
     *
     * Frozen next to the quoted payment ON PURPOSE. A document that prints only
     * the low, paydown-contingent figure is the most misleading thing a solar
     * proposal can do, and a customer who never applies the credit finds out
     * from a bank statement.
     */
    loanMonthlyWithoutPaydownCents: number | null;
    loanPaydownCents: number | null;
    loanPaydownMonths: number | null;
    loanPaydownPct: number | null;
    /**
     * The lender's CUSTOMER application link, frozen at generation.
     *
     * Frozen like everything else here: the document has to keep working as
     * issued. Change a lender's link and already-sent proposals keep the old
     * one until they are regenerated — the same trade every other figure in
     * this snapshot makes. Never the dealer portal: that one is not put in a
     * document a homeowner can open.
     */
    applyUrl: string | null;
    lender: string | null;
    /**
     * The lender's mark, as a URL to our own serving route.
     *
     * A URL rather than the bytes, and our route rather than the bank's, for
     * the same two reasons the company logo is: a snapshot with images inlined
     * would be a megabyte of JSON per proposal, and hotlinking a bank's own CDN
     * would let someone else's cache-bust break a document a customer keeps.
     * Null when the partner has no logo — the view falls back to a monogram.
     * Optional rather than required because proposals generated before logos
     * existed have no such key at all, and their JSON is not rewritten: the
     * view treats a missing key exactly as it treats null.
     */
    lenderLogoUrl?: string | null;
    /**
     * Legacy incentive fields. No credit is quoted anywhere in the product, so
     * these are always null on anything generated now; the keys stay so that
     * proposals issued while incentives existed still parse and render.
     */
    itcEstimateCents: number | null;
    itcPct: number | null;
    stateIncentiveNote: string | null;
  };
  savings: SavingsModel;
  environmental: ReturnType<typeof environmentalImpact>;
  /** Every assumption, recorded so the document explains its own numbers. */
  assumptions: SolarAssumptions & {
    currentRateMillsPerKwh: number;
    /**
     * WHERE the production figure came from.
     *
     * Absent or null means `kwhPerKwYear` above — the company's market average,
     * scaled by a clear-sky ratio. Present means PVWatts simulated these planes
     * against this site's own weather record and the market average did not
     * enter into the number, which is exactly why the document must stop
     * listing it as though it had.
     */
    yieldBasis?: YieldBasis | null;
  };
  /** `incentive` only ever appears on legacy snapshots; nothing renders it. */
  disclaimers: { incentive?: string; estimate: string };
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
    netMeteringProgram: string | null;
    avgMonthlyBillCents: number | null;
    /** The rate a rep was told, when there is one. See resolveUtilityRateMills. */
    utilityRateMills?: number | null;
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
    /** The lines behind that total, already priced against this system. */
    adders?: { label: string; amountCents: number }[];
    rateMillsPerKwh: number | null;
    monthlyPaymentCents: number | null;
    escalatorPct: number | null;
    termYears: number | null;
    aprPct: number | null;
    /** Loan only. The lender's own figure once an approval exists. */
    loanMonthlyPaymentCents?: number | null;
    loanTermMonths?: number | null;
    downPaymentCents?: number | null;
  };
  lender: string | null;
  /** The lender's mark at generation time. Null falls back to a monogram. */
  lenderLogoUrl?: string | null;
  /** The quoted product's payment factors, when its rate sheet publishes any. */
  loanFactors?: PaymentFactors | null;
  /** The lender's CUSTOMER application link. Never the dealer portal. */
  lenderApplyUrl?: string | null;
  assumptions: SolarAssumptions;
  /** Which model produced the design's production figure, if not the average. */
  yieldBasis?: YieldBasis | null;
  now: Date;
}): SolarProposalSnapshot {
  const { design, finance, assumptions: a } = args;
  const isPurchase = finance.product === "cash" || finance.product === "loan";

  const purchase = isPurchase
    ? pricePurchase({
        product: finance.product as "cash" | "loan",
        systemSizeKwDc: design.systemSizeKwDc,
        stickerPpwCents: finance.grossPpwCents,
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
    resolveUtilityRateMills(design) ?? 0;

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

  /**
   * What a payment factor gets applied to: the contract price less anything the
   * customer puts down. Never the gross — a down payment is not borrowed, and
   * applying the factor to it quotes a payment on money nobody owes.
   */
  const loanPrincipalCents =
    (purchase?.contractPriceCents ?? 0) - (finance.downPaymentCents ?? 0);
  const loanFactorQuote =
    finance.product === "loan" && args.loanFactors && hasPaymentFactor(args.loanFactors)
      ? factorQuote(args.loanFactors, loanPrincipalCents)
      : null;

  return {
    schemaVersion: 3,
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
      ratePlan: null,
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
      tsrfPct: null,
      module: design.module ?? null,
      inverter: design.inverter ?? null,
      battery: design.battery ?? null,
    },
    layout: args.layout ?? null,
    financing: {
      product: finance.product,
      contractPriceCents: purchase?.contractPriceCents ?? null,
      grossPpwCents: purchase ? finance.grossPpwCents : null,
      // The system AT STICKER — the dealer fee included — because these three
      // rows are read as arithmetic by a homeowner: system price, plus extra
      // work, equals total. Quoting the pre-fee figure here would leave the
      // customer's own breakdown several thousand dollars short of the total
      // printed under it.
      basePriceCents: purchase?.baseStickerCents ?? null,
      // Likewise at sticker: the lender takes its percentage of the re-roof as
      // well as of the array, so the re-roof appears on the contract carrying
      // its share of the fee. Null, not 0, when there are no adders — the
      // renderer omits the row rather than printing an "Adders $0" line the
      // customer has to parse.
      adderTotalCents:
        purchase && purchase.adderStickerCents > 0 ? purchase.adderStickerCents : null,
      // Only lines that cost something, and only on a purchase. A lease or a
      // PPA has no system price for an adder to sit on top of, and a $0 line
      // is a row the customer has to read to learn nothing.
      //
      // SPREAD rather than assigned undefined: the snapshot is asserted to hold
      // no undefined anywhere, because an undefined that reaches a renderer
      // prints as "undefined" in front of a homeowner. A key that is not there
      // is the honest way to say "this document predates named adders".
      //
      // Each line is rebuilt as a NEW object, not just filtered into a new
      // array. `filter` copies the array and keeps the caller's objects, so a
      // snapshot built that way still points at whatever the caller mutates
      // next — which is precisely the freezing this whole module exists to do.
      //
      // APPORTIONED, not grossed up one line at a time: each line has to carry
      // its share of the dealer fee, and the lines have to add up to the total
      // printed beneath them to the cent. Rounding each line's own gross-up
      // leaves a breakdown a few cents out from its own total, which is a
      // question a homeowner with a calculator is entitled to ask.
      ...(purchase && finance.adders?.some((a) => a.amountCents > 0)
        ? (() => {
            const lines = finance.adders.filter((a) => a.amountCents > 0);
            const grossed = apportionCents(
              purchase.adderStickerCents,
              lines.map((a) => a.amountCents)
            );
            return {
              adders: lines.map((a, i) => ({ label: a.label, amountCents: grossed[i] })),
            };
          })()
        : {}),
      finalPpwCents: purchase ? Math.round(purchase.finalPpwCents) : null,
      // Lease/PPA carry no APR. Gating here as well as at the write means a
      // stale value left on the row by a product switch can never reach a
      // customer as a fabricated lender term.
      monthlyPaymentCents: isPurchase ? null : finance.monthlyPaymentCents,
      rateMillsPerKwh: finance.product === "ppa" ? finance.rateMillsPerKwh : null,
      escalatorPct: isPurchase ? null : finance.escalatorPct,
      termYears: finance.termYears,
      aprPct: finance.product === "loan" ? finance.aprPct : null,
      // Three sources, in order of authority:
      //   1. the lender's own figure from a real approval
      //   2. the rate sheet's PUBLISHED payment factor
      //   3. our amortisation of the quoted APR and term
      // (2) beats (3) because a factor bakes in the dealer fee and the
      // promotional structure, so the two disagree — and quoting the derived
      // one when the lender printed a factor misquotes the customer.
      loanMonthlyPaymentCents:
        finance.product === "loan"
          ? (finance.loanMonthlyPaymentCents ??
            (loanFactorQuote && factorMonthlyCents(loanFactorQuote)) ??
            loanPaymentCents({
              principalCents: loanPrincipalCents,
              aprPct: finance.aprPct,
              termMonths: finance.loanTermMonths ?? null,
            }) ??
            null)
          : null,
      loanPaymentApproved:
        finance.product === "loan" && finance.loanMonthlyPaymentCents != null,
      loanMonthlyWithoutPaydownCents: loanFactorQuote?.withoutPaydownMonthlyCents ?? null,
      loanPaydownCents: loanFactorQuote?.paydownCents ?? null,
      loanPaydownMonths: loanFactorQuote?.paydownMonths ?? null,
      loanPaydownPct: loanFactorQuote?.paydownPct ?? null,
      lender: finance.product === "loan" ? args.lender : null,
      lenderLogoUrl: finance.product === "loan" ? (args.lenderLogoUrl ?? null) : null,
      // Loan only: a cash, lease or PPA deal has no credit to pre-qualify for.
      applyUrl: finance.product === "loan" ? (args.lenderApplyUrl ?? null) : null,
      // Always null: no incentive is quoted, so nothing to record. Kept as
      // keys rather than dropped so older snapshots stay type-compatible.
      itcEstimateCents: null,
      itcPct: null,
      stateIncentiveNote: null,
    },
    savings,
    environmental: environmentalImpact(lifetimeKwh),
    // Spread, not assigned null: the snapshot is asserted to hold no undefined
    // and an older document simply has no such key.
    assumptions: {
      ...a,
      currentRateMillsPerKwh,
      ...(args.yieldBasis ? { yieldBasis: args.yieldBasis } : {}),
    },
    disclaimers: { estimate: ESTIMATE_DISCLAIMER },
  };
}
