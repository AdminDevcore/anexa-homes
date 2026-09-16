import type { Vertical } from "@prisma/client";
import type { RenderableReport, ReportTable } from "@/server/modules/reports/builders";
import {
  accountBalances,
  balanceSheet,
  generalLedger,
  profitAndLoss,
  trialBalance,
  type AccountBalance,
  type Period,
  type ProfitAndLoss,
  type StatementBasis,
} from "./reports";

/**
 * THE FINANCIAL STATEMENTS, AS SOMETHING A PERSON CAN READ.
 *
 * `reports.ts` computes the numbers. This file turns them into the
 * `RenderableReport` shape the portal already knows how to draw, download as
 * CSV and print as a PDF — so the statements get all three from one
 * description instead of three hand-written screens.
 *
 * ── WHY THIS DOES NOT USE THE HOUSE MONEY FORMATTER ─────────────────────────
 * `makeMoney` and every `usd()` in the reports modules round to whole dollars
 * (`maximumFractionDigits: 0`, `Math.round(cents / 100)`). That is right for a
 * sales funnel and WRONG here. A trial balance exists to show that debits equal
 * credits exactly; rounded to dollars, a ledger that balances can print as
 * though it does not, and — worse — one that is out by a few cents can print as
 * though it balances. The same goes for A = L + E.
 *
 * So `money()` below is cent-exact and built from integer arithmetic only: it
 * never divides, so it cannot acquire a floating-point error on the way to the
 * page.
 *
 * ── ROWS ARE FORMATTED STRINGS ──────────────────────────────────────────────
 * Every existing report emits display strings, and `RenderableReportView`
 * prints cells verbatim, so a raw integer would render as "123456". Following
 * the house convention keeps one renderer for everything — at the cost that a
 * CSV carries "$1,234.56" rather than a number a spreadsheet can sum. That cost
 * is exactly the argument for a real XLSX export, and is recorded in
 * books-build.md rather than silently accepted.
 */

/** Cent-exact, integer-only. No division, so no float error can creep in. */
export function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.trunc(abs / 100).toLocaleString("en-US");
  const rem = String(abs % 100).padStart(2, "0");
  return `${sign}$${dollars}.${rem}`;
}

export type StatementSlug = "trial-balance" | "profit-and-loss" | "balance-sheet" | "general-ledger";

export const STATEMENT_META: Record<StatementSlug, { title: string; description: string }> = {
  "trial-balance": {
    title: "Trial Balance",
    description: "Every account's debits against its credits. The one report that checks the ledger rather than describing it.",
  },
  "profit-and-loss": {
    title: "Profit & Loss",
    description: "Income less cost of goods sold and expenses, down to net income, for the period you choose.",
  },
  "balance-sheet": {
    title: "Balance Sheet",
    description: "What the company owns, what it owes, and what is left — as at a date.",
  },
  "general-ledger": {
    title: "General Ledger",
    description: "Every line on one account, in order, with a running balance. The drill-down behind every figure.",
  },
};

const label = (basis: StatementBasis) => (basis === "cash" ? "Cash basis" : "Accrual basis");
const verticalLabel = (v: Vertical | null) =>
  v == null ? "All departments" : v === "roofing" ? "Roofing" : v === "solar" ? "Solar" : "Other";

/** A period's human label. `null` bounds read as open, which is what they are. */
function periodLabel(period?: Period): string {
  if (!period) return "All time";
  const d = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  if (period.startMs == null && period.endMs == null) return "All time";
  if (period.startMs == null) return `Through ${d(period.endMs!)}`;
  if (period.endMs == null) return `From ${d(period.startMs)}`;
  return `${d(period.startMs)} → ${d(period.endMs)}`;
}

/**
 * The period of equal length immediately before this one, for the comparison
 * column. Both bounds must be known: "all time" and open-ended windows have no
 * previous period, and inventing one would put a column of confident numbers
 * next to a figure they do not correspond to.
 */
export function priorPeriod(period?: Period): Period | null {
  if (!period || period.startMs == null || period.endMs == null) return null;
  const span = period.endMs - period.startMs;
  return { startMs: period.startMs - span - 1, endMs: period.startMs - 1 };
}

/** The same window one calendar year earlier. */
export function priorYear(period?: Period): Period | null {
  if (!period || period.startMs == null || period.endMs == null) return null;
  const back = (ms: number) => {
    const d = new Date(ms);
    d.setUTCFullYear(d.getUTCFullYear() - 1);
    return d.getTime();
  };
  return { startMs: back(period.startMs), endMs: back(period.endMs) };
}

export type ComparisonMode = "none" | "prior_period" | "prior_year";

const COMPARISON_LABEL: Record<ComparisonMode, string> = {
  none: "No comparison",
  prior_period: "vs. previous period",
  prior_year: "vs. same period last year",
};

