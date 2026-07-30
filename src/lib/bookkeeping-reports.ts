// Period-aware Profit & Loss + Balance Sheet, shared by the server query (and
// PDF routes) and the client so an interactive period picker and the downloaded
// PDF compute identically. Cash basis, single cash account.
//
//   P&L  = income/expense for transactions DATED WITHIN [start, end]   (a period)
//   B/S  = cash & retained earnings for everything dated ON/BEFORE end (a snapshot)
//
// That split is standard accounting: the income statement covers a span of time,
// the balance sheet is a point-in-time position.

export type ReportRow = { name: string; total: number };
export type ReportTxn = {
  date: string | Date;
  amountCents: number;
  categoryName: string | null;
  /**
   * Which line of business the row belongs to. Null = genuinely company-level
   * (office rent, a bank fee) and is reported as "Unassigned".
   */
  vertical?: string | null;
};

/**
 * One department's slice of the P&L. The books are consolidated — reads are
 * never filtered by vertical — so these are a BREAKOUT of the same numbers, not
 * a separate ledger. They are guaranteed to sum back to the consolidated
 * totals; `bookkeeping-reports.test.ts` asserts that reconciliation.
 */
export type PnlSegment = {
  vertical: string; // "roofing" | "solar" | "unassigned"
  totalIncome: number;
  totalExpense: number;
  netProfit: number;
};
/** Epoch-ms bounds; null = unbounded on that side (all time / as-of-now). */
export type ReportPeriod = { startMs: number | null; endMs: number | null };

export type Pnl = {
  income: ReportRow[];
  expense: ReportRow[];
  totalIncome: number;
  totalExpense: number;
  netProfit: number;
  /** Per-department breakout. Always sums to the consolidated totals above. */
  segments: PnlSegment[];
};
export type BalanceSheet = {
  assets: ReportRow[];
  liabilities: ReportRow[];
  equity: ReportRow[];
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
};

function ms(d: string | Date): number {
  return d instanceof Date ? d.getTime() : new Date(d).getTime();
}

export function computeReports(
  txns: ReportTxn[],
  period?: ReportPeriod
): { pnl: Pnl; balanceSheet: BalanceSheet } {
  const startMs = period?.startMs ?? null;
  const endMs = period?.endMs ?? null;

  const incomeByCat = new Map<string, number>();
  const expenseByCat = new Map<string, number>();
  const segments = new Map<string, { income: number; expense: number }>();
  let moneyIn = 0;
  let moneyOut = 0;
  let cashThroughEnd = 0; // cumulative cash (= retained earnings) on/before `end`

  for (const t of txns) {
    const tms = ms(t.date);
    const onOrBeforeEnd = endMs == null || tms <= endMs;
    if (onOrBeforeEnd) cashThroughEnd += t.amountCents;

    const inPeriod = (startMs == null || tms >= startMs) && onOrBeforeEnd;
    if (!inPeriod) continue;

    const name = t.categoryName ?? "Uncategorized";
    const seg = t.vertical ?? "unassigned";
    const bucket = segments.get(seg) ?? { income: 0, expense: 0 };
    if (t.amountCents >= 0) {
      moneyIn += t.amountCents;
      incomeByCat.set(name, (incomeByCat.get(name) ?? 0) + t.amountCents);
      bucket.income += t.amountCents;
    } else {
      moneyOut += -t.amountCents;
      expenseByCat.set(name, (expenseByCat.get(name) ?? 0) + -t.amountCents);
      bucket.expense += -t.amountCents;
    }
    segments.set(seg, bucket);
  }

  const toRows = (m: Map<string, number>): ReportRow[] =>
    [...m.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total);

  const pnl: Pnl = {
    income: toRows(incomeByCat),
    expense: toRows(expenseByCat),
    totalIncome: moneyIn,
    totalExpense: moneyOut,
    netProfit: moneyIn - moneyOut,
    segments: [...segments.entries()]
      .map(([vertical, b]) => ({
        vertical,
        totalIncome: b.income,
        totalExpense: b.expense,
        netProfit: b.income - b.expense,
      }))
      .sort((a, b) => b.netProfit - a.netProfit),
  };

  const balanceSheet: BalanceSheet = {
    assets: [{ name: "Cash on hand", total: cashThroughEnd }],
    liabilities: [],
    equity: [{ name: "Retained earnings", total: cashThroughEnd }],
    totalAssets: cashThroughEnd,
    totalLiabilities: 0,
    totalEquity: cashThroughEnd,
  };

  return { pnl, balanceSheet };
}

