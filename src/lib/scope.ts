// Pure job-costing math for the Scope of Work calculator. No DB, no UI — money in
// integer cents throughout so totals never drift from floating-point rounding.

export type ScopeLineInput = {
  quantity: number;
  insuranceUnitPrice: number; // cents per unit — the carrier's ALLOWED price
  costUnitPrice: number; // cents per unit — our cost
  // cents per unit — the supplemented carrier price (with a public adjuster).
  // 0/undefined means the line isn't supplemented; it falls back to the allowed price.
  supplementUnitPrice?: number;
};

/** Common units offered in the line editor (imperial + metric). */
export const SCOPE_UNITS = ["sq", "sq ft", "m²", "lf", "m", "ea", "hr", "lump"] as const;

export function lineInsuranceCents(line: ScopeLineInput): number {
  return Math.round(line.quantity * line.insuranceUnitPrice);
}

export function lineCostCents(line: ScopeLineInput): number {
  return Math.round(line.quantity * line.costUnitPrice);
}

export function lineProfitCents(line: ScopeLineInput): number {
  return lineInsuranceCents(line) - lineCostCents(line);
}

/** The supplemented amount for a line. Falls back to the allowed insurance amount
 *  when no supplement price is set, so supplementing only raises lines you bump. */
export function lineSupplementCents(line: ScopeLineInput): number {
  const suppl = line.supplementUnitPrice ?? 0;
  if (suppl > 0) return Math.round(line.quantity * suppl);
  return lineInsuranceCents(line);
}

export type CategoryRollup = {
  category: string;
  insuranceCents: number;
  costCents: number;
  profitCents: number;
  supplementCents: number;
};

export type ScopeRollup = {
  insuranceCents: number; // allowed by the carrier today
  costCents: number;
  profitCents: number; // base profit (no supplement): insurance − cost
  /** Profit ÷ insurance, as a percentage (0 when insurance total is 0). */
  marginPct: number;
  // Supplement (public-adjuster) scenario:
  supplementCents: number; // supplemented carrier total
  supplementDeltaCents: number; // supplement − allowed = amount the PA recovers
  paFeeCents: number; // the PA's cut: paFeePct% of the recovered delta
  supplementProfitCents: number; // supplement − cost − PA fee
  supplementGainCents: number; // supplementProfit − base profit (net extra from supplementing)
  byCategory: CategoryRollup[];
};

/** Aggregate a set of lines into grand totals + per-category subtotals.
 *  `paFeePct` nets out the public adjuster's cut of the recovered supplement. */
export function rollup<T extends ScopeLineInput & { category?: string | null }>(
  lines: T[],
  paFeePct = 0
): ScopeRollup {
  const byCat = new Map<string, CategoryRollup>();
  let insuranceCents = 0;
  let costCents = 0;
  let supplementCents = 0;

  for (const line of lines) {
    const ins = lineInsuranceCents(line);
    const cost = lineCostCents(line);
    const suppl = lineSupplementCents(line);
    insuranceCents += ins;
    costCents += cost;
    supplementCents += suppl;

    const key = line.category?.trim() || "General";
    const acc = byCat.get(key) ?? {
      category: key,
      insuranceCents: 0,
      costCents: 0,
      profitCents: 0,
      supplementCents: 0,
    };
    acc.insuranceCents += ins;
    acc.costCents += cost;
    acc.profitCents += ins - cost;
    acc.supplementCents += suppl;
    byCat.set(key, acc);
  }

  const profitCents = insuranceCents - costCents;
  const marginPct = insuranceCents > 0 ? (profitCents / insuranceCents) * 100 : 0;

  const supplementDeltaCents = supplementCents - insuranceCents;
  // The PA is only paid on a positive recovery.
  const paFeeCents = supplementDeltaCents > 0 ? Math.round(supplementDeltaCents * (paFeePct / 100)) : 0;
  const supplementProfitCents = supplementCents - costCents - paFeeCents;
  const supplementGainCents = supplementProfitCents - profitCents;

  return {
    insuranceCents,
    costCents,
    profitCents,
    marginPct,
    supplementCents,
    supplementDeltaCents,
    paFeeCents,
    supplementProfitCents,
    supplementGainCents,
    byCategory: Array.from(byCat.values()),
  };
}

/** Format integer cents as "$1,234.56" (or "-$1,234.56"). */
export function formatScopeCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const dollars = Math.abs(cents) / 100;
  return `${sign}$${dollars.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
