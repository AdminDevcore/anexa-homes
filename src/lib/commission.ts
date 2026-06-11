// Pure margin-split commission math, shared by the deal worksheet (client) and
// server-side commission generation so both compute identically.
//
//   profit pool = contract − job cost − company overhead(% of contract)
//   rep commission = pool × rep split %     (company keeps the remainder)

export type DealSplitInput = {
  contractCents: number;
  costCents: number;
  overheadPct: number;
  repSplitPct: number;
};

export type DealSplit = {
  overheadCents: number;
  poolCents: number;
  repCommissionCents: number;
  companyProfitCents: number;
};

export function computeDealSplit({ contractCents, costCents, overheadPct, repSplitPct }: DealSplitInput): DealSplit {
  const overheadCents = Math.round((contractCents * overheadPct) / 100);
  const poolCents = contractCents - costCents - overheadCents;
  // A negative pool (cost overrun) yields no rep commission.
  const repCommissionCents = poolCents > 0 ? Math.round((poolCents * repSplitPct) / 100) : 0;
  const companyProfitCents = poolCents - repCommissionCents;
  return { overheadCents, poolCents, repCommissionCents, companyProfitCents };
}

// --- Full deal commission (split pool + separate deductible share) -----------
//
// Money rules captured here so the worksheet, getDealFinancials, and the
// generation engine all agree:
//  - Splittable pool = (base + supplement* + depreciation*) − cost − overhead,
//    where supplement/depreciation are included only if the rep "gets" them on
//    this deal (else the company keeps that share / pays the rep upfront).
//  - The DEDUCTIBLE is never in the split pool. The rep is instead paid its own
//    `deductiblePct` of the deductible as a separate line (0/unset = none).
//  - Adjusted contract value (company revenue) still counts every piece.

export type DealCommissionInput = {
  baseCents: number;
  supplementCents: number;
  deductibleCents: number;
  depreciationCents: number;
  repGetsSupplement: boolean;
  repGetsDepreciation: boolean;
  costCents: number;
  overheadPct: number;
  repSplitPct: number;
  repDeductiblePct: number;
};

export type DealCommission = {
  adjustedContractCents: number; // company revenue: base + suppl + deductible + depr
  splitBaseContractCents: number; // what the split pool is computed on (excl. deductible)
  overheadCents: number;
  poolCents: number;
  splitCommissionCents: number; // rep split of the pool
  deductibleCommissionCents: number; // rep's % of the deductible
  repTotalCents: number; // split + deductible share
};

// --- Rep split snapshot (self-gen % vs provided-lead % OR flat fee) -----------
//
// A rep's company-provided-lead comp is EITHER a lower % of the pool, OR their
// normal self-gen % minus a flat lead/marketing fee. We snapshot the resolved
// terms (splitPct + splitFlatCents) onto the commission at generation so editing
// the rep's config later never changes an existing deal.

export type RepSplitConfig = {
  selfGenPct: number | null;
  providedType: string; // "percentage" | "flat"
  providedPct: number | null;
  providedFlatCents: number | null;
};
export type SplitSnapshot = { splitPct: number; splitFlatCents: number };

/** Fresh split terms from a rep's CURRENT config + whether the company provided the lead. */
export function resolveSplitSnapshot(provided: boolean, c: RepSplitConfig): SplitSnapshot | null {
  if (!provided) {
    return c.selfGenPct == null ? null : { splitPct: c.selfGenPct, splitFlatCents: 0 };
  }
  if (c.providedType === "flat") {
    // Self-gen split minus a flat lead fee (needs the self-gen % as the base).
    return c.selfGenPct == null ? null : { splitPct: c.selfGenPct, splitFlatCents: Math.max(0, c.providedFlatCents ?? 0) };
  }
  // Percentage mode — fall back to the self-gen % if no provided % is set.
  const pct = c.providedPct ?? c.selfGenPct;
  return pct == null ? null : { splitPct: pct, splitFlatCents: 0 };
}

/** Amount from a snapshot + the current pool: max(0, pool×pct% − flatFee). */
export function applySplitSnapshot(poolCents: number, splitPct: number, splitFlatCents: number): number {
  if (poolCents <= 0) return 0;
  return Math.max(0, Math.round((poolCents * splitPct) / 100) - Math.max(0, splitFlatCents));
}

export function computeDealCommission(i: DealCommissionInput): DealCommission {
  const inclSuppl = i.repGetsSupplement ? i.supplementCents : 0;
  const inclDepr = i.repGetsDepreciation ? i.depreciationCents : 0;
  const splitBaseContractCents = i.baseCents + inclSuppl + inclDepr;
  const overheadCents = Math.round((splitBaseContractCents * i.overheadPct) / 100);
  const poolCents = splitBaseContractCents - i.costCents - overheadCents;
  const splitCommissionCents = poolCents > 0 ? Math.round((poolCents * i.repSplitPct) / 100) : 0;
  const deductibleCommissionCents = Math.round((i.deductibleCents * (i.repDeductiblePct || 0)) / 100);
  return {
    adjustedContractCents: i.baseCents + i.supplementCents + i.deductibleCents + i.depreciationCents,
    splitBaseContractCents,
    overheadCents,
    poolCents,
    splitCommissionCents,
    deductibleCommissionCents,
    repTotalCents: splitCommissionCents + deductibleCommissionCents,
  };
}
