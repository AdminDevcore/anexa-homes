import type { LedgerAccountType, Vertical } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { normalBalance, statementOf } from "./chart";

/**
 * THE STATEMENTS, COMPUTED IN THE DATABASE.
 *
 * Every figure here is a `groupBy` over `journal_lines` with no `take` and no
 * page. That is not a preference: the ledger this replaces derived its P&L from
 * the newest 1,000 transactions and applied the reporting period to that array
 * in memory, so any period sitting below the cut reported $0 with nothing on
 * screen saying it was incomplete (`bookkeeping/reports-db.ts` documents the
 * whole incident, and `pnl-truncation.itest.ts` pins the fix).
 *
 * ── A VOID AND ITS REVERSAL BOTH COUNT, AND CANCEL ──────────────────────────
 * Voiding writes a reversing entry with every debit and credit swapped, so the
 * PAIR already nets to zero. Nothing here filters on status, and that is
 * load-bearing: filtering `status = "posted"` drops the void original while
 * keeping its reversal, which subtracts the amount TWICE. That is not a
 * hypothetical — it is what the first version of this file did, and
 * `reports.itest.ts` caught it as a $999 void moving income by $1,998.
 *
 * So `status` is PRESENTATIONAL here, not arithmetical: the general ledger
 * marks a void so a reader can see the mistake and its correction, and every
 * total simply includes both. `voidJournalEntry` writes the reversal in the
 * same transaction as the status change, so the pair can never be half-present.
 *
 * ── THE BALANCE SHEET INCLUDES CURRENT-PERIOD NET INCOME ────────────────────
 * Income and expense accounts are not closed until year end, so equity as
 * stored does not yet contain this year's profit. A balance sheet that omitted
 * it would simply not balance. Net income is therefore computed for the fiscal
 * year to the as-of date and reported as its own equity line — which is also
 * how the year-end close is expressed: the figure is already there, the close
 * merely makes it permanent in Retained Earnings.
 */

export type AccountBalance = {
  accountId: string;
  number: string;
  name: string;
  type: LedgerAccountType;
  /** Signed in the account's NORMAL direction: a positive expense is a cost. */
  balanceCents: number;
  debitCents: number;
  creditCents: number;
};

export type Period = { startMs: number | null; endMs: number | null };

function range(period?: Period) {
  const gte = period?.startMs != null ? new Date(period.startMs) : undefined;
  const lte = period?.endMs != null ? new Date(period.endMs) : undefined;
  return gte || lte ? { gte, lte } : undefined;
}

/** The fiscal year containing `asOf`. Jan–Dec, as books-build.md settles. */
export function fiscalYearStart(asOf: Date): Date {
  return new Date(Date.UTC(asOf.getUTCFullYear(), 0, 1));
}

/**
 * Every account's movement over a window, already signed the way its class
 * reads. `vertical` filters the LINE, which is what makes a departmental P&L
 * possible without a second set of books.
 *
 * ── AN UNTAGGED LINE BELONGS TO NO DEPARTMENT ───────────────────────────────
 * Asking for a vertical returns ONLY lines tagged to it. Office rent, a bank
 * fee and a transfer between our own accounts carry no vertical because they
 * genuinely belong to neither Roofing nor Solar, and inventing an answer — by
 * folding them into whichever column was asked for, or splitting them — would
 * make both departments wrong in a way nobody could see.
 *
 * The consequence is deliberate and must not be "fixed": **the two department
 * P&Ls do not sum to the combined P&L.** The difference is exactly the
 * company-level overhead, and the combined column is the one that reconciles to
 * the general ledger. `profitAndLossByVertical` returns both for that reason.
 */
