import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { createBankAccount, listBankAccounts, postTransfer } from "../bank-accounts";
import { ensureChartOfAccounts, normalBalance } from "../chart";

/**
 * BANK AND CARD ACCOUNTS ARE DATA, AND A CARD IS A LIABILITY.
 *
 * The two properties worth a database to prove:
 *
 *   1. an opening balance is a REAL entry against Opening Balance Equity, with
 *      the signs right — and a credit card's "balance" is money OWED, which is
 *      the one figure a plain reading gets backwards;
 *   2. moving money between our own accounts is a TRANSFER, never income and
 *      never an expense. Paying a card is the case that matters: booked as an
 *      expense it double-counts every purchase already on that card.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let ownerId: string;
const owner = () => ({ kind: "user" as const, userId: ownerId, role: "super_admin" as const });

const OPENED = new Date("2026-01-01T12:00:00Z");

beforeEach(async () => {
  const company = await db.company.create({
    data: { name: "Bank Co", slug: `bank-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` },
  });
  companyId = company.id;
  ownerId = (
    await db.user.create({
      data: {
        companyId, email: `owner-${Date.now()}-${Math.random()}@t.local`, passwordHash: "x",
        firstName: "Ola", lastName: "Owner", role: "super_admin", verticals: ["roofing", "solar"],
      },
    })
  ).id;
  await ensureChartOfAccounts(companyId);
});

/**
 * NO CASCADE DELETE IN TEARDOWN, deliberately.
 *
 * Each test already gets its own company and every assertion is scoped to it,
 * so deleting it buys no isolation. What it did buy was a large cascading
 * delete — ~45 seeded ledger accounts and their lines — holding locks while
 * other suites take an AccessExclusiveLock to `TRUNCATE companies CASCADE`.
 * That deadlocked (Postgres 40P01) and failed suites that had nothing to do
 * with this one. The schema is disposable and globalSetup rebuilds it.
 */
afterAll(async () => {
  await db.$disconnect();
});

/**
 * The balance of one ledger account, read the way a statement reads it.
 *
 * It asks `normalBalance()` rather than deciding for itself. The first version
 * of this helper special-cased only `liability` as credit-normal and therefore
 * reported EQUITY inverted — Opening Balance Equity came back at -$1,250 on a
 * correctly posted $1,250 opening balance, and the test blamed the ledger for
 * the helper's mistake. One rule, one implementation.
 */
async function balanceOf(ledgerAccountId: string): Promise<number> {
  const account = await db.ledgerAccount.findUniqueOrThrow({
    where: { id: ledgerAccountId },
    select: { type: true },
  });
  const sum = await db.journalLine.aggregate({
    where: { accountId: ledgerAccountId, entry: { status: "posted" } },
    _sum: { debitCents: true, creditCents: true },
  });
  const debits = sum._sum.debitCents ?? 0;
  const credits = sum._sum.creditCents ?? 0;
  return normalBalance(account.type) === "credit" ? credits - debits : debits - credits;
}

async function obeBalance(): Promise<number> {
  const obe = await db.ledgerAccount.findFirstOrThrow({
    where: { companyId, systemKey: "opening_balance_equity" },
    select: { id: true },
  });
  return balanceOf(obe.id);
}

