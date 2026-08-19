import type { FinanceProduct } from "@prisma/client";

/**
 * Solar pricing and commission maths.
 *
 * Pure functions, money in CENTS, no I/O — so the proposal builder, the
 * commission engine and the customer-facing presentation all compute the same
 * number from the same code.
 *
 * THE CENTRAL POINT: the four financing products are NOT variations of one
 * model. Cash and Loan sell a system at a price per watt. Lease and PPA sell
 * *electricity* — there is no system price in the same sense, and applying a
 * loan's dealer-fee maths to a PPA produces a number that means nothing. Each
 * product therefore has its own input shape and its own commission basis, and
 * the type system keeps them apart.
 */

// ---------------------------------------------------------------------------
// Assumptions — every one of these is DATA from SolarSettings, never a constant
// in this file. The federal credit in particular changed in 2025 and is still
// moving; it belongs to the company's CPA, not to a developer.
// ---------------------------------------------------------------------------
export type SolarAssumptions = {
  derateFactor: number;
  annualDegradationPct: number;
  utilityEscalationPct: number;
  kwhPerKwYear: number;
  /** What share of a customer's usage a system is sized toward, as a %. */
  targetOffsetPct: number;
  defaultGrossPpwCents: number;
  defaultDealerFeePct: number;
  /** Null = this company shows no federal credit at all. */
  federalItcPct: number | null;
  minOffsetPct: number;
  maxOffsetPct: number;
  minPpwCents: number;
  maxPpwCents: number;
};

// ---------------------------------------------------------------------------
// Production
// ---------------------------------------------------------------------------

/**
 * The physical ceiling on TSRF, and the point below which a site is a shading
 * problem rather than a design. Both are sanity rails, not business policy —
 * a TSRF of 0 or 140 is a typo, and the proposal must not price it.
 */
export const TSRF_MIN_PCT = 30;
export const TSRF_MAX_PCT = 100;
/** Below this, the array is materially shaded and the rep should be told. */
export const TSRF_WARN_PCT = 75;

/**
 * Year-one kWh from system size, local irradiance, system losses and TSRF.
 *
 * TSRF (Total Solar Resource Fraction) is the share of the ideal annual
 * irradiance this particular roof plane actually receives once its tilt,
 * azimuth and shading are accounted for. It was being COLLECTED on the design
 * and then ignored, which meant a heavily shaded north-facing roof produced the
 * same headline number as a perfect south-facing one — the customer finds out
 * twelve months later, from their bill.
 *
 * Null TSRF means "not surveyed yet" and is treated as 100% (no shading
 * deduction) so an early estimate is not silently penalised; the readiness
 * validator asks for the real figure before a proposal can be generated.
 */
export function year1Production(
  systemSizeKwDc: number,
  a: SolarAssumptions,
  tsrfPct?: number | null
): number {
  if (systemSizeKwDc <= 0) return 0;
  const tsrf = tsrfPct == null ? 100 : tsrfPct;
  return Math.round(systemSizeKwDc * a.kwhPerKwYear * a.derateFactor * (tsrf / 100));
}

/**
 * The customer's current blended rate, derived from their OWN bill.
 *
 * Returns null when it cannot be derived. That is the whole point: this used to
 * fall back to a hardcoded 150 mills ($0.15/kWh), which meant a proposal missing
 * a utility bill still produced a confident 25-year savings figure built on a
 * number nobody had ever seen. A null here becomes a blocking validation issue,
 * not an invented assumption.
 */
export function deriveUtilityRateMills(
  avgMonthlyBillCents: number | null | undefined,
  annualUsageKwh: number | null | undefined
): number | null {
  if (!avgMonthlyBillCents || avgMonthlyBillCents <= 0) return null;
  if (!annualUsageKwh || annualUsageKwh <= 0) return null;
  return Math.round(((avgMonthlyBillCents * 12) / annualUsageKwh) * 10);
}