// ── Period presets ──────────────────────────────────────────────────────────
// Resolve a preset (or a custom range) into bounds + human labels. `now` is
// injected so callers control "today" (and tests stay deterministic).

export type PeriodPreset = "all" | "month" | "quarter" | "year" | "custom" | string; // string = a specific year "2025"

export type ResolvedPeriod = {
  period: ReportPeriod;
  /** e.g. "Jan 1 – Dec 31, 2025", "This month", "All transactions" */
  pnlLabel: string;
  /** e.g. "As of Dec 31, 2025", "As of today" */
  asOfLabel: string;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtDay(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
function fmtRange(a: Date, b: Date): string {
  const sameYear = a.getFullYear() === b.getFullYear();
  const left = sameYear ? `${MONTHS[a.getMonth()]} ${a.getDate()}` : fmtDay(a);
  return `${left} – ${fmtDay(b)}`;
}
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}
function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

export function resolvePeriod(
  preset: PeriodPreset,
  now: Date,
  custom?: { start?: string | null; end?: string | null }
): ResolvedPeriod {
  const yr = now.getFullYear();

  if (preset === "all") {
    return { period: { startMs: null, endMs: null }, pnlLabel: "All transactions", asOfLabel: "As of today" };
  }
  if (preset === "month") {
    const start = new Date(yr, now.getMonth(), 1, 0, 0, 0, 0);
    const end = new Date(yr, now.getMonth() + 1, 0, 23, 59, 59, 999);
    return { period: { startMs: start.getTime(), endMs: end.getTime() }, pnlLabel: fmtRange(start, end), asOfLabel: `As of ${fmtDay(end)}` };
  }
  if (preset === "quarter") {
    const q = Math.floor(now.getMonth() / 3);
    const start = new Date(yr, q * 3, 1, 0, 0, 0, 0);
    const end = new Date(yr, q * 3 + 3, 0, 23, 59, 59, 999);
    return { period: { startMs: start.getTime(), endMs: end.getTime() }, pnlLabel: fmtRange(start, end), asOfLabel: `As of ${fmtDay(end)}` };
  }
  if (preset === "custom") {
    const s = custom?.start ? startOfDay(new Date(custom.start + "T00:00:00")) : null;
    const e = custom?.end ? endOfDay(new Date(custom.end + "T00:00:00")) : null;
    const pnlLabel = s && e ? fmtRange(s, e) : s ? `Since ${fmtDay(s)}` : e ? `Through ${fmtDay(e)}` : "All transactions";
    return { period: { startMs: s?.getTime() ?? null, endMs: e?.getTime() ?? null }, pnlLabel, asOfLabel: e ? `As of ${fmtDay(e)}` : "As of today" };
  }

  // "year" = current year; a 4-digit string = that specific year.
  const year = preset === "year" ? yr : parseInt(preset, 10);
  if (Number.isFinite(year)) {
    const start = new Date(year, 0, 1, 0, 0, 0, 0);
    const end = new Date(year, 11, 31, 23, 59, 59, 999);
    const asOf = year >= yr ? "As of today" : `As of ${fmtDay(end)}`;
    return { period: { startMs: start.getTime(), endMs: end.getTime() }, pnlLabel: `Jan 1 – Dec 31, ${year}`, asOfLabel: asOf };
  }

  return { period: { startMs: null, endMs: null }, pnlLabel: "All transactions", asOfLabel: "As of today" };
}