function comparisonWindow(mode: ComparisonMode, period?: Period): Period | null {
  if (mode === "prior_period") return priorPeriod(period);
  if (mode === "prior_year") return priorYear(period);
  return null;
}

export type StatementArgs = {
  companyId: string;
  period?: Period;
  vertical?: Vertical | null;
  basis?: StatementBasis;
  comparison?: ComparisonMode;
};

/** The subtitle every statement carries, so an exported file explains itself. */
function scopeLabel(args: StatementArgs): string {
  return `${verticalLabel(args.vertical ?? null)} · ${label(args.basis ?? "accrual")}`;
}

// ── Trial balance ───────────────────────────────────────────────────────────

/**
 * Deliberately ACCRUAL-ONLY, and it takes no basis argument so a caller cannot
 * ask for something meaningless. The trial balance proves the ledger balances;
 * a cash-basis subset of entries does not balance and is not supposed to, so
 * offering the toggle here would produce a report that looks broken whenever it
 * was used.
 */
export async function trialBalanceStatement(args: {
  companyId: string;
  asOf?: Date;
}): Promise<RenderableReport> {
  const tb = await trialBalance(args.companyId, args.asOf);

  const rows: (string | number)[][] = tb.rows.map((r) => [
    `${r.number} ${r.name}`,
    r.debitCents ? money(r.debitCents) : "",
    r.creditCents ? money(r.creditCents) : "",
  ]);
  rows.push(["Total", money(tb.totalDebitsCents), money(tb.totalCreditsCents)]);

  return {
    title: STATEMENT_META["trial-balance"].title,
    periodLabel: args.asOf ? `As at ${args.asOf.toISOString().slice(0, 10)}` : "As at today",
    scopeLabel: "Accrual basis",
    metrics: [
      { label: "Total debits", value: money(tb.totalDebitsCents) },
      { label: "Total credits", value: money(tb.totalCreditsCents) },
      {
        label: "Ledger balances",
        value: tb.balanced ? "Yes" : "NO — investigate",
        tone: tb.balanced ? "pos" : "neg",
        hint: tb.balanced ? undefined : "something wrote journal_lines directly",
      },
    ],
    tables: [{ title: "All accounts", columns: ["Account", "Debit", "Credit"], rows }],
  };
}

// ── Profit and loss ─────────────────────────────────────────────────────────

/** One P&L section as table rows, with an optional comparison column. */
function pnlRows(
  pnl: ProfitAndLoss,
  prior: ProfitAndLoss | null
): { columns: string[]; rows: (string | number)[][] } {
  const columns = prior ? ["Account", "Amount", "Comparison", "Change"] : ["Account", "Amount"];
  const rows: (string | number)[][] = [];

  const priorFor = (accountId: string, section: keyof ProfitAndLoss): number => {
    if (!prior) return 0;
    const s = prior[section];
    if (typeof s !== "object" || s === null || !("rows" in s)) return 0;
    return (s.rows as AccountBalance[]).find((r) => r.accountId === accountId)?.balanceCents ?? 0;
  };

  const push = (text: string, cents: number, priorCents: number | null) => {
    if (prior && priorCents !== null) {
      rows.push([text, money(cents), money(priorCents), money(cents - priorCents)]);
    } else if (prior) {
      rows.push([text, money(cents), "", ""]);
    } else {
      rows.push([text, money(cents)]);
    }
  };

  const section = (heading: string, key: "income" | "cogs" | "expenses" | "otherIncome" | "otherExpenses") => {
    const s = pnl[key];
    if (s.rows.length === 0) return;
    push(heading.toUpperCase(), s.totalCents, prior ? (prior[key].totalCents ?? 0) : null);
    for (const r of s.rows) {
      push(`    ${r.number} ${r.name}`, r.balanceCents, prior ? priorFor(r.accountId, key) : null);
    }
  };

  section("Income", "income");
  section("Cost of goods sold", "cogs");
  push("GROSS PROFIT", pnl.grossProfitCents, prior ? prior.grossProfitCents : null);
  section("Expenses", "expenses");
  push("OPERATING INCOME", pnl.operatingIncomeCents, prior ? prior.operatingIncomeCents : null);
  section("Other income", "otherIncome");
  section("Other expenses", "otherExpenses");
  push("NET INCOME", pnl.netIncomeCents, prior ? prior.netIncomeCents : null);

  return { columns, rows };
}

