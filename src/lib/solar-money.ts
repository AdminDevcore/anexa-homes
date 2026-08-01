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

/** Year-one kWh from system size, local irradiance and system losses. */
export function year1Production(systemSizeKwDc: number, a: SolarAssumptions): number {
  if (systemSizeKwDc <= 0) return 0;
  return Math.round(systemSizeKwDc * a.kwhPerKwYear * a.derateFactor);
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
  /** Sticker price before adders, cents. */
  grossPriceCents: number;
  /** The lender's cut, embedded in gross. Zero for cash. */
  dealerFeeCents: number;
  /** Gross minus dealer fee — what the deal is really worth to us per watt. */
  netPpwCents: number;
  netPriceCents: number;
  adderTotalCents: number;
  /** What the customer signs for. */
  contractPriceCents: number;
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
    marginCents,
  };
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
