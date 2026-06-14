import { describe, it, expect } from "vitest";
import { computeDealSplit, computeDealCommission, applySplitSnapshot } from "@/lib/commission";

// Pool-split model (cents). The DEDUCTIBLE is split with the rep at the rep's
// OWN deductible %, and is NOT part of the pool (so overhead never touches it):
//   pool base = contract + supplement
//   overhead  = overheadPct% of the pool base
//   PA fee    = paFeePct% of the supplement
//   pool      = pool base − cost − overhead − PA fee
//   rep pool  = repSplit% of pool   (or of the non-supplement pool if waived)
//   rep ded   = repDeductiblePct% of deductible
//   company   = revenue − cost − PA fee − (rep pool + rep ded)   [overhead retained]

describe("computeDealCommission", () => {
  it("overhead is 10% of (contract + supplement) — NOT the deductible", () => {
    const r = computeDealCommission({
      baseCents: 200_00, supplementCents: 100_00, deductibleCents: 50_00,
      costCents: 40_00, overheadPct: 10, paFeePct: 10, repSplitPct: 50, repDeductiblePct: 50,
    });
    expect(r.revenueCents).toBe(350_00);
    expect(r.poolBaseCents).toBe(300_00); // contract + supplement (no deductible)
    expect(r.overheadCents).toBe(30_00); // 10% of 300, NOT of 350
    expect(r.paFeeCents).toBe(10_00); // 10% of the 100 supplement
    expect(r.poolCents).toBe(220_00); // 300 − 40 − 30 − 10
  });

  it("rep gets split% of the pool AND split% of the deductible (separate)", () => {
    const r = computeDealCommission({
      baseCents: 200_00, supplementCents: 100_00, deductibleCents: 50_00,
      costCents: 40_00, overheadPct: 10, paFeePct: 10, repSplitPct: 50, repDeductiblePct: 50,
    });
    expect(r.repPoolCommissionCents).toBe(110_00); // 50% of 220
    expect(r.repDeductibleCommissionCents).toBe(25_00); // 50% of 50 deductible
    expect(r.repCommissionCents).toBe(135_00); // 110 + 25
  });

  it("company profit = revenue − cost − PA fee − rep total (everything reconciles)", () => {
    const r = computeDealCommission({
      baseCents: 200_00, supplementCents: 100_00, deductibleCents: 50_00,
      costCents: 40_00, overheadPct: 10, paFeePct: 10, repSplitPct: 50, repDeductiblePct: 50,
    });
    expect(r.companyProfitCents).toBe(165_00); // 350 − 40 − 10 − 135
    // Full reconciliation: company + rep + cost + PA fee = revenue.
    expect(r.companyProfitCents + r.repCommissionCents + 40_00 + r.paFeeCents).toBe(r.revenueCents);
  });

  it("the deductible is split even when the pool is negative (cost overrun)", () => {
    const r = computeDealCommission({
      baseCents: 100_00, supplementCents: 0, deductibleCents: 40_00,
      costCents: 200_00, overheadPct: 10, paFeePct: 0, repSplitPct: 50, repDeductiblePct: 50,
    });
    expect(r.poolCents).toBe(-110_00); // 100 − 200 − 10
    expect(r.repPoolCommissionCents).toBe(0); // pool negative
    expect(r.repDeductibleCommissionCents).toBe(20_00); // 50% of 40 deductible, still paid
  });

  it("rep waives the supplement — paid on the non-supplement pool; company keeps the rest", () => {
    const base = { baseCents: 195_00, supplementCents: 50_00, deductibleCents: 0, costCents: 0, overheadPct: 10, paFeePct: 10, repSplitPct: 50 };
    const gets = computeDealCommission({ ...base });
    expect(gets.poolCents).toBe(215_50); // 245 − 24.5 overhead − 5 PA
    expect(gets.repCommissionCents).toBe(107_75); // 50% of 215.5
    expect(gets.companyProfitCents).toBe(132_25); // 245 − 5 PA − 107.75

    const waived = computeDealCommission({ ...base, repWaivesSupplement: true });
    // Supplement net = 50 − 5 overhead − 5 PA = 40; rep basis = 215.5 − 40 = 175.5.
    expect(waived.repPoolBasisCents).toBe(175_50);
    expect(waived.repCommissionCents).toBe(87_75); // 50% of 175.5 — no supplement share
    expect(waived.companyProfitCents).toBe(152_25); // 245 − 5 PA − 87.75 (keeps supplement net)
    // The company gains exactly the rep's would-be supplement share.
    expect(waived.companyProfitCents - gets.companyProfitCents).toBe(20_00);
  });
});

describe("computeDealSplit — pool only (payroll engine)", () => {
  it("pool on (contract + supplement), overhead 10% of that, no deductible", () => {
    const r = computeDealSplit({
      baseCents: 200_00, supplementCents: 100_00, costCents: 40_00,
      overheadPct: 10, paFeePct: 10, repSplitPct: 0,
    });
    expect(r.overheadCents).toBe(30_00);
    expect(r.paFeeCents).toBe(10_00);
    expect(r.poolCents).toBe(220_00);
    expect(r.repCommissionCents).toBe(0); // engine applies snapshots
  });
});

describe("applySplitSnapshot", () => {
  it("max(0, pool×pct − flat)", () => {
    expect(applySplitSnapshot(100_00, 50, 0)).toBe(50_00);
    expect(applySplitSnapshot(100_00, 50, 10_00)).toBe(40_00);
    expect(applySplitSnapshot(-5_00, 50, 0)).toBe(0);
  });
});
