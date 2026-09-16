import type { Vertical } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { postJournalEntry, type PostingActor } from "@/server/modules/books/posting";

/**
 * THE REVIEW QUEUE: turning "money moved" into "this is what it was".
 *
 * A feed row is a fact about a bank account and nothing more. Deciding it is an
 * expense, a deposit against a deal, a transfer between our own accounts, or
 * not our business at all is a judgement, and this module is where that
 * judgement is recorded — always through `postJournalEntry`, never by writing
 * journal lines directly.
 *
 * ── THE SIGN RULE, ONCE ─────────────────────────────────────────────────────
 * `amountCents` on a feed row is signed from the account holder's view:
 *
 *     negative → money LEFT the bank  → CREDIT the bank, DEBIT the category
 *     positive → money ARRIVED        → DEBIT the bank,  CREDIT the category
 *
 * Every decision below derives its sides from that one rule rather than
 * restating it, because two copies of a sign convention are two chances to get
 * it backwards.
 *
 * ── WHAT IS REFUSED ─────────────────────────────────────────────────────────
 * A pending row cannot post: an authorisation may never settle, and booking one
 * puts money in the books that never moved. A row already posted or excluded
 * cannot be decided again — the second decision would either duplicate the
 * entry or silently orphan the first.
 */

export type DecisionResult =
  | { ok: true; entryId?: string }
  | { ok: false; error: string };

/** One side of a split: where the money goes, and how much of it. */
export type SplitLine = {
  accountId: string;
  /** Positive cents. The direction comes from the row, not from here. */
  amountCents: number;
  vertical?: Vertical | null;
  projectId?: string | null;
  vendorId?: string | null;
  memo?: string | null;
};

/** The source key, so a row can never post twice even across retries. */
const sourceIdFor = (feedTransactionId: string) => `feed:${feedTransactionId}`;

/**
 * A row that may be decided, with what the caller actually needs lifted out.
 *
 * TAGGED WITH `ok`, and the ledger account returned FLAT, for two reasons that
 * are really one. A union of bare object literals cannot be discriminated with
 * `"error" in loaded` — TypeScript infers optional `undefined` siblings, so both
 * members carry the key and the narrowing silently yields `string | undefined`.
 * And a `bankAccount` proven non-null inside this function goes back to being
 * nullable the moment it crosses the return, which pushes six `!` assertions
 * onto the call sites. Returning exactly what the caller needs, already proven,
 * removes both problems instead of suppressing them.
 */
type Decidable =
  | { ok: false; error: string }
  | {
      ok: true;
      row: {
        id: string;
        amountCents: number;
        postedAt: Date;
        description: string;
        merchantName: string | null;
        bankAccountId: string;
      };
      ledgerAccountId: string;
      defaultVertical: Vertical | null;
    };

async function loadDecidable(companyId: string, feedTransactionId: string): Promise<Decidable> {
  const row = await prisma.bankFeedTransaction.findFirst({
    where: { id: feedTransactionId, companyId },
    select: {
      id: true,
      status: true,
      pending: true,
      amountCents: true,
      postedAt: true,
      description: true,
      merchantName: true,
      bankAccountId: true,
      bankAccount: { select: { ledgerAccountId: true, defaultVertical: true } },
    },
  });
  if (!row) return { ok: false, error: "That transaction is not in the queue." };
  if (row.status !== "review") {
    return { ok: false, error: `This transaction has already been ${row.status}.` };
  }
  if (row.pending) {
    return {
      ok: false,
      error: "This transaction is still pending at the bank and cannot be posted yet.",
    };
  }
  if (!row.bankAccountId || !row.bankAccount) {
    return { ok: false, error: "Link this feed account to a bank account first." };
  }
  return {
    ok: true,
    row: {
      id: row.id,
      amountCents: row.amountCents,
      postedAt: row.postedAt,
      description: row.description,
      merchantName: row.merchantName,
      bankAccountId: row.bankAccountId,
    },
    ledgerAccountId: row.bankAccount.ledgerAccountId,
    defaultVertical: row.bankAccount.defaultVertical,
  };
}

/**
 * Accept a row into the books, split across one or more accounts.
 *
 * The split must account for the WHOLE amount. A split that does not add up is
 * refused rather than balanced with a plug line: the difference would land
 * somewhere nobody chose, and a plug is indistinguishable from a correct entry
 * once it is posted.
 */
