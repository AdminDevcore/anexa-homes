import { prisma } from "@/server/db/client";
import type { BalanceSheet, Pnl, ReportPeriod, ReportRow } from "@/lib/bookkeeping-reports";

/**
 * The Profit & Loss and Balance Sheet, computed IN THE DATABASE.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * `computeReports` in lib/bookkeeping-reports.ts is the same arithmetic over an
 * array, and it is still the right tool for the client's period picker — it
 * recomputes instantly with no round trip. What it cannot do is see
 * transactions nobody fetched.
 *
 * `getBookkeepingData` fetched the newest 1,000 transactions for the ledger
 * table and then handed that array to `computeReports` with the reporting
 * period, applying the date filter IN MEMORY. Once a company passes 1,000
 * transactions the arithmetic is exactly right over the wrong set of rows:
 * ask for a quarter that sits below the cut and the P&L renders $0 with
 * nothing on screen saying it is incomplete. Worse for the balance sheet,
 * whose `cashThroughEnd` is cumulative — retained earnings is then wrong by
 * everything older than row 1,000, permanently and increasingly.
 *
 * That arrives sooner than it sounds: `postRunToBookkeeping` writes one
 * transaction per payroll line, so a company running weekly payroll for a
 * dozen people crosses 1,000 inside two years.
 *
 * ── THE SHAPE OF THE FIX ────────────────────────────────────────────────────
 * The period goes into the `where` clause and the sums come back from Postgres.
 * No `take`, no page, no truncation possible. The list of transactions the
 * ledger table renders keeps its cap — that is a table view and paging it is
 * correct — but no total is derived from it any more.
 *
 * ── INCOME AND EXPENSE ARE SPLIT BY SIGN, NOT BY CATEGORY TYPE ──────────────
 * A category can legitimately carry rows both ways (a refund against an expense
 * category), and the in-memory version split on `amountCents >= 0`. Prisma
 * cannot `groupBy` an expression, so that split is two grouped queries with
 * complementary `amountCents` filters rather than one. Same rule, same answer.
 *
 * ── DATES ARE ABSOLUTE INSTANTS ─────────────────────────────────────────────
 * `ReportPeriod` is epoch milliseconds and `date` is a timestamp, so the
 * comparison is unambiguous and identical to the in-memory `<=` it replaces.
 * Which local day a boundary falls on is decided once, by `resolvePeriod`, on
 * the machine that built the bounds — this layer neither knows nor needs to.
 */

/** `null` on either side means unbounded — all time, or as-of-now. */
function dateFilter(period?: ReportPeriod) {
  const gte = period?.startMs != null ? new Date(period.startMs) : undefined;
  const lte = period?.endMs != null ? new Date(period.endMs) : undefined;
  return gte || lte ? { gte, lte } : undefined;
}

const rows = (m: Map<string, number>): ReportRow[] =>
  [...m.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total);

export type DbReports = {
  pnl: Pnl;
  balanceSheet: BalanceSheet;
  /**
   * Cash-basis totals for the top cards, over the SAME period as the P&L.
   *
   * They used to be labelled all-time and computed over the newest 1,000 rows,
   * which was neither. Tying them to the period the user picked makes the cards
   * and the statement below them answer the same question.
   */
  moneyIn: number;
  moneyOut: number;
  /** Rows still needing a category, over the whole ledger. */
  uncategorized: number;
};

