import { describe, it, expect } from "vitest";
import { computeReports, resolvePeriod, type ReportTxn } from "@/lib/bookkeeping-reports";

// Amounts in cents; positive = money in, negative = money out.
const TXNS: ReportTxn[] = [
  { date: "2024-03-10", amountCents: 100_00, categoryName: "Job Revenue" },
  { date: "2024-06-01", amountCents: -40_00, categoryName: "Materials" },
  { date: "2025-02-15", amountCents: 200_00, categoryName: "Job Revenue" },
  { date: "2025-09-20", amountCents: -50_00, categoryName: "Materials" },
  { date: "2026-01-05", amountCents: 80_00, categoryName: "Job Revenue" },
];

describe("computeReports — period-scoped P&L", () => {
  it("all time: income, expense, net across every transaction", () => {
    const { pnl } = computeReports(TXNS);
    expect(pnl.totalIncome).toBe(380_00); // 100 + 200 + 80
    expect(pnl.totalExpense).toBe(90_00); // 40 + 50
    expect(pnl.netProfit).toBe(290_00);
  });

  it("P&L only counts transactions dated within [start, end]", () => {
    // Calendar year 2025.
    const start = new Date(2025, 0, 1).getTime();
    const end = new Date(2025, 11, 31, 23, 59, 59, 999).getTime();
    const { pnl } = computeReports(TXNS, { startMs: start, endMs: end });
    expect(pnl.totalIncome).toBe(200_00);
    expect(pnl.totalExpense).toBe(50_00);
    expect(pnl.netProfit).toBe(150_00);
    expect(pnl.income).toEqual([{ name: "Job Revenue", total: 200_00 }]);
  });
});

describe("computeReports — balance sheet is a snapshot through `end`", () => {
  it("cash & retained earnings are cumulative ON/BEFORE end, ignoring start", () => {
    const start = new Date(2025, 0, 1).getTime();
    const end = new Date(2025, 11, 31, 23, 59, 59, 999).getTime();
    const { balanceSheet } = computeReports(TXNS, { startMs: start, endMs: end });
    // Through end of 2025: 100 - 40 + 200 - 50 = 210 (the 2026 +80 is excluded).
    expect(balanceSheet.totalAssets).toBe(210_00);
    expect(balanceSheet.totalEquity).toBe(210_00);
    expect(balanceSheet.totalLiabilities).toBe(0);
  });

  it("all-time snapshot equals the all-time net profit", () => {
    const { pnl, balanceSheet } = computeReports(TXNS);
    expect(balanceSheet.totalAssets).toBe(pnl.netProfit);
  });
});

describe("resolvePeriod", () => {
  const now = new Date(2026, 5, 13); // Jun 13, 2026

  it("all → unbounded, all-time labels", () => {
    const r = resolvePeriod("all", now);
    expect(r.period).toEqual({ startMs: null, endMs: null });
    expect(r.pnlLabel).toBe("All transactions");
    expect(r.asOfLabel).toBe("As of today");
  });

  it("a past year → full calendar year, as-of Dec 31", () => {
    const r = resolvePeriod("2025", now);
    expect(r.period.startMs).toBe(new Date(2025, 0, 1, 0, 0, 0, 0).getTime());
    expect(r.period.endMs).toBe(new Date(2025, 11, 31, 23, 59, 59, 999).getTime());
    expect(r.pnlLabel).toBe("Jan 1 – Dec 31, 2025");
    expect(r.asOfLabel).toBe("As of Dec 31, 2025");
  });

  it("current year → as-of today (not a past Dec 31)", () => {
    const r = resolvePeriod("2026", now);
    expect(r.asOfLabel).toBe("As of today");
  });

  it("custom range honors both bounds", () => {
    const r = resolvePeriod("custom", now, { start: "2025-04-01", end: "2025-06-30" });
    expect(r.period.startMs).toBe(new Date(2025, 3, 1, 0, 0, 0, 0).getTime());
    expect(r.period.endMs).toBe(new Date(2025, 5, 30, 23, 59, 59, 999).getTime());
    expect(r.asOfLabel).toBe("As of Jun 30, 2025");
  });
});