export async function acceptFeedTransaction(args: {
  companyId: string;
  feedTransactionId: string;
  lines: SplitLine[];
  memo?: string | null;
  actor: PostingActor;
}): Promise<DecisionResult> {
  const loaded = await loadDecidable(args.companyId, args.feedTransactionId);
  if (!loaded.ok) return loaded;
  const { row, ledgerAccountId, defaultVertical } = loaded;

  if (args.lines.length === 0) return { ok: false, error: "Choose an account." };
  if (args.lines.some((l) => l.amountCents <= 0)) {
    return { ok: false, error: "Every split line must be a positive amount." };
  }

  const total = args.lines.reduce((s, l) => s + l.amountCents, 0);
  const magnitude = Math.abs(row.amountCents);
  if (total !== magnitude) {
    const difference = total - magnitude;
    return {
      ok: false,
      error: `The split comes to ${total} cents but the transaction is ${magnitude} cents — ${
        difference > 0 ? "over" : "under"
      } by ${Math.abs(difference)}.`,
    };
  }

  const moneyOut = row.amountCents < 0;
  const bankLine = moneyOut
    ? { accountId: ledgerAccountId, creditCents: magnitude }
    : { accountId: ledgerAccountId, debitCents: magnitude };

  const categoryLines = args.lines.map((l) => ({
    accountId: l.accountId,
    ...(moneyOut ? { debitCents: l.amountCents } : { creditCents: l.amountCents }),
    // The bank account's default department unless the line says otherwise, so
    // a solar operating account does not need tagging on every row.
    vertical: (l.vertical ?? defaultVertical ?? null) as Vertical | null,
    projectId: l.projectId ?? null,
    vendorId: l.vendorId ?? null,
    memo: l.memo ?? null,
  }));

  const res = await postJournalEntry({
    companyId: args.companyId,
    date: row.postedAt,
    memo: args.memo ?? row.merchantName ?? row.description,
    sourceType: "bank_feed",
    sourceId: sourceIdFor(row.id),
    actor: args.actor,
    lines: [bankLine, ...categoryLines],
  });
  if (!res.ok) return { ok: false, error: res.error };

  await prisma.bankFeedTransaction.update({
    where: { id: row.id },
    data: {
      status: "posted",
      journalEntryId: res.entryId,
      decidedAt: new Date(),
      decidedById: args.actor.kind === "user" ? args.actor.userId : null,
    },
  });

  return { ok: true, entryId: res.entryId };
}

/**
 * Link a row to an entry the books already contain.
 *
 * This is the case where we recorded the money BEFORE the bank did — a payroll
 * run, an invoice payment, a transfer already booked from the other side.
 * Posting again would double it, so matching records that the bank's version
 * and ours are the same event.
 */
export async function matchFeedTransaction(args: {
  companyId: string;
  feedTransactionId: string;
  journalEntryId: string;
  actor: PostingActor;
}): Promise<DecisionResult> {
  const loaded = await loadDecidable(args.companyId, args.feedTransactionId);
  if (!loaded.ok) return loaded;
  const { row, ledgerAccountId } = loaded;

  const entry = await prisma.journalEntry.findFirst({
    where: { id: args.journalEntryId, companyId: args.companyId },
    select: { id: true, status: true, lines: { select: { debitCents: true, creditCents: true, accountId: true } } },
  });
  if (!entry) return { ok: false, error: "That entry does not exist." };
  if (entry.status === "void") return { ok: false, error: "That entry has been voided." };

  /**
   * The entry must actually touch this bank account for the amount the bank
   * reported. Matching a row to an unrelated entry would mark the money
   * reconciled while the real entry stayed open — the error is invisible
   * precisely because both records look complete.
   */
  const magnitude = Math.abs(row.amountCents);
  const touches = entry.lines.some(
    (l) =>
      l.accountId === ledgerAccountId &&
      (l.debitCents === magnitude || l.creditCents === magnitude)
  );
  if (!touches) {
    return {
      ok: false,
      error: "That entry does not move this amount through this bank account.",
    };
  }

  await prisma.bankFeedTransaction.update({
    where: { id: row.id },
    data: {
      status: "matched",
      journalEntryId: entry.id,
      decidedAt: new Date(),
      decidedById: args.actor.kind === "user" ? args.actor.userId : null,
    },
  });
  return { ok: true, entryId: entry.id };
}

/**
 * Two rows, one movement: money leaving one of our accounts and arriving in
 * another.
 *
 * ONE entry, and both rows point at it. Accepting each side separately would
 * book an expense and an income for money that never left the business — the
 * classic way a transfer inflates both the P&L and the tax bill.
 */