export async function accountBalances(args: {
  companyId: string;
  period?: Period;
  vertical?: Vertical | null;
}): Promise<AccountBalance[]> {
  const { companyId, period, vertical } = args;
  const date = range(period);

  const grouped = await prisma.journalLine.groupBy({
    by: ["accountId"],
    where: {
      companyId,
      // No status filter: see the header. A void and its reversal both count.
      ...(date ? { entry: { date } } : {}),
      ...(vertical ? { vertical } : {}),
    },
    _sum: { debitCents: true, creditCents: true },
  });
  if (grouped.length === 0) return [];

  const accounts = await prisma.ledgerAccount.findMany({
    where: { companyId, id: { in: grouped.map((g) => g.accountId) } },
    select: { id: true, number: true, name: true, type: true },
  });
  const byId = new Map(accounts.map((a) => [a.id, a]));

  return grouped
    .map((g): AccountBalance | null => {
      const account = byId.get(g.accountId);
      if (!account) return null;
      const debits = g._sum.debitCents ?? 0;
      const credits = g._sum.creditCents ?? 0;
      const balance =
        normalBalance(account.type) === "credit" ? credits - debits : debits - credits;
      return {
        accountId: account.id,
        number: account.number,
        name: account.name,
        type: account.type,
        balanceCents: balance,
        debitCents: debits,
        creditCents: credits,
      };
    })
    .filter((r): r is AccountBalance => r !== null)
    .sort((a, b) => a.number.localeCompare(b.number));
}

export type TrialBalance = {
  rows: AccountBalance[];
  totalDebitsCents: number;
  totalCreditsCents: number;
  /** True when the ledger itself balances. It is a bug if this is ever false. */
  balanced: boolean;
};

/**
 * The trial balance: every account, raw debits against raw credits.
 *
 * This is the one report that checks the LEDGER rather than describing it. The
 * posting service refuses an unbalanced entry, so the totals here can only
 * disagree if something wrote `journal_lines` without going through it — which
 * is precisely what this is for.
 */
export async function trialBalance(companyId: string, asOf?: Date): Promise<TrialBalance> {
  const rows = await accountBalances({
    companyId,
    period: { startMs: null, endMs: asOf ? asOf.getTime() : null },
  });
  const totalDebitsCents = rows.reduce((s, r) => s + r.debitCents, 0);
  const totalCreditsCents = rows.reduce((s, r) => s + r.creditCents, 0);
  return {
    rows,
    totalDebitsCents,
    totalCreditsCents,
    balanced: totalDebitsCents === totalCreditsCents,
  };
}

export type PnlSection = { rows: AccountBalance[]; totalCents: number };
export type ProfitAndLoss = {
  income: PnlSection;
  cogs: PnlSection;
  grossProfitCents: number;
  expenses: PnlSection;
  operatingIncomeCents: number;
  otherIncome: PnlSection;
  otherExpenses: PnlSection;
  netIncomeCents: number;
};

const section = (rows: AccountBalance[], types: LedgerAccountType[]): PnlSection => {
  const picked = rows.filter((r) => types.includes(r.type));
  return { rows: picked, totalCents: picked.reduce((s, r) => s + r.balanceCents, 0) };
};

export async function profitAndLoss(args: {
  companyId: string;
  period?: Period;
  vertical?: Vertical | null;
}): Promise<ProfitAndLoss> {
  const rows = (await accountBalances(args)).filter(
    (r) => statementOf(r.type) === "profit_and_loss"
  );

  const income = section(rows, ["income"]);
  const cogs = section(rows, ["cogs"]);
  const expenses = section(rows, ["expense"]);
  const otherIncome = section(rows, ["other_income"]);
  const otherExpenses = section(rows, ["other_expense"]);

  const grossProfitCents = income.totalCents - cogs.totalCents;
  const operatingIncomeCents = grossProfitCents - expenses.totalCents;
  const netIncomeCents = operatingIncomeCents + otherIncome.totalCents - otherExpenses.totalCents;

  return {
    income,
    cogs,
    grossProfitCents,
    expenses,
    operatingIncomeCents,
    otherIncome,
    otherExpenses,
    netIncomeCents,
  };
}

/** Both departments side by side, plus the consolidated column. */
export async function profitAndLossByVertical(args: {
  companyId: string;
  period?: Period;
  verticals: Vertical[];
}): Promise<{ combined: ProfitAndLoss; byVertical: { vertical: Vertical; pnl: ProfitAndLoss }[] }> {
  const [combined, ...each] = await Promise.all([
    profitAndLoss({ companyId: args.companyId, period: args.period }),
    ...args.verticals.map((v) =>
      profitAndLoss({ companyId: args.companyId, period: args.period, vertical: v })
    ),
  ]);
  return {
    combined,
    byVertical: args.verticals.map((vertical, i) => ({ vertical, pnl: each[i] })),
  };
}

