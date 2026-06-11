// Pure job-costing math for the Scope of Work calculator. No DB, no UI — money in
// integer cents throughout so totals never drift from floating-point rounding.

export type ScopeLineInput = {
  quantity: number;
  insuranceUnitPrice: number; // cents per unit
  costUnitPrice: number; // cents per unit
};

/** Common units offered in the line editor. */
export const SCOPE_UNITS = ["sq", "sq ft", "lf", "ea", "hr", "lump"] as const;

export function lineInsuranceCents(line: ScopeLineInput): number {
  return Math.round(line.quantity * line.insuranceUnitPrice);
}

export function lineCostCents(line: ScopeLineInput): number {
  return Math.round(line.quantity * line.costUnitPrice);
}

export function lineProfitCents(line: ScopeLineInput): number {
  return lineInsuranceCents(line) - lineCostCents(line);
}

export type CategoryRollup = {
  category: string;
  insuranceCents: number;
  costCents: number;
  profitCents: number;
};

export type ScopeRollup = {
  insuranceCents: number;
  costCents: number;
  profitCents: number;
  /** Profit ÷ insurance, as a percentage (0 when insurance total is 0). */
  marginPct: number;
  byCategory: CategoryRollup[];
};

/** Aggregate a set of lines into grand totals + per-category subtotals. */
export function rollup<T extends ScopeLineInput & { category?: string | null }>(
  lines: T[]
): ScopeRollup {
  const byCat = new Map<string, CategoryRollup>();
  let insuranceCents = 0;
  let costCents = 0;

  for (const line of lines) {
    const ins = lineInsuranceCents(line);
    const cost = lineCostCents(line);
    insuranceCents += ins;
    costCents += cost;

    const key = line.category?.trim() || "General";
    const acc = byCat.get(key) ?? {
      category: key,
      insuranceCents: 0,
      costCents: 0,
      profitCents: 0,
    };
    acc.insuranceCents += ins;
    acc.costCents += cost;
    acc.profitCents += ins - cost;
    byCat.set(key, acc);
  }

  const profitCents = insuranceCents - costCents;
  const marginPct = insuranceCents > 0 ? (profitCents / insuranceCents) * 100 : 0;

  return {
    insuranceCents,
    costCents,
    profitCents,
    marginPct,
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
