import { prisma } from "@/server/db/client";
import { normalBalance, statementOf, systemAccountId } from "./chart";
import { postJournalEntry, voidJournalEntry, type PostingActor } from "./posting";
import { accountBalances, fiscalYearStart, type AccountBalance } from "./reports";

/**
 * THE YEAR-END CLOSE.
 *
 * Income and expense accounts measure ONE YEAR. At the end of it they are
 * emptied into Retained Earnings so the next year starts from zero, and the
 * profit that was earned stops being a current-year figure and becomes part of
 * what the owners have accumulated.
 *
 * Nothing about the company's worth changes when this runs. The balance sheet
 * already reports current-year net income as its own equity line precisely
 * because the accounts are not closed yet (see reports.ts) — so the close moves
 * a number from one equity line to another and the totals do not move. If
 * closing a year changes total equity, something is wrong.
 *
 * ── IT IS AN ENTRY, NOT A FLAG ──────────────────────────────────────────────
 * The close is a real balanced journal entry dated the last day of the year.
 * That matters: it can be inspected in the register, it appears in the general
 * ledger of every account it touched, and it is undone the same way anything
 * else is undone — by a reversal, never by deleting history. A boolean on the
 * company would have left the ledger and the "closed" state able to disagree.
 *
 * ── IDEMPOTENT ──────────────────────────────────────────────────────────────
 * Keyed by `sourceType = "year_end_close"` and `sourceId = "close:<year>"`, so
 * pressing the button twice is not two closes. This mirrors how payroll keys
 * its postings.
 */

export type CloseResult =
  | { ok: true; entryId: string; netIncomeCents: number; accountsClosed: number }
  | { ok: false; error: string };

const closeSourceId = (year: number) => `close:${year}`;

/** The close entry for a year, if it has already been posted and not voided. */
export async function existingClose(companyId: string, year: number) {
  return prisma.journalEntry.findFirst({
    where: {
      companyId,
      sourceType: "year_end_close",
      sourceId: closeSourceId(year),
      status: "posted",
    },
    select: { id: true, date: true, createdAt: true },
  });
}

/**
 * One line that empties an account, whichever side its balance happens to sit.
 *
 * `balanceCents` arrives signed in the account's NORMAL direction, so a
 * positive income balance means income was earned and a NEGATIVE one means the
 * account is contra for the year — a refund larger than the sales booked to it,
 * say. Both happen, and assuming the sign is the reason a naive close posts a
 * negative debit and is rejected by the posting service.
 */
function zeroingLine(row: AccountBalance): { accountId: string; debitCents: number; creditCents: number } {
  const credit = normalBalance(row.type) === "credit";
  const b = row.balanceCents;
  if (credit) {
    return b >= 0
      ? { accountId: row.accountId, debitCents: b, creditCents: 0 }
      : { accountId: row.accountId, debitCents: 0, creditCents: -b };
  }
  return b >= 0
    ? { accountId: row.accountId, debitCents: 0, creditCents: b }
    : { accountId: row.accountId, debitCents: -b, creditCents: 0 };
}

/**
 * Close a fiscal year into Retained Earnings.
 *
 * Owner-only, checked against the ACTOR rather than at the call site, so the
 * rule holds for a future cron or import exactly as it does for the button.
 */
