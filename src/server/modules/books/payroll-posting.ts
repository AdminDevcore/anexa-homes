import { prisma } from "@/server/db/client";
import { postJournalEntry, type PostingActor } from "./posting";
import type { SystemAccountKey } from "./chart";

/**
 * PAYROLL AND CONTRACTOR PAY, POSTED AS DOUBLE ENTRY.
 *
 * Two events, not one — this is the decision books-build.md settles and it is
 * the whole reason the old single money-out row was not enough:
 *
 *   approved   expense (tagged deal + vertical)   →  a PAYABLE
 *   paid       the payable                        →  the bank account
 *
 * Between those two moments the company genuinely owes the money, and a balance
 * sheet that cannot show that is not a balance sheet. The old ledger wrote one
 * negative `Transaction` when a run was marked paid, so an approved-but-unpaid
 * commission existed nowhere in the books at all.
 *
 * ── THE DEDUP KEYS ARE KEPT VERBATIM ────────────────────────────────────────
 * `payroll:<runId>:item:<id>` and `payroll:<runId>:adj:<id>`, exactly as
 * `payroll/post-bookkeeping.ts` spells them. They become the journal entry's
 * (sourceType, sourceId), which is uniquely constrained, so re-posting a run
 * that died half way writes only the lines that are missing — and a run that
 * already posted under the OLD ledger keeps the same identity rather than
 * posting a second time under a new spelling.
 *
 * ── COMMISSION IS NOT A JOB COST; SUBCONTRACTOR LABOUR IS ───────────────────
 * Preserved from the ledger this replaces, where it was already right. A rep's
 * commission is paid OUT OF the job's profit, so costing it to the job makes
 * every deal look worse the better it was sold. A subcontractor's invoice is
 * what the job cost to build. Same run, same bank account, opposite treatment.
 */

/** Which expense account a line books to, and which payable it accrues into. */
type LineAccounts = { expense: SystemAccountKey; payable: SystemAccountKey };

const COMMISSION: LineAccounts = { expense: "commissions_expense", payable: "commissions_payable" };
const CONTRACTOR: LineAccounts = { expense: "subcontractor_labor", payable: "payroll_payable" };
const CHARGEBACK: LineAccounts = { expense: "commission_chargebacks", payable: "commissions_payable" };

export type PayrollPostResult = {
  posted: number;
  skipped: number;
  errors: { key: string; error: string }[];
};

/**
 * Accrue an APPROVED run: expense against a payable, one entry per line.
 *
 * Idempotent per line. A line whose entry already exists is counted as skipped
 * rather than failing the run — the lesson the per-line dedup already learned:
 * the old guard was "has this run posted anything? then stop", which is right
 * for a re-post and wrong for a post that died after three lines.
 */
