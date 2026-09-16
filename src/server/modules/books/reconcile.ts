import { prisma } from "@/server/db/client";
import { normalBalance } from "./chart";
import type { PostingActor } from "./posting";

/**
 * BANK RECONCILIATION, PER BANK ACCOUNT.
 *
 * The question it answers is the only one that matters in bookkeeping: does
 * what we think we have match what the bank says we have? Everything else here
 * exists to make that answer durable.
 *
 * ── IT STARTS FROM THE OPENING BALANCE ──────────────────────────────────────
 * The beginning balance is not typed in and not remembered from last month's
 * form: it is the sum of every line ALREADY reconciled on this account. The
 * opening balance posted when the account was created is an ordinary entry, so
 * the first reconciliation starts from it like any other. That makes the chain
 * self-checking — if a prior month was undone, this month's beginning moves,
 * and it moves correctly.
 *
 * ── A RECONCILED LINE IS LOCKED ─────────────────────────────────────────────
 * Once cleared, a line cannot be voided or re-dated until the reconciliation it
 * settled in is undone. A reconciliation whose lines can still change is not
 * evidence of anything.
 *
 * ── UNDO IS LOGGED, NEVER DELETED ───────────────────────────────────────────
 * Undoing marks the row `undone` with who and why and releases its lines. The
 * row stays. "This month was reconciled and then un-reconciled" is precisely
 * the fact an auditor asks about, and deleting the record answers it with
 * silence.
 */

export type ReconcileCandidate = {
  lineId: string;
  entryId: string;
  date: string;
  memo: string | null;
  /** Signed in the account's normal direction: + increases the account. */
  amountCents: number;
  vendorName: string | null;
  status: string;
};

/** Signed movement of one line in its account's normal direction. */
function signed(
  type: Parameters<typeof normalBalance>[0],
  debitCents: number,
  creditCents: number
): number {
  return normalBalance(type) === "credit" ? creditCents - debitCents : debitCents - creditCents;
}

export type ReconcileView = {
  bankAccountId: string;
  bankAccountName: string;
  statementDate: string;
  /** Sum of everything already reconciled — where this statement starts. */
  beginningBalanceCents: number;
  /** Every posted line on this account, on or before the date, not yet cleared. */
  candidates: ReconcileCandidate[];
  /** The account's full book balance, cleared or not. */
  bookBalanceCents: number;
};

/**
 * Everything needed to reconcile one account to one statement date.
 *
 * Void entries and their reversals both appear as candidates. That is
 * deliberate: the bank shows a cheque and its reversal as two lines too, and a
 * reconciliation that silently omitted either could never be made to agree.
 */
export async function openReconciliation(args: {
  companyId: string;
  bankAccountId: string;
  statementDate: Date;
}): Promise<ReconcileView | null> {
  const bank = await prisma.bankAccount.findFirst({
    where: { id: args.bankAccountId, companyId: args.companyId },
    select: { id: true, name: true, ledgerAccountId: true, ledgerAccount: { select: { type: true } } },
  });
  if (!bank) return null;

  const type = bank.ledgerAccount.type;

  const [cleared, open, all] = await Promise.all([
    prisma.journalLine.aggregate({
      where: {
        companyId: args.companyId,
        accountId: bank.ledgerAccountId,
        reconciledAt: { not: null },
        bankReconciliation: { status: "completed" },
      },
      _sum: { debitCents: true, creditCents: true },
    }),
    prisma.journalLine.findMany({
      where: {
        companyId: args.companyId,
        accountId: bank.ledgerAccountId,
        reconciledAt: null,
        entry: { date: { lte: args.statementDate } },
      },
      orderBy: [{ entry: { date: "asc" } }, { entry: { createdAt: "asc" } }, { position: "asc" }],
      select: {
        id: true,
        debitCents: true,
        creditCents: true,
        memo: true,
        entry: { select: { id: true, date: true, memo: true, status: true } },
        vendor: { select: { name: true } },
      },
    }),
    prisma.journalLine.aggregate({
      where: { companyId: args.companyId, accountId: bank.ledgerAccountId },
      _sum: { debitCents: true, creditCents: true },
    }),
  ]);

  return {
    bankAccountId: bank.id,
    bankAccountName: bank.name,
    statementDate: args.statementDate.toISOString(),
    beginningBalanceCents: signed(type, cleared._sum.debitCents ?? 0, cleared._sum.creditCents ?? 0),
    bookBalanceCents: signed(type, all._sum.debitCents ?? 0, all._sum.creditCents ?? 0),
    candidates: open.map((l) => ({
      lineId: l.id,
      entryId: l.entry.id,
      date: l.entry.date.toISOString(),
      memo: l.memo ?? l.entry.memo,
      amountCents: signed(type, l.debitCents, l.creditCents),
      vendorName: l.vendor?.name ?? null,
      status: l.entry.status,
    })),
  };
}