/** What share of the home's usage the system covers. */
export function offsetPct(productionKwh: number, annualUsageKwh: number): number {
  if (annualUsageKwh <= 0) return 0;
  return (productionKwh / annualUsageKwh) * 100;
}

/** Production in a given year, after degradation. Year 1 = full output. */
export function productionInYear(year1Kwh: number, year: number, a: SolarAssumptions): number {
  if (year <= 1) return year1Kwh;
  return year1Kwh * Math.pow(1 - a.annualDegradationPct / 100, year - 1);
}

// ---------------------------------------------------------------------------
// Cash & Loan — a system, sold at a price per watt
// ---------------------------------------------------------------------------

export type PurchaseInput = {
  product: "cash" | "loan";
  systemSizeKwDc: number;
  grossPpwCents: number;
  /** % of gross taken by the lender. MUST be 0 for cash. */
  dealerFeePct: number;
  adderTotalCents: number;
  /** Our hard cost, for the margin basis. */
  equipmentCostCents?: number;
};

export type PurchaseBreakdown = {
  systemWatts: number;
  /** Sticker price before adders, cents. The "base system price". */
  grossPriceCents: number;
  /** The lender's cut, embedded in gross. Zero for cash. */
  dealerFeeCents: number;
  /** Gross minus dealer fee — what the deal is really worth to us per watt. */
  netPpwCents: number;
  netPriceCents: number;
  adderTotalCents: number;
  /** What the customer signs for. */
  contractPriceCents: number;
  /**
   * Contract price per installed watt, cents. This is the figure a rep is
   * actually checked against, and it differs from `grossPpwCents` whenever
   * there are adders — quoting the sticker PPW on a job carrying a $14.5k
   * re-roof understates what the customer is paying per watt.
   */
  finalPpwCents: number;
  /** Contract minus our cost. Only meaningful when cost is known. */
  marginCents: number;
};

/**
 * Price a cash or loan deal.
 *
 * The dealer fee is embedded in the gross price on a LOAN — the lender advances
 * the full sticker and keeps a percentage, so the rep's "$3.50/W" is not what
 * the company nets. Cash has no lender and therefore no fee; passing one is
 * rejected rather than silently applied, because a cash deal quoted with a
 * dealer fee is simply overpriced.
 */
export function pricePurchase(input: PurchaseInput): PurchaseBreakdown {
  const systemWatts = Math.round(input.systemSizeKwDc * 1000);
  const grossPriceCents = Math.round(systemWatts * input.grossPpwCents);

  const feePct = input.product === "cash" ? 0 : input.dealerFeePct;
  const dealerFeeCents = Math.round(grossPriceCents * (feePct / 100));

  const netPriceCents = grossPriceCents - dealerFeeCents;
  const netPpwCents = systemWatts > 0 ? netPriceCents / systemWatts : 0;
  const contractPriceCents = grossPriceCents + input.adderTotalCents;

  const marginCents =
    input.equipmentCostCents === undefined
      ? 0
      : netPriceCents + input.adderTotalCents - input.equipmentCostCents;

  return {
    systemWatts,
    grossPriceCents,
    dealerFeeCents,
    netPpwCents,
    netPriceCents,
    adderTotalCents: input.adderTotalCents,
    contractPriceCents,
    finalPpwCents: systemWatts > 0 ? contractPriceCents / systemWatts : 0,
    marginCents,
  };
}

// ---------------------------------------------------------------------------
// Lender products — what the money costs, and what it therefore has to sticker
// ---------------------------------------------------------------------------

/**
 * The monthly payment on a loan, from the product's own terms.
 *
 * An ESTIMATE, and labelled as one wherever it is shown. Once a credit
 * application comes back, `SolarFinance.loanMonthlyPaymentCents` holds the
 * lender's own figure and that one wins everywhere — promotional periods, fees
 * and re-amortisation all mean a computed number can differ from the one the
 * customer is actually held to. This exists because a rep still has to quote a
 * payment on the day, before any approval exists, and typing one from memory is
 * how a transposed digit reaches a signed proposal.
 *
 * Returns null rather than a number whenever the terms cannot produce one. A
 * payment of NaN or Infinity rendered to a homeowner is worse than no payment.
 */
