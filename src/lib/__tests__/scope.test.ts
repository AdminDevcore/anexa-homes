import { describe, it, expect } from "vitest";
import { lineSupplementCents, rollup, computeScope } from "../scope";

describe("computeScope (full-price supplement + company overhead = profit pool)", () => {
  // 10 panels: insurance allows $300, our cost $200, supplemented price $900 (FULL).
  const lines = [{ quantity: 10, insuranceUnitPriceCents: 30000, costPerUnitCents: 20000, supplementPerUnitCents: 90000 }];

  it("computes the CURRENT profit pool (revenue − cost − overhead)", () => {
    const r = computeScope(lines, { paFeePct: 10, overheadPct: 10 });
    expect(r.insuranceRcvCents).toBe(300000); // 10 × $300
    expect(r.internalCostCents).toBe(200000); // 10 × $200
    expect(r.currentOverheadCents).toBe(30000); // 10% of $3,000
    expect(r.currentProfitCents).toBe(70000); // 300000 − 200000 − 30000
    expect(r.currentMarginPct).toBeCloseTo((70000 / 300000) * 100, 4);
  });

  it("supplement is the FINAL price; computes recovery, PA fee, projected pool", () => {
    const r = computeScope(lines, { paFeePct: 10, overheadPct: 10 });
    expect(r.supplementedRevenueCents).toBe(900000); // 10 × $900 (replaces, not adds)
    expect(r.supplementRecoveredCents).toBe(600000); // 900000 − 300000
    expect(r.paFeeCents).toBe(60000); // 10% of the $6,000 recovered
    expect(r.projectedOverheadCents).toBe(90000); // 10% of $9,000
    expect(r.projectedRevenueCents).toBe(900000);
    expect(r.projectedProfitCents).toBe(550000); // 900000 − 200000 − 90000 − 60000
    expect(r.projectedMarginPct).toBeCloseTo((550000 / 900000) * 100, 4);
  });

  it("a line with no supplement price falls back to its allowed price", () => {
    const r = computeScope(
      [{ quantity: 5, insuranceUnitPriceCents: 1200, costPerUnitCents: 750, supplementPerUnitCents: 0 }],
      { paFeePct: 10, overheadPct: 10 }
    );
    expect(r.supplementedRevenueCents).toBe(r.insuranceRcvCents); // 5 × $12, no recovery
    expect(r.supplementRecoveredCents).toBe(0);
    expect(r.paFeeCents).toBe(0);
    expect(r.projectedProfitCents).toBe(r.currentProfitCents);
  });
});

describe("scope supplement math", () => {
  it("uses the supplement price when set", () => {
    expect(lineSupplementCents({ quantity: 10, insuranceUnitPrice: 1000, costUnitPrice: 600, supplementUnitPrice: 1500 })).toBe(15000);
  });

  it("falls back to the allowed insurance price when no supplement is entered", () => {
    expect(lineSupplementCents({ quantity: 5, insuranceUnitPrice: 2000, costUnitPrice: 1000, supplementUnitPrice: 0 })).toBe(10000);
  });

  it("rolls up base profit and the net supplement scenario (PA fee on the delta)", () => {
    const lines = [
      // supplemented: 10 * $15 = $150 vs allowed 10 * $10 = $100
      { category: "Roof", quantity: 10, insuranceUnitPrice: 1000, costUnitPrice: 600, supplementUnitPrice: 1500 },
      // not supplemented: supplement falls back to allowed (5 * $20 = $100)
      { category: "Gutters", quantity: 5, insuranceUnitPrice: 2000, costUnitPrice: 1000, supplementUnitPrice: 0 },
    ];
    const r = rollup(lines, 10); // 10% public-adjuster fee

    expect(r.insuranceCents).toBe(20000); // allowed
    expect(r.costCents).toBe(11000);
    expect(r.profitCents).toBe(9000); // base profit (no supplement)
    expect(r.marginPct).toBeCloseTo(45, 5);

    expect(r.supplementCents).toBe(25000); // supplemented total
    expect(r.supplementDeltaCents).toBe(5000); // recovered by supplementing
    expect(r.paFeeCents).toBe(500); // 10% of the 5000 delta
    expect(r.supplementProfitCents).toBe(13500); // 25000 - 11000 cost - 500 PA fee
    expect(r.supplementGainCents).toBe(4500); // extra over base profit, net of PA fee
  });

  it("defaults the PA fee to 0 when not provided", () => {
    const r = rollup([{ quantity: 1, insuranceUnitPrice: 100, costUnitPrice: 50, supplementUnitPrice: 300 }]);
    expect(r.paFeeCents).toBe(0);
    expect(r.supplementProfitCents).toBe(250); // 300 - 50, no fee
  });
});