export type CompleteResult =
  | { ok: true; reconciliationId: string; clearedCount: number }
  | { ok: false; error: string; differenceCents?: number };

/**
 * Finish a reconciliation.
 *
 * It REFUSES to close out of balance. That refusal is the entire value of the
 * feature: a reconciliation that can be forced through while the numbers
 * disagree records only that somebody clicked a button.
 */
export async function completeReconciliation(args: {
  companyId: string;
  bankAccountId: string;
  statementDate: Date;
  statementBalanceCents: number;
  lineIds: string[];
  actor: PostingActor;
}): Promise<CompleteResult> {
  if (!Number.isInteger(args.statementBalanceCents)) {
    return { ok: false, error: "The statement balance must be a whole number of cents." };
  }
  if (args.lineIds.length === 0) {
    return { ok: false, error: "Tick at least one line to clear." };
  }

  const bank = await prisma.bankAccount.findFirst({
    where: { id: args.bankAccountId, companyId: args.companyId },
    select: { id: true, ledgerAccountId: true, ledgerAccount: { select: { type: true } } },
  });
  if (!bank) return { ok: false, error: "No such bank account." };
  const type = bank.ledgerAccount.type;

  // Only lines that are on THIS account and not already cleared. Anything the
  // caller named that does not qualify is simply not there — the count check
  // below then reports it rather than silently clearing a subset.
  const lines = await prisma.journalLine.findMany({
    where: {
      id: { in: args.lineIds },
      companyId: args.companyId,
      accountId: bank.ledgerAccountId,
      reconciledAt: null,
    },
    select: { id: true, debitCents: true, creditCents: true },
  });
  if (lines.length !== args.lineIds.length) {
    return {
      ok: false,
      error:
        "Some of those lines are not on this account, or have already been cleared. Reopen the reconciliation and try again.",
    };
  }

  const prior = await prisma.journalLine.aggregate({
    where: {
      companyId: args.companyId,
      accountId: bank.ledgerAccountId,
      reconciledAt: { not: null },
      bankReconciliation: { status: "completed" },
    },
    _sum: { debitCents: true, creditCents: true },
  });
  const beginning = signed(type, prior._sum.debitCents ?? 0, prior._sum.creditCents ?? 0);
  const clearedSum = lines.reduce((s, l) => s + signed(type, l.debitCents, l.creditCents), 0);
  const difference = args.statementBalanceCents - (beginning + clearedSum);

  if (difference !== 0) {
    return {
      ok: false,
      // The number, not just the fact. "Out of balance" alone sends a
      // bookkeeper hunting through a screen of rows for a figure nobody told
      // them, which is how reconciliation gets abandoned.
      error: `Out of balance by ${difference} cents — cleared ${beginning + clearedSum}, statement says ${args.statementBalanceCents}.`,
      differenceCents: difference,
    };
  }

  const actorId = args.actor.kind === "user" ? args.actor.userId : null;
  const actorLabel = args.actor.kind === "user" ? args.actor.userId : `system:${args.actor.label}`;

  const reconciliation = await prisma.$transaction(async (tx) => {
    const created = await tx.bankReconciliation.create({
      data: {
        companyId: args.companyId,
        bankAccountId: bank.id,
        statementDate: args.statementDate,
        statementBalanceCents: args.statementBalanceCents,
        beginningBalanceCents: beginning,
        clearedCount: lines.length,
        status: "completed",
        createdById: actorId,
      },
      select: { id: true },
    });

    await tx.journalLine.updateMany({
      where: { id: { in: lines.map((l) => l.id) } },
      data: { reconciledAt: new Date(), bankReconciliationId: created.id },
    });

    await tx.financeAuditEvent.create({
      data: {
        companyId: args.companyId,
        actorId,
        actorLabel,
        action: "reconciliation.complete",
        entityType: "BankReconciliation",
        entityId: created.id,
        after: {
          bankAccountId: bank.id,
          statementDate: args.statementDate.toISOString(),
          statementBalanceCents: args.statementBalanceCents,
          beginningBalanceCents: beginning,
          clearedCount: lines.length,
        },
      },
    });

    return created;
  });

  return { ok: true, reconciliationId: reconciliation.id, clearedCount: lines.length };
}

