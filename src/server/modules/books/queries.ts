import type { LedgerAccountType, LedgerAccountSubtype, Vertical } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { listBankAccounts, type BankAccountSummary } from "./bank-accounts";
import { trialBalance } from "./reports";
import { getPeriodLock } from "./posting";

/**
 * Everything the Books screen renders, in one round of queries.
 *
 * Deliberately NOT a page of journal lines: the ledger is unbounded and the
 * screen shows the newest entries with a drill-down. Every TOTAL on the page
 * comes from an aggregate over the whole ledger (`reports.ts`), never from the
 * list — that distinction is the entire subject of `pnl-truncation.itest.ts`,
 * where summing a capped page silently under-reported a whole year.
 */

export type ChartRow = {
  id: string;
  number: string;
  name: string;
  type: LedgerAccountType;
  subtype: LedgerAccountSubtype;
  active: boolean;
  /** Non-null means the code resolves this account by handle: protected. */
  systemKey: string | null;
  taxLine: string | null;
  balanceCents: number;
};

export type EntryRow = {
  id: string;
  date: string;
  memo: string | null;
  sourceType: string;
  status: string;
  totalCents: number;
  lineCount: number;
  lines: {
    accountNumber: string;
    accountName: string;
    debitCents: number;
    creditCents: number;
    vertical: Vertical | null;
  }[];
};

export type BooksOverview = {
  /** False before the chart of accounts has been created. */
  seeded: boolean;
  accounts: ChartRow[];
  bankAccounts: BankAccountSummary[];
  periodLockedThrough: string | null;
  trialBalance: { totalDebitsCents: number; totalCreditsCents: number; balanced: boolean };
  recentEntries: EntryRow[];
};

/** How many entries the register shows. Not a reporting limit — see above. */
export const ENTRY_PAGE = 50;

export async function getBooksOverview(companyId: string): Promise<BooksOverview> {
  const [accounts, banks, lockedThrough, tb, entries] = await Promise.all([
    prisma.ledgerAccount.findMany({
      where: { companyId },
      orderBy: { number: "asc" },
      select: {
        id: true, number: true, name: true, type: true, subtype: true,
        active: true, systemKey: true, taxLine: true,
      },
    }),
    listBankAccounts(companyId),
    getPeriodLock(companyId),
    trialBalance(companyId),
    prisma.journalEntry.findMany({
      where: { companyId },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: ENTRY_PAGE,
      select: {
        id: true, date: true, memo: true, sourceType: true, status: true,
        lines: {
          orderBy: { position: "asc" },
          select: {
            debitCents: true, creditCents: true, vertical: true,
            account: { select: { number: true, name: true } },
          },
        },
      },
    }),
  ]);

  const balanceByAccount = new Map(tb.rows.map((r) => [r.accountId, r.balanceCents]));

  return {
    seeded: accounts.length > 0,
    accounts: accounts.map((a) => ({
      id: a.id,
      number: a.number,
      name: a.name,
      type: a.type,
      subtype: a.subtype,
      active: a.active,
      systemKey: a.systemKey,
      taxLine: a.taxLine,
      balanceCents: balanceByAccount.get(a.id) ?? 0,
    })),
    bankAccounts: banks,
    periodLockedThrough: lockedThrough ? lockedThrough.toISOString() : null,
    trialBalance: {
      totalDebitsCents: tb.totalDebitsCents,
      totalCreditsCents: tb.totalCreditsCents,
      balanced: tb.balanced,
    },
    recentEntries: entries.map((e) => ({
      id: e.id,
      date: e.date.toISOString(),
      memo: e.memo,
      sourceType: e.sourceType,
      status: e.status,
      // An entry balances, so either side is "the amount". Debits by convention.
      totalCents: e.lines.reduce((s, l) => s + l.debitCents, 0),
      lineCount: e.lines.length,
      lines: e.lines.map((l) => ({
        accountNumber: l.account.number,
        accountName: l.account.name,
        debitCents: l.debitCents,
        creditCents: l.creditCents,
        vertical: l.vertical,
      })),
    })),
  };
}

/** The accounts a journal-entry form may post to: active, newest first by number. */
export async function postableAccounts(companyId: string) {
  return prisma.ledgerAccount.findMany({
    where: { companyId, active: true },
    orderBy: { number: "asc" },
    select: { id: true, number: true, name: true, type: true },
  });
}