describe("adding an account is adding a row", () => {
  it("creates the backing ledger account and picks a free number", async () => {
    const res = await createBankAccount({
      companyId, name: "Truist Savings", kind: "savings", institution: "Truist", mask: "4321",
      defaultVertical: "roofing", actor: owner(),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const [account] = await listBankAccounts(companyId);
    expect(account.name).toBe("Truist Savings");
    expect(account.mask).toBe("4321");
    expect(account.accountNumber).toMatch(/^10\d\d$/); // somewhere in the 1000 block
  });

  it("takes any number of accounts without a code change", async () => {
    for (const n of ["Chase Checking", "Wells Savings", "Amex Card", "BOA Checking"]) {
      const res = await createBankAccount({
        companyId, name: n, kind: n.includes("Card") ? "credit_card" : "checking", actor: owner(),
      });
      expect(res.ok).toBe(true);
    }
    expect(await listBankAccounts(companyId)).toHaveLength(4);
  });

  it("books a CARD as a liability, not a negative asset", async () => {
    const res = await createBankAccount({ companyId, name: "Amex", kind: "credit_card", actor: owner() });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const [card] = await listBankAccounts(companyId);
    const ledger = await db.ledgerAccount.findUniqueOrThrow({ where: { id: card.ledgerAccountId } });
    expect(ledger.type).toBe("liability");
    expect(ledger.subtype).toBe("credit_card");
    expect(ledger.number).toMatch(/^21\d\d$/); // the 2100 block
  });

  it("refuses an opening balance with no date to hang it on", async () => {
    const res = await createBankAccount({
      companyId, name: "Truist", openingBalanceCents: 500_00, actor: owner(),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/date/i);
  });
});

describe("the opening balance is a real entry", () => {
  it("debits a bank account and credits Opening Balance Equity", async () => {
    const res = await createBankAccount({
      companyId, name: "Truist Checking", openingBalanceCents: 1_250_00,
      openingBalanceDate: OPENED, actor: owner(),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.openingEntryId).not.toBeNull();

    const [account] = await listBankAccounts(companyId);
    expect(account.bookBalanceCents).toBe(1_250_00);
    // The other side is equity, so the balance sheet still balances.
    expect(await obeBalance()).toBe(1_250_00);
  });

  it("reverses the signs for an overdrawn account", async () => {
    const res = await createBankAccount({
      companyId, name: "Overdrawn", openingBalanceCents: -300_00,
      openingBalanceDate: OPENED, actor: owner(),
    });
    expect(res.ok).toBe(true);
    const [account] = await listBankAccounts(companyId);
    expect(account.bookBalanceCents).toBe(-300_00);
    expect(await obeBalance()).toBe(-300_00);
  });

  it("treats a CARD's positive opening balance as money OWED", async () => {
    // The figure a plain reading gets backwards: $900 on a card is a $900
    // liability, so the card is CREDITED and equity is debited.
    const res = await createBankAccount({
      companyId, name: "Amex", kind: "credit_card", openingBalanceCents: 900_00,
      openingBalanceDate: OPENED, actor: owner(),
    });
    expect(res.ok).toBe(true);
    const [card] = await listBankAccounts(companyId);
    expect(card.bookBalanceCents).toBe(900_00); // owed, reported positive

    const lines = await db.journalLine.findMany({
      where: { companyId, accountId: card.ledgerAccountId },
    });
    expect(lines[0].creditCents).toBe(900_00);
    expect(lines[0].debitCents).toBe(0);
    expect(await obeBalance()).toBe(-900_00);
  });

  it("cannot post an opening balance twice — it is keyed to the account", async () => {
    const res = await createBankAccount({
      companyId, name: "Truist", openingBalanceCents: 100_00,
      openingBalanceDate: OPENED, actor: owner(),
    });
    if (!res.ok) throw new Error("setup");
    const entries = await db.journalEntry.count({
      where: { companyId, sourceType: "opening_balance" },
    });
    expect(entries).toBe(1);
  });

  it("posts nothing at all for a zero opening balance", async () => {
    const res = await createBankAccount({ companyId, name: "Fresh", actor: owner() });
    expect(res).toMatchObject({ ok: true, openingEntryId: null });
    expect(await db.journalEntry.count({ where: { companyId } })).toBe(0);
  });
});

describe("money between our own accounts is a transfer", () => {
  async function twoAccounts() {
    const a = await createBankAccount({
      companyId, name: "Truist Roofing", openingBalanceCents: 10_000_00,
      openingBalanceDate: OPENED, defaultVertical: "roofing", actor: owner(),
    });
    const b = await createBankAccount({
      companyId, name: "Truist Solar", openingBalanceCents: 2_000_00,
      openingBalanceDate: OPENED, defaultVertical: "solar", actor: owner(),
    });
    if (!a.ok || !b.ok) throw new Error("setup");
    return { fromId: a.bankAccountId, toId: b.bankAccountId };
  }

  it("moves the money and touches no income or expense account", async () => {
    const { fromId, toId } = await twoAccounts();
    const res = await postTransfer({
      companyId, fromBankAccountId: fromId, toBankAccountId: toId,
      amountCents: 1_500_00, date: new Date("2026-02-01T12:00:00Z"), actor: owner(),
    });
    expect(res.ok).toBe(true);

    const accounts = await listBankAccounts(companyId);
    const from = accounts.find((a) => a.id === fromId)!;
    const to = accounts.find((a) => a.id === toId)!;
    expect(from.bookBalanceCents).toBe(8_500_00);
    expect(to.bookBalanceCents).toBe(3_500_00);

    // NOTHING landed on the P&L. This is the property that stops a transfer
    // being counted as revenue in one account and a cost in the other.
    const pnlLines = await db.journalLine.findMany({
      where: {
        companyId,
        entry: { sourceType: "transfer" },
        account: { type: { in: ["income", "cogs", "expense", "other_income", "other_expense"] } },
      },
    });
    expect(pnlLines).toHaveLength(0);
  });

  it("pays a credit card down without inventing an expense", async () => {
    const bank = await createBankAccount({
      companyId, name: "Truist", openingBalanceCents: 5_000_00,
      openingBalanceDate: OPENED, actor: owner(),
    });
    const card = await createBankAccount({
      companyId, name: "Amex", kind: "credit_card", openingBalanceCents: 900_00,
      openingBalanceDate: OPENED, actor: owner(),
    });
    if (!bank.ok || !card.ok) throw new Error("setup");

    const res = await postTransfer({
      companyId, fromBankAccountId: bank.bankAccountId, toBankAccountId: card.bankAccountId,
      amountCents: 400_00, date: new Date("2026-02-10T12:00:00Z"), actor: owner(),
    });
    expect(res.ok).toBe(true);

    const accounts = await listBankAccounts(companyId);
    expect(accounts.find((a) => a.id === bank.bankAccountId)!.bookBalanceCents).toBe(4_600_00);
    // Owed falls from 900 to 500 — the card was DEBITED.
    expect(accounts.find((a) => a.id === card.bankAccountId)!.bookBalanceCents).toBe(500_00);
  });

  it("refuses a transfer to the same account, and a non-positive amount", async () => {
    const { fromId, toId } = await twoAccounts();
    const same = await postTransfer({
      companyId, fromBankAccountId: fromId, toBankAccountId: fromId,
      amountCents: 100, date: OPENED, actor: owner(),
    });
    expect(same.ok).toBe(false);

    for (const bad of [0, -100, 10.5]) {
      const res = await postTransfer({
        companyId, fromBankAccountId: fromId, toBankAccountId: toId,
        amountCents: bad, date: OPENED, actor: owner(),
      });
      expect(res.ok).toBe(false);
    }
  });
});