export async function computeReportsFromDb(
  companyId: string,
  period?: ReportPeriod
): Promise<DbReports> {
  const date = dateFilter(period);
  const inPeriod = { companyId, ...(date ? { date } : {}) };

  const [incomeByCat, expenseByCat, incomeBySeg, expenseBySeg, cash, uncategorized, categories] =
    await Promise.all([
      prisma.transaction.groupBy({
        by: ["categoryId"],
        where: { ...inPeriod, amountCents: { gte: 0 } },
        _sum: { amountCents: true },
      }),
      prisma.transaction.groupBy({
        by: ["categoryId"],
        where: { ...inPeriod, amountCents: { lt: 0 } },
        _sum: { amountCents: true },
      }),
      prisma.transaction.groupBy({
        by: ["vertical"],
        where: { ...inPeriod, amountCents: { gte: 0 } },
        _sum: { amountCents: true },
      }),
      prisma.transaction.groupBy({
        by: ["vertical"],
        where: { ...inPeriod, amountCents: { lt: 0 } },
        _sum: { amountCents: true },
      }),
      /**
       * THE BALANCE SHEET IS A SNAPSHOT, not a period: everything dated on or
       * before the end, with no lower bound whatever the P&L was asked for.
       * That split is standard accounting and it is why this is its own query
       * rather than a total of the two above.
       */
      prisma.transaction.aggregate({
        where: {
          companyId,
          ...(period?.endMs != null ? { date: { lte: new Date(period.endMs) } } : {}),
        },
        _sum: { amountCents: true },
      }),
      // Over the whole ledger, not the period: "12 to review" is a worklist,
      // and a worklist that hides older rows is a worklist that lies.
      prisma.transaction.count({ where: { companyId, categoryId: null } }),
      prisma.bookkeepingCategory.findMany({
        where: { companyId },
        select: { id: true, name: true },
      }),
    ]);

  const nameOf = new Map(categories.map((c) => [c.id, c.name]));
  // The same label the in-memory version uses for a row with no category, so
  // the two cannot disagree about what to call it.
  const label = (id: string | null) => (id ? (nameOf.get(id) ?? "Uncategorized") : "Uncategorized");

  const income = new Map<string, number>();
  for (const g of incomeByCat) {
    const key = label(g.categoryId);
    income.set(key, (income.get(key) ?? 0) + (g._sum.amountCents ?? 0));
  }
  const expense = new Map<string, number>();
  for (const g of expenseByCat) {
    const key = label(g.categoryId);
    // Expenses are stored negative and reported positive, as they always were.
    expense.set(key, (expense.get(key) ?? 0) + -(g._sum.amountCents ?? 0));
  }

  const totalIncome = [...income.values()].reduce((s, n) => s + n, 0);
  const totalExpense = [...expense.values()].reduce((s, n) => s + n, 0);

  const seg = new Map<string, { income: number; expense: number }>();
  const bucket = (v: string | null) => {
    const key = v ?? "unassigned";
    const b = seg.get(key) ?? { income: 0, expense: 0 };
    seg.set(key, b);
    return b;
  };
  for (const g of incomeBySeg) bucket(g.vertical).income += g._sum.amountCents ?? 0;
  for (const g of expenseBySeg) bucket(g.vertical).expense += -(g._sum.amountCents ?? 0);

  const cashThroughEnd = cash._sum.amountCents ?? 0;

  return {
    pnl: {
      income: rows(income),
      expense: rows(expense),
      totalIncome,
      totalExpense,
      netProfit: totalIncome - totalExpense,
      segments: [...seg.entries()]
        .map(([vertical, b]) => ({
          vertical,
          totalIncome: b.income,
          totalExpense: b.expense,
          netProfit: b.income - b.expense,
        }))
        .sort((a, b) => b.netProfit - a.netProfit),
    },
    balanceSheet: {
      assets: [{ name: "Cash on hand", total: cashThroughEnd }],
      liabilities: [],
      equity: [{ name: "Retained earnings", total: cashThroughEnd }],
      totalAssets: cashThroughEnd,
      totalLiabilities: 0,
      totalEquity: cashThroughEnd,
    },
    moneyIn: totalIncome,
    moneyOut: totalExpense,
    uncategorized,
  };
}

/**
 * Every job's cash activity, over the whole ledger.
 *
 * Grouped in Postgres for the same reason as the statement above it: rolled up
 * from the newest 1,000 rows, a job whose transactions had aged off the page
 * reported less than it had taken — or vanished from the list entirely.
 */
export async function jobActivityFromDb(companyId: string): Promise<
  Map<string, { in: number; out: number; count: number; last: number }>
> {
  const [inRows, outRows, meta] = await Promise.all([
    prisma.transaction.groupBy({
      by: ["projectId"],
      where: { companyId, projectId: { not: null }, amountCents: { gte: 0 } },
      _sum: { amountCents: true },
    }),
    prisma.transaction.groupBy({
      by: ["projectId"],
      where: { companyId, projectId: { not: null }, amountCents: { lt: 0 } },
      _sum: { amountCents: true },
    }),
    prisma.transaction.groupBy({
      by: ["projectId"],
      where: { companyId, projectId: { not: null } },
      _count: { _all: true },
      _max: { date: true },
    }),
  ]);

  const out = new Map<string, { in: number; out: number; count: number; last: number }>();
  const at = (id: string) => {
    const e = out.get(id) ?? { in: 0, out: 0, count: 0, last: 0 };
    out.set(id, e);
    return e;
  };
  for (const g of inRows) if (g.projectId) at(g.projectId).in += g._sum.amountCents ?? 0;
  for (const g of outRows) if (g.projectId) at(g.projectId).out += -(g._sum.amountCents ?? 0);
  for (const g of meta) {
    if (!g.projectId) continue;
    const e = at(g.projectId);
    e.count = g._count._all;
    e.last = g._max.date ? g._max.date.getTime() : 0;
  }
  return out;
}