export function loanPaymentCents(input: {
  /** Contract price minus any down payment, cents. */
  principalCents: number;
  /** Null is read as 0% — the interest-free promotional case. */
  aprPct: number | null;
  termMonths: number | null;
}): number | null {
  const { principalCents, termMonths } = input;
  const aprPct = input.aprPct ?? 0;

  if (!termMonths || termMonths <= 0) return null;
  if (!(principalCents > 0)) return null;
  if (aprPct < 0) return null;

  // r = 0 makes the amortisation formula 0/0, so interest-free is its own case
  // rather than a limit the formula is trusted to reach.
  if (aprPct === 0) return Math.round(principalCents / termMonths);

  const r = aprPct / 100 / 12;
  const payment = (principalCents * r) / (1 - Math.pow(1 + r, -termMonths));
  return Number.isFinite(payment) ? Math.round(payment) : null;
}

/**
 * The sticker price per watt that leaves `netPpwCents` after the lender's cut.
 *
 * The dealer fee is a percentage OF GROSS, not a markup on net, so this is
 * `net / (1 - fee)` and not `net * (1 + fee)`. Getting that backwards
 * under-prices an 18% fee by about three cents a watt — roughly $300 on a
 * 10 kW system, silently, on every deal.
 *
 * Null when the arithmetic has no honest answer: a fee at or above 100% divides
 * by zero or goes negative, and a sticker price of -$4.20/W would otherwise be
 * quoted without complaint.
 */
export function grossPpwFromNet(netPpwCents: number, dealerFeePct: number): number | null {
  if (!(netPpwCents > 0)) return null;
  if (dealerFeePct < 0 || dealerFeePct >= 100) return null;
  return Math.round(netPpwCents / (1 - dealerFeePct / 100));
}

/**
 * A lease product prices per kW-DC per month; `priceThirdParty` takes a fixed
 * monthly. This is the one line between them, kept here so the conversion is
 * not re-derived at each call site.
 */
export function leaseMonthlyCents(rateCentsPerKwMonth: number, systemSizeKwDc: number): number {
  return Math.round(rateCentsPerKwMonth * systemSizeKwDc);
}

/**
 * Estimated federal credit.
 *
 * Returns 0 when the company has not set a percentage — we would rather show
 * nothing than show a number nobody has confirmed. Always paired with the
 * disclaimer from SolarSettings at every render site.
 */
export function itcEstimateCents(contractPriceCents: number, a: SolarAssumptions): number {
  if (a.federalItcPct == null || a.federalItcPct <= 0) return 0;
  return Math.round(contractPriceCents * (a.federalItcPct / 100));
}

// ---------------------------------------------------------------------------
// Lease & PPA — electricity, sold per month or per kWh
//
// Deliberately a separate function with a separate input type. There is no
// gross price, no dealer fee and no PPW here, so none of the purchase maths
// applies. What the customer buys is a stream of payments.
// ---------------------------------------------------------------------------

export type ThirdPartyInput = {
  product: "lease" | "ppa";
  /** PPA: price per kWh in mills (tenths of a cent). */
  rateMillsPerKwh?: number;
  /** Lease: fixed monthly payment, cents. */
  monthlyPaymentCents?: number;
  escalatorPct: number;
  termYears: number;
  year1ProductionKwh: number;
  /**
   * The array is still physically installed on a lease or PPA, so the system
   * size is real even though there is no system PRICE. Carried through so a
   * per-watt commission rule can pay on a third-party-owned deal.
   */
  systemSizeKwDc: number;
};

