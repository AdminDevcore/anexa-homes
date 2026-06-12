import { describe, it, expect } from "vitest";
import { lineSupplementCents, rollup } from "../scope";

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