export async function markAsTransfer(args: {
  companyId: string;
  outFeedTransactionId: string;
  inFeedTransactionId: string;
  actor: PostingActor;
}): Promise<DecisionResult> {
  const out = await loadDecidable(args.companyId, args.outFeedTransactionId);
  if (!out.ok) return out;
  const into = await loadDecidable(args.companyId, args.inFeedTransactionId);
  if (!into.ok) return into;

  if (out.row.id === into.row.id) {
    return { ok: false, error: "A transfer needs two different transactions." };
  }
  if (out.row.bankAccountId === into.row.bankAccountId) {
    return { ok: false, error: "A transfer has to move between two different accounts." };
  }
  if (out.row.amountCents >= 0 || into.row.amountCents <= 0) {
    return { ok: false, error: "Pick the money going out and the money coming in." };
  }
  const magnitude = Math.abs(out.row.amountCents);
  if (magnitude !== into.row.amountCents) {
    return { ok: false, error: "The two sides are different amounts." };
  }

  const res = await postJournalEntry({
    companyId: args.companyId,
    // The later of the two: the money is not in the receiving account until it
    // arrives, and dating it earlier would overstate that balance in between.
    date: out.row.postedAt > into.row.postedAt ? out.row.postedAt : into.row.postedAt,
    memo: "Transfer between accounts",
    sourceType: "transfer",
    sourceId: sourceIdFor(out.row.id),
    actor: args.actor,
    lines: [
      { accountId: into.ledgerAccountId, debitCents: magnitude },
      { accountId: out.ledgerAccountId, creditCents: magnitude },
    ],
  });
  if (!res.ok) return { ok: false, error: res.error };

  const decided = {
    status: "matched" as const,
    journalEntryId: res.entryId,
    decidedAt: new Date(),
    decidedById: args.actor.kind === "user" ? args.actor.userId : null,
  };
  await prisma.bankFeedTransaction.updateMany({
    where: { companyId: args.companyId, id: { in: [out.row.id, into.row.id] } },
    data: decided,
  });

  return { ok: true, entryId: res.entryId };
}

/**
 * Not our business: a personal charge on a mixed account, or a duplicate the
 * bank reported twice under different ids.
 *
 * Excluding writes NO entry. The row stays visible with its reason, because a
 * transaction that vanishes silently is indistinguishable from one that was
 * never delivered.
 */
export async function excludeFeedTransaction(args: {
  companyId: string;
  feedTransactionId: string;
  actor: PostingActor;
}): Promise<DecisionResult> {
  const loaded = await loadDecidable(args.companyId, args.feedTransactionId);
  if (!loaded.ok) return loaded;

  await prisma.bankFeedTransaction.update({
    where: { id: loaded.row.id },
    data: {
      status: "excluded",
      decidedAt: new Date(),
      decidedById: args.actor.kind === "user" ? args.actor.userId : null,
    },
  });
  return { ok: true };
}

/** Put a decided row back in the queue. Only possible while nothing was posted. */
export async function undoDecision(args: {
  companyId: string;
  feedTransactionId: string;
}): Promise<DecisionResult> {
  const row = await prisma.bankFeedTransaction.findFirst({
    where: { id: args.feedTransactionId, companyId: args.companyId },
    select: { id: true, status: true, journalEntryId: true },
  });
  if (!row) return { ok: false, error: "That transaction is not in the queue." };
  if (row.journalEntryId) {
    // Undoing would orphan a posted entry. Voiding it is a separate, audited
    // act — never a side effect of changing one's mind about a queue row.
    return { ok: false, error: "Void the journal entry first; it cannot be unposted from here." };
  }
  if (row.status === "review") return { ok: true };

  await prisma.bankFeedTransaction.update({
    where: { id: row.id },
    data: { status: "review", decidedAt: null, decidedById: null },
  });
  return { ok: true };
}

export type TransferSuggestion = {
  outId: string;
  inId: string;
  amountCents: number;
  daysApart: number;
};

/**
 * Find rows that look like two sides of one transfer.
 *
 * Deliberately a SUGGESTION and never automatic. Same amount, opposite signs,
 * different accounts and a few days apart also describes a genuine payment to a
 * supplier who happens to bank with us, and booking that as a transfer would
 * erase a real expense. A person confirms.
 */
export async function suggestTransferPairs(
  companyId: string,
  withinDays = 5
): Promise<TransferSuggestion[]> {
  const rows = await prisma.bankFeedTransaction.findMany({
    where: { companyId, status: "review", pending: false, bankAccountId: { not: null } },
    select: { id: true, amountCents: true, postedAt: true, bankAccountId: true },
    orderBy: { postedAt: "asc" },
  });

  const outs = rows.filter((r) => r.amountCents < 0);
  const ins = rows.filter((r) => r.amountCents > 0);
  const window = withinDays * 86_400_000;
  const used = new Set<string>();
  const suggestions: TransferSuggestion[] = [];

  for (const out of outs) {
    const match = ins.find(
      (i) =>
        !used.has(i.id) &&
        i.amountCents === Math.abs(out.amountCents) &&
        i.bankAccountId !== out.bankAccountId &&
        Math.abs(i.postedAt.getTime() - out.postedAt.getTime()) <= window
    );
    if (!match) continue;
    used.add(match.id);
    suggestions.push({
      outId: out.id,
      inId: match.id,
      amountCents: Math.abs(out.amountCents),
      daysApart: Math.round(Math.abs(match.postedAt.getTime() - out.postedAt.getTime()) / 86_400_000),
    });
  }

  return suggestions;
}