export type ThirdPartyBreakdown = {
  /** Real installed watts. There is no system price, but there is a system. */
  systemWatts: number;
  year1CostCents: number;
  /** Total the customer pays across the term, with the escalator applied. */
  lifetimeCostCents: number;
  /** Blended effective rate over the term, in mills. */
  effectiveRateMills: number;
};

/** Price a lease or PPA. Never reuses the purchase formula — see the note above. */
export function priceThirdParty(input: ThirdPartyInput, a: SolarAssumptions): ThirdPartyBreakdown {
  const years = Math.max(0, input.termYears);
  let lifetimeCostCents = 0;
  let lifetimeKwh = 0;
  let year1CostCents = 0;

  for (let year = 1; year <= years; year++) {
    const escalation = Math.pow(1 + input.escalatorPct / 100, year - 1);
    const kwh = productionInYear(input.year1ProductionKwh, year, a);
    lifetimeKwh += kwh;

    const yearCost =
      input.product === "ppa"
        ? // PPA: you pay for what it makes, so degradation lowers the bill too.
          (kwh * (input.rateMillsPerKwh ?? 0) * escalation) / 10
        : // Lease: fixed monthly regardless of output.
          (input.monthlyPaymentCents ?? 0) * 12 * escalation;

    if (year === 1) year1CostCents = Math.round(yearCost);
    lifetimeCostCents += yearCost;
  }

  return {
    systemWatts: Math.round(input.systemSizeKwDc * 1000),
    year1CostCents,
    lifetimeCostCents: Math.round(lifetimeCostCents),
    effectiveRateMills: lifetimeKwh > 0 ? (lifetimeCostCents * 10) / lifetimeKwh : 0,
  };
}

// ---------------------------------------------------------------------------
// Commission
// ---------------------------------------------------------------------------

export type SolarCommissionBasis =
  | { type: "ppw"; ratePerWattCents: number }
  | { type: "margin"; percent: number }
  | { type: "percentage"; percent: number }
  | { type: "flat"; amountCents: number };

/**
 * What a rep earns on a solar deal.
 *
 * Cash/loan pay on PPW or margin — both computed from the NET price, never the
 * gross, so a rep is not paid on the lender's cut.
 *
 * Lease/PPA have no system price, so PPW and margin are meaningless: a
 * percentage basis applies to the year-one customer cost, and flat is flat.
 * Feeding a PPA into the loan formula is the mistake this signature prevents.
 */
export function solarCommissionCents(
  product: FinanceProduct,
  basis: SolarCommissionBasis,
  deal: { purchase?: PurchaseBreakdown; thirdParty?: ThirdPartyBreakdown }
): number {
  if (basis.type === "flat") return basis.amountCents;

  if (product === "cash" || product === "loan") {
    const p = deal.purchase;
    if (!p) return 0;
    switch (basis.type) {
      case "ppw":
        return Math.round(p.systemWatts * basis.ratePerWattCents);
      case "margin":
        return Math.round(p.marginCents * (basis.percent / 100));
      case "percentage":
        // Net, not gross: paying a percentage of the dealer fee pays the rep
        // on money the company never receives.
        return Math.round(p.netPriceCents * (basis.percent / 100));
    }
  }

  // ── Lease / PPA ─────────────────────────────────────────────────────────
  const t = deal.thirdParty;
  if (!t) return 0;
  switch (basis.type) {
    case "ppw":
      // The array is still installed, so per-watt pays normally. Without this a
      // rep on a PPW rule would earn NOTHING on every TPO deal they closed —
      // silently, because the formula would just return zero.
      return Math.round(t.systemWatts * basis.ratePerWattCents);
    case "percentage":
      return Math.round(t.year1CostCents * (basis.percent / 100));
    case "margin":
      // Genuinely does not exist: a third party owns the system, so there is no
      // cost basis of ours to take a margin on. Use PPW or flat for TPO.
      return 0;
  }
}