export type BalanceSheet = {
  assets: PnlSection;
  liabilities: PnlSection;
  /** Equity as stored — owner contributions, draws, retained earnings. */
  equityAccounts: PnlSection;
  /** This fiscal year's profit, not yet closed into Retained Earnings. */
  netIncomeCents: number;
  totalAssetsCents: number;
  totalLiabilitiesCents: number;
  totalEquityCents: number;
  /** A = L + E. False is a bug, and the report says so rather than hiding it. */
  balanced: boolean;
};

export async function balanceSheet(args: {
  companyId: string;
  asOf: Date;
  vertical?: Vertical | null;
}): Promise<BalanceSheet> {
  const { companyId, asOf, vertical } = args;

  // A snapshot: everything on or before the date, with NO lower bound. That
  // split is standard accounting and it is why this is its own query rather
  // than a total of the P&L's.
  const [rows, pnl] = await Promise.all([
    accountBalances({ companyId, period: { startMs: null, endMs: asOf.getTime() }, vertical }),
    profitAndLoss({
      companyId,
      period: { startMs: fiscalYearStart(asOf).getTime(), endMs: asOf.getTime() },
      vertical,
    }),
  ]);

  const sheet = rows.filter((r) => statementOf(r.type) === "balance_sheet");
  const assets = section(sheet, ["asset"]);
  const liabilities = section(sheet, ["liability"]);
  const equityAccounts = section(sheet, ["equity"]);

  const totalAssetsCents = assets.totalCents;
  const totalLiabilitiesCents = liabilities.totalCents;
  const totalEquityCents = equityAccounts.totalCents + pnl.netIncomeCents;

  return {
    assets,
    liabilities,
    equityAccounts,
    netIncomeCents: pnl.netIncomeCents,
    totalAssetsCents,
    totalLiabilitiesCents,
    totalEquityCents,
    balanced: totalAssetsCents === totalLiabilitiesCents + totalEquityCents,
  };
}

export type GeneralLedgerRow = {
  entryId: string;
  date: string;
  memo: string | null;
  accountNumber: string;
  accountName: string;
  debitCents: number;
  creditCents: number;
  vertical: Vertical | null;
  projectId: string | null;
  vendorName: string | null;
  status: string;
  /** Running balance in the account's normal direction. */
  runningCents: number;
};

/**
 * The general ledger / account register: every line on one account, in order,
 * with a running balance. This is the drill-down behind every figure above.
 *
 * VOID entries appear here — that is the point of a ledger — and are MARKED so
 * the reader can see both the mistake and its reversal. They are also counted:
 * the running balance includes them, because the reversal immediately takes
 * them back out and skipping the original would leave the column short by the
 * amount of every correction ever made.
 */
export async function generalLedger(args: {
  companyId: string;
  accountId: string;
  period?: Period;
}): Promise<GeneralLedgerRow[]> {
  const date = range(args.period);
  const lines = await prisma.journalLine.findMany({
    where: {
      companyId: args.companyId,
      accountId: args.accountId,
      ...(date ? { entry: { date } } : {}),
    },
    /**
     * DETERMINISTIC, and the tiebreak is load-bearing.
     *
     * `position` orders lines WITHIN one entry, so on its own it cannot order
     * two entries sharing a date — and a reversal deliberately carries its
     * original's date, so a void and its correction always collide. Without
     * `createdAt` the register could return them either way round, which makes
     * the running-balance column mean nothing and lets the same report show
     * different rows on two page loads.
     */
    orderBy: [{ entry: { date: "asc" } }, { entry: { createdAt: "asc" } }, { position: "asc" }],
    select: {
      debitCents: true,
      creditCents: true,
      vertical: true,
      projectId: true,
      memo: true,
      entry: { select: { id: true, date: true, memo: true, status: true } },
      account: { select: { number: true, name: true, type: true } },
      vendor: { select: { name: true } },
    },
  });

  let running = 0;
  return lines.map((l) => {
    const credit = normalBalance(l.account.type) === "credit";
    running += credit ? l.creditCents - l.debitCents : l.debitCents - l.creditCents;
    return {
      entryId: l.entry.id,
      date: l.entry.date.toISOString(),
      memo: l.memo ?? l.entry.memo,
      accountNumber: l.account.number,
      accountName: l.account.name,
      debitCents: l.debitCents,
      creditCents: l.creditCents,
      vertical: l.vertical,
      projectId: l.projectId,
      vendorName: l.vendor?.name ?? null,
      status: l.entry.status,
      runningCents: running,
    };
  });
}
