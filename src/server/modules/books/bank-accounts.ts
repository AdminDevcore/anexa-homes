import type { BankAccountKind, Vertical } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { postJournalEntry, type PostingActor } from "./posting";
import { systemAccountId } from "./chart";

/**
 * BANK AND CARD ACCOUNTS AS DATA.
 *
 * A bank account is a row sitting on top of exactly one LedgerAccount. Adding
 * the fourth bank, the second savings account or the fifth credit card is
 * adding a ROW — there is no enum branch, no migration and no code change.
 * That is a stated requirement of books-build.md and it is why `kind` and
 * `defaultVertical` are columns rather than switches in a posting routine.
 *
 * ── A CREDIT CARD IS A LIABILITY ────────────────────────────────────────────
 * Not a negative asset. Money owed on a card is a 2000-series balance, it
 * increases with a CREDIT, and paying it down is a TRANSFER from a bank account
 * to the card — never an expense. Booking a card payment as an expense is the
 * single most common way a contractor's books double-count: once when the
 * materials were bought on the card, again when the card was paid.
 *
 * ── THE OPENING BALANCE IS A REAL ENTRY ─────────────────────────────────────
 * It posts against Opening Balance Equity the moment it is set, so the
 * account's book balance is right from its first day and the balance sheet
 * still balances. Opening Balance Equity should drain to zero as each opening
 * figure is explained; a balance sitting there is the honest signal that one
 * never was.
 */

export type CreateBankAccountInput = {
  companyId: string;
  name: string;
  /** Which ledger account backs it. Omit to create one from `number`/`name`. */
  ledgerAccountId?: string;
  /** Used only when creating the backing ledger account. */
  number?: string;
  institution?: string | null;
  /** Last 4 only. The full number is never stored. */
  mask?: string | null;
  kind?: BankAccountKind;
  defaultVertical?: Vertical | null;
  openingBalanceCents?: number;
  openingBalanceDate?: Date | null;
  actor: PostingActor;
};

export type BankAccountResult =
  | { ok: true; bankAccountId: string; openingEntryId: string | null }
  | { ok: false; error: string };

/** A card is a liability; everything else is an asset. */
function ledgerShapeFor(kind: BankAccountKind) {
  return kind === "credit_card"
    ? { type: "liability" as const, subtype: "credit_card" as const }
    : { type: "asset" as const, subtype: "bank" as const };
}

/**
 * The next free number in a class, so a new account lands somewhere sensible
 * without anybody choosing. 1010, 1020, 1030… for banks; 2110, 2120… for cards.
 */