export async function profitAndLossStatement(args: StatementArgs): Promise<RenderableReport> {
  const basis = args.basis ?? "accrual";
  const mode = args.comparison ?? "none";
  const window = comparisonWindow(mode, args.period);

  const [pnl, prior] = await Promise.all([
    profitAndLoss({ companyId: args.companyId, period: args.period, vertical: args.vertical, basis }),
    window
      ? profitAndLoss({ companyId: args.companyId, period: window, vertical: args.vertical, basis })
      : Promise.resolve(null),
  ]);

  const { columns, rows } = pnlRows(pnl, prior);

  return {
    title: STATEMENT_META["profit-and-loss"].title,
    periodLabel: window
      ? `${periodLabel(args.period)} (${COMPARISON_LABEL[mode]}: ${periodLabel(window)})`
      : periodLabel(args.period),
    scopeLabel: scopeLabel(args),
    metrics: [
      { label: "Income", value: money(pnl.income.totalCents) },
      { label: "Gross profit", value: money(pnl.grossProfitCents) },
      {
        label: "Net income",
        value: money(pnl.netIncomeCents),
        tone: pnl.netIncomeCents >= 0 ? "pos" : "neg",
      },
    ],
    tables: [{ title: `Profit & Loss — ${label(basis)}`, columns, rows }],
  };
}

// ── Balance sheet ───────────────────────────────────────────────────────────

/**
 * ACCRUAL ONLY, on purpose. A cash-basis balance sheet is not well defined —
 * drop the receivables and payables that the cash basis excludes and the thing
 * stops balancing, which is the one property a balance sheet has. The screen
 * says so rather than offering a toggle that produces nonsense.
 */
export async function balanceSheetStatement(args: {
  companyId: string;
  asOf: Date;
  vertical?: Vertical | null;
}): Promise<RenderableReport> {
  const bs = await balanceSheet({ companyId: args.companyId, asOf: args.asOf, vertical: args.vertical });

  const rows: (string | number)[][] = [];
  const section = (heading: string, part: { rows: AccountBalance[]; totalCents: number }) => {
    rows.push([heading.toUpperCase(), money(part.totalCents)]);
    for (const r of part.rows) rows.push([`    ${r.number} ${r.name}`, money(r.balanceCents)]);
  };

  section("Assets", bs.assets);
  rows.push(["TOTAL ASSETS", money(bs.totalAssetsCents)]);
  section("Liabilities", bs.liabilities);
  rows.push(["TOTAL LIABILITIES", money(bs.totalLiabilitiesCents)]);
  section("Equity", bs.equityAccounts);
  // Not stored anywhere: income and expense accounts are not closed until year
  // end, so this year's profit is not in equity yet. A balance sheet that left
  // it out would simply not balance.
  rows.push(["    Net income (this fiscal year, not yet closed)", money(bs.netIncomeCents)]);
  rows.push(["TOTAL EQUITY", money(bs.totalEquityCents)]);

  return {
    title: STATEMENT_META["balance-sheet"].title,
    periodLabel: `As at ${args.asOf.toISOString().slice(0, 10)}`,
    scopeLabel: `${verticalLabel(args.vertical ?? null)} · Accrual basis`,
    metrics: [
      { label: "Total assets", value: money(bs.totalAssetsCents) },
      { label: "Total liabilities", value: money(bs.totalLiabilitiesCents) },
      { label: "Total equity", value: money(bs.totalEquityCents) },
      {
        label: "Balances (A = L + E)",
        value: bs.balanced ? "Yes" : "NO — investigate",
        tone: bs.balanced ? "pos" : "neg",
      },
    ],
    tables: [{ title: "Balance Sheet", columns: ["", "Amount"], rows }],
  };
}

// ── General ledger ──────────────────────────────────────────────────────────

export async function generalLedgerStatement(args: {
  companyId: string;
  accountId: string;
  accountLabel: string;
  period?: Period;
}): Promise<RenderableReport> {
  const lines = await generalLedger({
    companyId: args.companyId,
    accountId: args.accountId,
    period: args.period,
  });

  const table: ReportTable = {
    title: args.accountLabel,
    columns: ["Date", "Memo", "Vendor", "Debit", "Credit", "Balance"],
    rows: lines.map((l) => [
      l.date.slice(0, 10),
      // A void is MARKED rather than hidden: the point of a ledger is that you
      // can see the mistake and its correction, and both are counted because
      // the reversal already takes the original back out.
      `${l.status === "void" ? "[VOID] " : ""}${l.memo ?? ""}`,
      l.vendorName ?? "",
      l.debitCents ? money(l.debitCents) : "",
      l.creditCents ? money(l.creditCents) : "",
      money(l.runningCents),
    ]),
  };

  return {
    title: STATEMENT_META["general-ledger"].title,
    periodLabel: periodLabel(args.period),
    scopeLabel: args.accountLabel,
    metrics: [
      { label: "Lines", value: String(lines.length) },
      {
        label: "Closing balance",
        value: money(lines.length ? lines[lines.length - 1].runningCents : 0),
      },
    ],
    tables: [table],
  };
}

/** Accounts that have any activity, for the general-ledger picker. */
export async function ledgerAccountOptions(
  companyId: string
): Promise<{ value: string; label: string }[]> {
  const rows = await accountBalances({ companyId });
  return rows.map((r) => ({ value: r.accountId, label: `${r.number} ${r.name}` }));
}
