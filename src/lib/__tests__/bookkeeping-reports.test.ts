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

// ---------------------------------------------------------------------------
// Phase 1 acceptance: the company P&L segments by vertical AND reconciles to
// the consolidated total. One legal entity, one ledger, reported by department.
// ---------------------------------------------------------------------------
describe("P&L segments by vertical and reconciles", () => {
  const txns = [
    { date: "2026-03-01", amountCents: 100_00, categoryName: "Job revenue", vertical: "roofing" },
    { date: "2026-03-02", amountCents: -40_00, categoryName: "Materials", vertical: "roofing" },
    { date: "2026-03-03", amountCents: 250_00, categoryName: "Job revenue", vertical: "solar" },
    { date: "2026-03-04", amountCents: -90_00, categoryName: "Equipment", vertical: "solar" },
    // Company-level: belongs to no vertical (office rent).
    { date: "2026-03-05", amountCents: -30_00, categoryName: "Rent", vertical: null },
  ];

  it("breaks out each department", () => {
    const { pnl } = computeReports(txns);
    const by = Object.fromEntries(pnl.segments.map((s) => [s.vertical, s]));

    expect(by.roofing).toMatchObject({ totalIncome: 100_00, totalExpense: 40_00, netProfit: 60_00 });
    expect(by.solar).toMatchObject({ totalIncome: 250_00, totalExpense: 90_00, netProfit: 160_00 });
    expect(by.unassigned).toMatchObject({ totalIncome: 0, totalExpense: 30_00, netProfit: -30_00 });
  });

  it("segments sum exactly to the consolidated totals", () => {
    const { pnl } = computeReports(txns);
    const sum = (f: "totalIncome" | "totalExpense" | "netProfit") =>
      pnl.segments.reduce((n, s) => n + s[f], 0);

    expect(sum("totalIncome")).toBe(pnl.totalIncome);
    expect(sum("totalExpense")).toBe(pnl.totalExpense);
    expect(sum("netProfit")).toBe(pnl.netProfit);
    // …and the consolidated figure is still the whole company.
    expect(pnl.netProfit).toBe(190_00);
  });

  it("reconciles when every row is roofing (today's live state)", () => {
    const roofingOnly = txns.filter((t) => t.vertical === "roofing");
    const { pnl } = computeReports(roofingOnly);
    expect(pnl.segments).toHaveLength(1);
    expect(pnl.segments[0].netProfit).toBe(pnl.netProfit);
  });

  it("respects the period filter per segment", () => {
    const { pnl } = computeReports(txns, {
      startMs: Date.parse("2026-03-03"),
      endMs: Date.parse("2026-03-04"),
    });
    expect(pnl.segments).toHaveLength(1);
    expect(pnl.segments[0]).toMatchObject({ vertical: "solar", netProfit: 160_00 });
    expect(pnl.segments[0].netProfit).toBe(pnl.netProfit);
  });
});