async function nextNumber(companyId: string, kind: BankAccountKind): Promise<string> {
  const base = kind === "credit_card" ? 2100 : 1000;
  const ceiling = base + 99;
  const used = await prisma.ledgerAccount.findMany({
    where: { companyId },
    select: { number: true },
  });
  const taken = new Set(used.map((a) => a.number));
  for (let n = base + 10; n <= ceiling; n += 10) {
    const candidate = String(n);
    if (!taken.has(candidate)) return candidate;
  }
  // Fall back to single steps before giving up on the block entirely.
  for (let n = base + 1; n <= ceiling; n += 1) {
    const candidate = String(n);
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error(`No free account number left in the ${base} block.`);
}

export async function createBankAccount(input: CreateBankAccountInput): Promise<BankAccountResult> {
  const { companyId, actor } = input;
  const name = input.name?.trim();
  if (!name) return { ok: false, error: "Give the account a name." };

  const kind = input.kind ?? "checking";
  const opening = input.openingBalanceCents ?? 0;
  if (!Number.isInteger(opening)) {
    return { ok: false, error: "The opening balance must be a whole number of cents." };
  }
  if (opening !== 0 && !input.openingBalanceDate) {
    return { ok: false, error: "An opening balance needs the date it was taken from." };
  }

  let ledgerAccountId = input.ledgerAccountId ?? null;
  if (ledgerAccountId) {
    const existing = await prisma.ledgerAccount.findFirst({
      where: { companyId, id: ledgerAccountId },
      select: { id: true, bankAccount: { select: { id: true } } },
    });
    if (!existing) return { ok: false, error: "No such ledger account on this company." };
    if (existing.bankAccount) {
      return { ok: false, error: "That ledger account already has a bank account on it." };
    }
  } else {
    const shape = ledgerShapeFor(kind);
    const number = input.number?.trim() || (await nextNumber(companyId, kind));
    const clash = await prisma.ledgerAccount.findFirst({
      where: { companyId, number },
      select: { id: true },
    });
    if (clash) return { ok: false, error: `Account number ${number} is already in use.` };

    const created = await prisma.ledgerAccount.create({
      data: {
        companyId,
        number,
        name,
        type: shape.type,
        subtype: shape.subtype,
        description:
          kind === "credit_card"
            ? "Company card. A LIABILITY: paying it down is a transfer, never an expense."
            : null,
      },
      select: { id: true },
    });
    ledgerAccountId = created.id;
  }

  const bank = await prisma.bankAccount.create({
    data: {
      companyId,
      ledgerAccountId,
      name,
      institution: input.institution ?? null,
      mask: input.mask ?? null,
      kind,
      defaultVertical: input.defaultVertical ?? null,
      openingBalanceCents: opening,
      openingBalanceDate: input.openingBalanceDate ?? null,
    },
    select: { id: true },
  });

  const openingEntryId = opening === 0
    ? null
    : await postOpeningBalance({
        companyId,
        bankAccountId: bank.id,
        ledgerAccountId,
        kind,
        amountCents: opening,
        date: input.openingBalanceDate!,
        defaultVertical: input.defaultVertical ?? null,
        actor,
      });

  if (openingEntryId && !openingEntryId.ok) {
    // The account exists but its opening balance did not post. Say so plainly
    // rather than reporting success — a bank account whose book balance starts
    // wrong is worse than one that is obviously incomplete.
    return { ok: false, error: openingEntryId.error };
  }

  return {
    ok: true,
    bankAccountId: bank.id,
    openingEntryId: openingEntryId && openingEntryId.ok ? openingEntryId.entryId : null,
  };
}

/**
 * Post the opening balance against Opening Balance Equity.
 *
 * Signs, stated once so no caller has to reason about them:
 *
 *   bank/savings, positive   debit  the account   credit Opening Balance Equity
 *   bank/savings, negative   credit the account   debit  Opening Balance Equity
 *   credit card,  positive   credit the card      debit  Opening Balance Equity
 *     (a positive card "balance" is money OWED, and a liability grows on the
 *      credit side — the one place a plain reading of the number misleads)
 */
async function postOpeningBalance(args: {
  companyId: string;
  bankAccountId: string;
  ledgerAccountId: string;
  kind: BankAccountKind;
  amountCents: number;
  date: Date;
  defaultVertical: Vertical | null;
  actor: PostingActor;
}): Promise<{ ok: true; entryId: string } | { ok: false; error: string }> {
  const obeId = await systemAccountId(args.companyId, "opening_balance_equity");
  if (!obeId) {
    return {
      ok: false,
      error: "This company has no Opening Balance Equity account yet — seed the chart of accounts first.",
    };
  }

  const magnitude = Math.abs(args.amountCents);
  const liability = args.kind === "credit_card";
  // Does the account's own balance go UP on the credit side?
  const accountTakesCredit = liability ? args.amountCents > 0 : args.amountCents < 0;

  const accountLine = accountTakesCredit
    ? { accountId: args.ledgerAccountId, creditCents: magnitude }
    : { accountId: args.ledgerAccountId, debitCents: magnitude };
  const equityLine = accountTakesCredit
    ? { accountId: obeId, debitCents: magnitude }
    : { accountId: obeId, creditCents: magnitude };

  const res = await postJournalEntry({
    companyId: args.companyId,
    date: args.date,
    memo: "Opening balance",
    sourceType: "opening_balance",
    // Keyed to the bank account, so an opening balance can never post twice.
    sourceId: `bank:${args.bankAccountId}`,
    actor: args.actor,
    lines: [
      { ...accountLine, vertical: args.defaultVertical },
      { ...equityLine, vertical: args.defaultVertical },
    ],
  });

  if (!res.ok) return res;
  return { ok: true, entryId: res.entryId };
}

export type BankAccountSummary = {
  id: string;
  name: string;
  institution: string | null;
  mask: string | null;
  kind: BankAccountKind;
  defaultVertical: Vertical | null;
  active: boolean;
  ledgerAccountId: string;
  accountNumber: string;
  openingBalanceCents: number;
  openingBalanceDate: string | null;
  /** The BOOK balance: every posted line on this account, all time. */
  bookBalanceCents: number;
};

/**
 * Every bank account with its book balance.
 *
 * The balance is computed in the DATABASE and excludes void entries, which is
 * the whole reason voiding writes a reversal rather than a flag: the reversal
 * cancels the original arithmetically, and excluding the void original as well
 * would subtract it twice.
 */
export async function listBankAccounts(companyId: string): Promise<BankAccountSummary[]> {
  const accounts = await prisma.bankAccount.findMany({
    where: { companyId },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: {
      id: true, name: true, institution: true, mask: true, kind: true,
      defaultVertical: true, active: true, ledgerAccountId: true,
      openingBalanceCents: true, openingBalanceDate: true,
      ledgerAccount: { select: { number: true, type: true } },
    },
  });
  if (accounts.length === 0) return [];

  const sums = await prisma.journalLine.groupBy({
    by: ["accountId"],
    where: {
      companyId,
      accountId: { in: accounts.map((a) => a.ledgerAccountId) },
      entry: { status: "posted" },
    },
    _sum: { debitCents: true, creditCents: true },
  });
  const byAccount = new Map(sums.map((s) => [s.accountId, s]));

  return accounts.map((a) => {
    const s = byAccount.get(a.ledgerAccountId);
    const debits = s?._sum.debitCents ?? 0;
    const credits = s?._sum.creditCents ?? 0;
    // An asset reads debits-minus-credits; a liability reads the other way, so
    // a card's balance is a positive number meaning "owed".
    const balance = a.ledgerAccount.type === "liability" ? credits - debits : debits - credits;
    return {
      id: a.id,
      name: a.name,
      institution: a.institution,
      mask: a.mask,
      kind: a.kind,
      defaultVertical: a.defaultVertical,
      active: a.active,
      ledgerAccountId: a.ledgerAccountId,
      accountNumber: a.ledgerAccount.number,
      openingBalanceCents: a.openingBalanceCents,
      openingBalanceDate: a.openingBalanceDate ? a.openingBalanceDate.toISOString() : null,
      bookBalanceCents: balance,
    };
  });
}

/**
 * Money moving between our OWN accounts. Never income, never an expense, and
 * its two sides must not be counted twice.
 *
 * Paying a credit card is this, not an expense: debit the card (reducing what
 * is owed), credit the bank.
 */
export async function postTransfer(args: {
  companyId: string;
  fromBankAccountId: string;
  toBankAccountId: string;
  amountCents: number;
  date: Date;
  memo?: string | null;
  sourceId?: string | null;
  actor: PostingActor;
}): Promise<{ ok: true; entryId: string } | { ok: false; error: string }> {
  if (args.fromBankAccountId === args.toBankAccountId) {
    return { ok: false, error: "A transfer needs two different accounts." };
  }
  if (!Number.isInteger(args.amountCents) || args.amountCents <= 0) {
    return { ok: false, error: "A transfer must be a positive whole number of cents." };
  }

  const accounts = await prisma.bankAccount.findMany({
    where: { companyId: args.companyId, id: { in: [args.fromBankAccountId, args.toBankAccountId] } },
    select: { id: true, ledgerAccountId: true, name: true, defaultVertical: true },
  });
  const from = accounts.find((a) => a.id === args.fromBankAccountId);
  const to = accounts.find((a) => a.id === args.toBankAccountId);
  if (!from || !to) return { ok: false, error: "One of those accounts does not exist." };

  const res = await postJournalEntry({
    companyId: args.companyId,
    date: args.date,
    memo: args.memo ?? `Transfer — ${from.name} to ${to.name}`,
    sourceType: "transfer",
    sourceId: args.sourceId ?? null,
    actor: args.actor,
    lines: [
      // Money arrives: the destination is debited if it is an asset, and a card
      // being PAID is also debited — its liability falls. Both are the same
      // direction, which is why one line serves.
      { accountId: to.ledgerAccountId, debitCents: args.amountCents, vertical: to.defaultVertical },
      { accountId: from.ledgerAccountId, creditCents: args.amountCents, vertical: from.defaultVertical },
    ],
  });
  if (!res.ok) return res;
  return { ok: true, entryId: res.entryId };
}
