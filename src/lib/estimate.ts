// Pure math for the Estimate worksheet — what we would CHARGE for a job. No DB,
// no UI. Money is integer cents throughout so totals never drift from
// floating-point rounding.
//
// This is deliberately NOT scope.ts. A scope line is priced two ways at once
// (what the carrier allows, what it costs us) and only exists once a carrier
// scope has been received. An estimate line has one price — ours — and exists
// from the moment a deal does, on cash deals as much as insurance ones.

/** Common units offered in the line editor. Mirrors SCOPE_UNITS. */
export const ESTIMATE_UNITS = ["sq", "sq ft", "m²", "lf", "m", "ea", "hr", "lump"] as const;

export type EstimateCalcLine = {
  quantity: number;
  /** cents per unit — what we charge. */
  unitPriceCents: number;
  /** cents per unit — our cost, resolved from the selected cost template. */
  costPerUnitCents: number;
  category?: string | null;
};

export type EstimateCategoryRollup = {
  category: string;
  priceCents: number;
  costCents: number;
};

export type EstimateCalc = {
  /** Sum of every line before the discount. */
  subtotalCents: number;
  /** The discount actually applied — never more than the subtotal. */
  discountCents: number;
  /** What the customer pays: subtotal − discount, floored at zero. */
  totalCents: number;
  /** Our cost to produce the work. Zero when no cost template is selected. */
  costCents: number;
  /** total − cost. Negative when we're pricing below cost. */
  grossProfitCents: number;
  /** grossProfit ÷ total, as a percentage. Zero when the total is zero. */
  marginPct: number;
  byCategory: EstimateCategoryRollup[];
};

export function lineTotalCents(line: EstimateCalcLine): number {
  return Math.round(line.quantity * line.unitPriceCents);
}

export function lineCostCents(line: EstimateCalcLine): number {
  return Math.round(line.quantity * line.costPerUnitCents);
}

/**
 * Roll a set of lines up into the numbers the worksheet shows.
 *
 * The discount is clamped to the subtotal rather than allowed to drive the
 * total negative — a 100%-off estimate is a free job, not one where we pay the
 * customer. Margin is measured against the DISCOUNTED total, because that is
 * the money that actually arrives.
 */
export function computeEstimate(
  lines: EstimateCalcLine[],
  opts: { discountCents?: number } = {}
): EstimateCalc {
  const byCat = new Map<string, EstimateCategoryRollup>();
  let subtotalCents = 0;
  let costCents = 0;

  for (const line of lines) {
    const price = lineTotalCents(line);
    const cost = lineCostCents(line);
    subtotalCents += price;
    costCents += cost;

    const key = line.category?.trim() || "General";
    const acc = byCat.get(key) ?? { category: key, priceCents: 0, costCents: 0 };
    acc.priceCents += price;
    acc.costCents += cost;
    byCat.set(key, acc);
  }

  const discountCents = Math.min(Math.max(0, Math.round(opts.discountCents ?? 0)), subtotalCents);
  const totalCents = subtotalCents - discountCents;
  const grossProfitCents = totalCents - costCents;
  const marginPct = totalCents > 0 ? (grossProfitCents / totalCents) * 100 : 0;

  return {
    subtotalCents,
    discountCents,
    totalCents,
    costCents,
    grossProfitCents,
    marginPct,
    byCategory: Array.from(byCat.values()).sort((a, b) => b.priceCents - a.priceCents),
  };
}

/** Whole dollars, for the worksheet's totals. Mirrors formatScopeDollars. */
export function formatEstimateDollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const dollars = Math.round(Math.abs(cents) / 100);
  return `${sign}$${dollars.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}