export async function closeFiscalYear(args: {
  companyId: string;
  year: number;
  actor: PostingActor;
  lockOverrideReason?: string;
}): Promise<CloseResult> {
  const { companyId, year, actor } = args;

  if (actor.kind !== "user" || actor.role !== "super_admin") {
    return { ok: false, error: "Only the owner can close a year." };
  }

  const already = await existingClose(companyId, year);
  if (already) {
    return { ok: false, error: `${year} is already closed. Reopen it first to close it again.` };
  }

  const retainedEarningsId = await systemAccountId(companyId, "retained_earnings");
  if (!retainedEarningsId) {
    return { ok: false, error: "This company has no chart of accounts yet." };
  }

  const start = fiscalYearStart(new Date(Date.UTC(year, 0, 1)));
  const end = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));

  const rows = (
    await accountBalances({
      companyId,
      period: { startMs: start.getTime(), endMs: end.getTime() },
    })
  ).filter((r) => statementOf(r.type) === "profit_and_loss" && r.balanceCents !== 0);

  if (rows.length === 0) {
    return { ok: false, error: `Nothing to close: ${year} has no income or expense activity.` };
  }

  const lines = rows.map(zeroingLine);

  // The plug. Everything above nets to the year's profit, so Retained Earnings
  // takes the other side and the entry balances by construction rather than by
  // a second calculation that could disagree with the first.
  const debits = lines.reduce((s, l) => s + l.debitCents, 0);
  const credits = lines.reduce((s, l) => s + l.creditCents, 0);
  const netIncomeCents = debits - credits;

  lines.push(
    netIncomeCents >= 0
      ? { accountId: retainedEarningsId, debitCents: 0, creditCents: netIncomeCents }
      : { accountId: retainedEarningsId, debitCents: -netIncomeCents, creditCents: 0 }
  );

  const res = await postJournalEntry({
    companyId,
    date: end,
    memo: `Year-end close ${year}`,
    sourceType: "year_end_close",
    sourceId: closeSourceId(year),
    actor,
    lockOverrideReason: args.lockOverrideReason,
    lines: lines.map((l) => ({
      accountId: l.accountId,
      debitCents: l.debitCents,
      creditCents: l.creditCents,
      vertical: null,
      projectId: null,
      vendorId: null,
      // Untagged on purpose: a close is a company-level act. Tagging it to a
      // department would put a figure in one vertical's P&L that belongs to the
      // company as a whole.
      memo: `Close ${year}`,
    })),
  });

  if (!res.ok) return res;
  return { ok: true, entryId: res.entryId, netIncomeCents, accountsClosed: rows.length };
}

/**
 * Reopen a closed year by REVERSING the close, never by deleting it.
 *
 * The books then show both the close and its reversal, which is the honest
 * record: the year was closed on one date and reopened on another, and an
 * auditor can see both. Deleting would leave a year that had silently never
 * been closed.
 */
export async function reopenFiscalYear(args: {
  companyId: string;
  year: number;
  reason: string;
  actor: PostingActor;
}): Promise<{ ok: true; reversalId: string } | { ok: false; error: string }> {
  const { companyId, year, reason, actor } = args;

  if (actor.kind !== "user" || actor.role !== "super_admin") {
    return { ok: false, error: "Only the owner can reopen a year." };
  }
  if (!reason.trim()) {
    return { ok: false, error: "Say why the year is being reopened." };
  }

  const close = await existingClose(companyId, year);
  if (!close) return { ok: false, error: `${year} is not closed.` };

  const res = await voidJournalEntry({ companyId, entryId: close.id, reason, actor });
  if (!res.ok) return res;
  return { ok: true, reversalId: res.entryId };
}

/** Years with activity, newest first, each marked closed or open. */
export async function closableYears(
  companyId: string
): Promise<{ year: number; closed: boolean; closedOn: string | null }[]> {
  const [earliest, latest, closes] = await Promise.all([
    prisma.journalEntry.findFirst({ where: { companyId }, orderBy: { date: "asc" }, select: { date: true } }),
    prisma.journalEntry.findFirst({ where: { companyId }, orderBy: { date: "desc" }, select: { date: true } }),
    prisma.journalEntry.findMany({
      where: { companyId, sourceType: "year_end_close", status: "posted" },
      select: { sourceId: true, createdAt: true },
    }),
  ]);
  if (!earliest || !latest) return [];

  const closedBy = new Map(closes.map((c) => [c.sourceId, c.createdAt]));
  const from = earliest.date.getUTCFullYear();
  const to = latest.date.getUTCFullYear();

  const out: { year: number; closed: boolean; closedOn: string | null }[] = [];
  for (let y = to; y >= from; y--) {
    const on = closedBy.get(closeSourceId(y));
    out.push({ year: y, closed: Boolean(on), closedOn: on ? on.toISOString() : null });
  }
  return out;
}
