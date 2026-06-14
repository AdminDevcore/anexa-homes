// Pure pool-split commission math, shared by the deal worksheet (client) and
// server-side commission generation so both compute identically.
//
//   pool base     = contract + supplement           (the deductible is NOT here)
//   company OH    = overheadPct % of the POOL BASE   (retained by the company)
//   PA fee        = paFeePct % of the SUPPLEMENT
//   profit pool   = pool base − job cost − overhead − PA fee
//   rep (pool)    = rep split % of the pool
//   rep (deduct.) = rep split % of the customer-paid deductible  (handled apart)
//   rep total     = rep pool share + rep deductible share
//   company keeps = the rest of the pool + retained overhead + the rest of the deductible
//
// The deductible is split with the rep at the SAME % but sits OUTSIDE the pool,
// so it's never double-counted and overhead never applies to it.

/** Pool from the pool base (contract + supplement) and an already-computed PA fee. */
function poolBreakdown(poolBaseCents: number, costCents: number, overheadPct: number, paFeeCents: number) {
  const overheadCents = Math.round((poolBaseCents * overheadPct) / 100);
  const poolCents = poolBaseCents - costCents - overheadCents - paFeeCents;
  return { overheadCents, poolCents };
}

/** The pool the rep is actually paid their split on. When they waive the
 *  supplement, its net contribution (supplement − its overhead − its PA fee) is
 *  removed so the rep is paid only on the non-supplement pool. */
function repPoolBasisCents(
  poolCents: number,
  supplementCents: number,
  overheadPct: number,
  paFeeCents: number,
  repWaivesSupplement: boolean,
): number {
  if (!repWaivesSupplement) return Math.max(0, poolCents);
  const supplementNetCents = Math.max(0, supplementCents - Math.round((supplementCents * overheadPct) / 100) - paFeeCents);
  return Math.max(0, poolCents - supplementNetCents);
}

// --- Full deal commission ----------------------------------------------------

export type DealCommissionInput = {
  baseCents: number; // contract
  supplementCents: number;
  deductibleCents: number;
  costCents: number; // job cost
  overheadPct: number; // % of (contract + supplement)
  paFeePct?: number; // % of the supplement (0 when not configured / no supplement)
  repSplitPct: number; // rep's % of the pool
  repDeductiblePct?: number; // rep's SEPARATE % of the customer-paid deductible (0 = none)
  // When true, the rep waived the supplement (paid early, doesn't wait on it):
  // the supplement's net pool contribution is excluded from the rep's basis and
  // kept entirely by the company.
  repWaivesSupplement?: boolean;
};

export type DealCommission = {
  revenueCents: number; // contract + supplement + deductible (total collectible)
  poolBaseCents: number; // contract + supplement (the pool's revenue, excl. deductible)
  overheadCents: number; // overheadPct % of the pool base (retained)
  paFeeCents: number; // public-adjuster cut of the supplement, removed from the pool
  poolCents: number; // pool base − cost − overhead − PA fee
  repPoolBasisCents: number; // the pool the rep is actually paid on (pool minus any waived supplement)
  repPoolCommissionCents: number; // rep split % of the rep pool basis
  repDeductibleCommissionCents: number; // rep split % of the deductible
  repCommissionCents: number; // rep pool share + rep deductible share (total)
  companyProfitCents: number; // revenue − cost − PA fee − rep total (overhead retained)
};

export function computeDealCommission(i: DealCommissionInput): DealCommission {
  const revenueCents = i.baseCents + i.supplementCents + i.deductibleCents;
  const poolBaseCents = i.baseCents + i.supplementCents;
  const paFeeCents = Math.round((i.supplementCents * (i.paFeePct ?? 0)) / 100);
  const { overheadCents, poolCents } = poolBreakdown(poolBaseCents, i.costCents, i.overheadPct, paFeeCents);
  const repBasisCents = repPoolBasisCents(poolCents, i.supplementCents, i.overheadPct, paFeeCents, !!i.repWaivesSupplement);
  const repPoolCommissionCents = repBasisCents > 0 ? Math.round((repBasisCents * i.repSplitPct) / 100) : 0;
  // The deductible uses the rep's SEPARATE deductible % (not the pool split %).
  const repDeductibleCommissionCents = Math.round((i.deductibleCents * (i.repDeductiblePct ?? 0)) / 100);
  const repCommissionCents = repPoolCommissionCents + repDeductibleCommissionCents;
  const companyProfitCents = revenueCents - i.costCents - paFeeCents - repCommissionCents;
  return {
    revenueCents, poolBaseCents, overheadCents, paFeeCents, poolCents, repPoolBasisCents: repBasisCents,
    repPoolCommissionCents, repDeductibleCommissionCents, repCommissionCents, companyProfitCents,
  };
}

// --- Deal split (server commission generation / payroll) ---------------------
// Returns just the pool (and its pieces); the engine applies each person's
// snapshot to the pool and adds the rep's deductible share separately.

export type DealSplitInput = {
  baseCents: number; // contract
  supplementCents: number;
  costCents: number;
  overheadPct: number;
  paFeePct?: number;
  repSplitPct: number;
  repWaivesSupplement?: boolean;
};

export type DealSplit = {
  overheadCents: number;
  paFeeCents: number;
  poolCents: number;
  repPoolBasisCents: number; // pool the rep/split is paid on (minus any waived supplement)
  repCommissionCents: number;
  companyProfitCents: number;
};

export function computeDealSplit(i: DealSplitInput): DealSplit {
  const poolBaseCents = i.baseCents + i.supplementCents;
  const paFeeCents = Math.round((i.supplementCents * (i.paFeePct ?? 0)) / 100);
  const { overheadCents, poolCents } = poolBreakdown(poolBaseCents, i.costCents, i.overheadPct, paFeeCents);
  const repBasisCents = repPoolBasisCents(poolCents, i.supplementCents, i.overheadPct, paFeeCents, !!i.repWaivesSupplement);
  const repCommissionCents = repBasisCents > 0 ? Math.round((repBasisCents * i.repSplitPct) / 100) : 0;
  const companyProfitCents = poolCents - repCommissionCents + overheadCents;
  return { overheadCents, paFeeCents, poolCents, repPoolBasisCents: repBasisCents, repCommissionCents, companyProfitCents };
}

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