/**
 * Undo a reconciliation: release its lines, keep the record.
 *
 * Only the MOST RECENT completed reconciliation on an account may be undone.
 * Undoing an older one would move the beginning balance of every reconciliation
 * after it, silently invalidating months that still read as agreed.
 */
export async function undoReconciliation(args: {
  companyId: string;
  reconciliationId: string;
  reason: string;
  actor: PostingActor;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const reason = args.reason?.trim();
  if (!reason) return { ok: false, error: "Say why this reconciliation is being undone." };

  const recon = await prisma.bankReconciliation.findFirst({
    where: { id: args.reconciliationId, companyId: args.companyId },
    select: { id: true, bankAccountId: true, status: true, statementDate: true, clearedCount: true },
  });
  if (!recon) return { ok: false, error: "Reconciliation not found." };
  if (recon.status !== "completed") return { ok: false, error: "That reconciliation is already undone." };

  const newer = await prisma.bankReconciliation.findFirst({
    where: {
      companyId: args.companyId,
      bankAccountId: recon.bankAccountId,
      status: "completed",
      statementDate: { gt: recon.statementDate },
    },
    select: { id: true, statementDate: true },
  });
  if (newer) {
    return {
      ok: false,
      error: `A later statement (${newer.statementDate.toISOString().slice(0, 10)}) is reconciled. Undo that one first.`,
    };
  }

  const actorId = args.actor.kind === "user" ? args.actor.userId : null;
  const actorLabel = args.actor.kind === "user" ? args.actor.userId : `system:${args.actor.label}`;

  await prisma.$transaction(async (tx) => {
    await tx.journalLine.updateMany({
      where: { bankReconciliationId: recon.id },
      data: { reconciledAt: null, bankReconciliationId: null },
    });
    await tx.bankReconciliation.update({
      where: { id: recon.id },
      data: { status: "undone", undoneAt: new Date(), undoneById: actorId, undoneReason: reason },
    });
    await tx.financeAuditEvent.create({
      data: {
        companyId: args.companyId,
        actorId,
        actorLabel,
        action: "reconciliation.undo",
        entityType: "BankReconciliation",
        entityId: recon.id,
        before: { status: "completed", clearedCount: recon.clearedCount },
        after: { status: "undone" },
        reason,
      },
    });
  });

  return { ok: true };
}

/** Is any line of this entry locked by a completed reconciliation? */
export async function entryIsReconciled(companyId: string, entryId: string): Promise<boolean> {
  const locked = await prisma.journalLine.count({
    where: {
      companyId,
      entryId,
      reconciledAt: { not: null },
      bankReconciliation: { status: "completed" },
    },
  });
  return locked > 0;
}

/** Past reconciliations on an account, newest first. */
export async function reconciliationHistory(companyId: string, bankAccountId: string) {
  return prisma.bankReconciliation.findMany({
    where: { companyId, bankAccountId },
    orderBy: { statementDate: "desc" },
    select: {
      id: true,
      statementDate: true,
      statementBalanceCents: true,
      beginningBalanceCents: true,
      clearedCount: true,
      status: true,
      undoneAt: true,
      undoneReason: true,
      createdAt: true,
    },
  });
}