export async function accruePayrollRun(
  companyId: string,
  runId: string,
  actor: PostingActor
): Promise<PayrollPostResult> {
  const source = `payroll:${runId}`;
  const result: PayrollPostResult = { posted: 0, skipped: 0, errors: [] };

  const run = await prisma.payrollRun.findFirst({
    where: { id: runId, companyId },
    include: {
      items: {
        include: {
          commission: { select: { projectId: true } },
          contractorPay: { select: { projectId: true } },
          user: { select: { id: true, firstName: true, lastName: true } },
        },
      },
      adjustments: { include: { user: { select: { id: true, firstName: true, lastName: true } } } },
    },
  });
  if (!run) return result;

  const date = run.paidAt ?? new Date();

  /** Resolve the vendor row for a person, so the line carries a real FK. */
  const vendorIdFor = async (name: string, userId: string): Promise<string | null> => {
    if (!name.trim()) return null;
    const existing = await prisma.bookkeepingVendor.findFirst({
      where: { companyId, OR: [{ userId }, { name }] },
      select: { id: true },
    });
    if (existing) return existing.id;
    const created = await prisma.bookkeepingVendor.create({
      data: { companyId, name, userId },
      select: { id: true },
    });
    return created.id;
  };

  const book = async (args: {
    key: string;
    memo: string;
    /** SIGNED. Positive is pay owed; negative is a deduction or recovery. */
    amountCents: number;
    accounts: LineAccounts;
    projectId: string | null;
    vendorId: string | null;
  }) => {
    if (args.amountCents === 0) {
      result.skipped += 1;
      return;
    }
    const magnitude = Math.abs(args.amountCents);
    const owed = args.amountCents > 0;

    // Owed:      debit expense, credit payable.
    // Deducted:  credit expense, debit payable — money that will NOT leave, so
    //            the expense and the liability both come back down.
    const res = await postJournalEntry({
      companyId,
      date,
      memo: args.memo,
      sourceType: "payroll",
      sourceId: args.key,
      actor,
      lines: owed
        ? [
            {
              systemKey: args.accounts.expense,
              debitCents: magnitude,
              projectId: args.projectId,
              vendorId: args.vendorId,
            },
            { systemKey: args.accounts.payable, creditCents: magnitude, vendorId: args.vendorId },
          ]
        : [
            { systemKey: args.accounts.payable, debitCents: magnitude, vendorId: args.vendorId },
            {
              systemKey: args.accounts.expense,
              creditCents: magnitude,
              projectId: args.projectId,
              vendorId: args.vendorId,
            },
          ],
    });

    if (!res.ok) {
      result.errors.push({ key: args.key, error: res.error });
      return;
    }
    if (res.duplicate) result.skipped += 1;
    else result.posted += 1;
  };

  for (const item of run.items) {
    const name = `${item.user.firstName} ${item.user.lastName}`.trim();
    const vendorId = await vendorIdFor(name, item.userId);
    const isContractor = !!item.contractorPayId;
    await book({
      key: `${source}:item:${item.id}`,
      memo: item.label,
      amountCents: item.amount,
      accounts: isContractor ? CONTRACTOR : COMMISSION,
      projectId: item.commission?.projectId ?? item.contractorPay?.projectId ?? null,
      vendorId,
    });
  }

  /**
   * And the manual money, which the ledger used to omit entirely.
   *
   * `PayrollAdjustment.amountCents` is already SIGNED — positive adds, negative
   * deducts — so it is passed straight through. A run carrying a $1,000
   * trenching deduction used to book the GROSS while the bank showed the net,
   * leaving the books overstating commission by $1,000 and the reconciliation
   * permanently unable to close.
   */
  for (const adj of run.adjustments) {
    const name = `${adj.user.firstName} ${adj.user.lastName}`.trim();
    const vendorId = await vendorIdFor(name, adj.userId);
    const isRecovery = adj.kind === "chargeback_recovery";
    const label = adj.kind === "bonus" ? "Bonus" : isRecovery ? "Chargeback recovery" : "Deduction";
    await book({
      key: `${source}:adj:${adj.id}`,
      memo: `${label} — ${adj.reason}`,
      amountCents: adj.amountCents,
      accounts: isRecovery ? CHARGEBACK : COMMISSION,
      projectId: adj.projectId,
      vendorId,
    });
  }

  return result;
}

/**
 * Settle a run: clear the payables and reduce the bank.
 *
 * ONE entry for the whole run, not one per person — a single transfer left the
 * account and the bank statement will show it as a single line. Matching that
 * shape is what makes the bank reconciliation possible at all.
 *
 * The payable side is split by which payable each line accrued into, so
 * Commissions Payable and Payroll Payable each come down by exactly what was
 * accrued into them.
 */
export async function payPayrollRun(args: {
  companyId: string;
  runId: string;
  bankAccountId: string;
  date: Date;
  actor: PostingActor;
}): Promise<{ ok: true; entryId: string; duplicate: boolean } | { ok: false; error: string }> {
  const { companyId, runId, bankAccountId, actor } = args;

  const bank = await prisma.bankAccount.findFirst({
    where: { id: bankAccountId, companyId },
    select: { ledgerAccountId: true, name: true },
  });
  if (!bank) return { ok: false, error: "No such bank account." };

  // What this run actually accrued, taken from the LEDGER rather than
  // recomputed from the run: if the two ever disagree, the ledger is what the
  // balance sheet shows, and paying a figure the books never accrued would
  // leave a payable balance that nothing explains.
  const accrued = await prisma.journalLine.groupBy({
    by: ["accountId"],
    where: {
      companyId,
      entry: { status: "posted", sourceType: "payroll", sourceId: { startsWith: `payroll:${runId}:` } },
      account: { systemKey: { in: ["commissions_payable", "payroll_payable"] } },
    },
    _sum: { debitCents: true, creditCents: true },
  });

  const lines: { accountId: string; debitCents: number }[] = [];
  let total = 0;
  for (const row of accrued) {
    // A payable's balance is credits minus debits. What is left owing is what
    // this payment clears.
    const owed = (row._sum.creditCents ?? 0) - (row._sum.debitCents ?? 0);
    if (owed <= 0) continue;
    lines.push({ accountId: row.accountId, debitCents: owed });
    total += owed;
  }

  if (total === 0) {
    return { ok: false, error: "This run has nothing outstanding to pay — accrue it first." };
  }

  const res = await postJournalEntry({
    companyId,
    date: args.date,
    memo: `Payroll paid — ${bank.name}`,
    sourceType: "payroll_payment",
    sourceId: `payroll:${runId}:payment`,
    actor,
    lines: [...lines, { accountId: bank.ledgerAccountId, creditCents: total }],
  });

  if (!res.ok) return res;
  return { ok: true, entryId: res.entryId, duplicate: res.duplicate };
}
