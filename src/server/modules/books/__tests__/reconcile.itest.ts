import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { postJournalEntry, voidJournalEntry } from "../posting";
import { ensureChartOfAccounts, systemAccountId } from "../chart";
import { createBankAccount } from "../bank-accounts";
import {
  openReconciliation,
  completeReconciliation,
  undoReconciliation,
  reconciliationHistory,
} from "../reconcile";

/**
 * DOES WHAT WE THINK WE HAVE MATCH WHAT THE BANK SAYS WE HAVE?
 *
 * The properties that make the answer durable:
 *
 *   • it REFUSES to close out of balance — a reconciliation that can be forced
 *     through records only that somebody clicked a button;
 *   • the beginning balance is DERIVED from what is already cleared, never
 *     typed in, so the chain of months is self-checking;
 *   • a cleared line is LOCKED against voiding;
 *   • undo is logged, never deleted, and only the most recent month may go.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let ownerId: string;
let bankAccountId: string;
let ledgerAccountId: string;
let revenueId: string;

const actor = () => ({ kind: "user" as const, userId: ownerId, role: "super_admin" as const });

const OPENED = new Date("2026-01-01T12:00:00Z");
const JAN_STATEMENT = new Date("2026-01-31T23:59:59Z");
const FEB_STATEMENT = new Date("2026-02-28T23:59:59Z");

beforeEach(async () => {
  const company = await db.company.create({
    data: { name: "Recon Co", slug: `rec-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` },
  });
  companyId = company.id;
  ownerId = (
    await db.user.create({
      data: {
        companyId, email: `o-${Date.now()}-${Math.random()}@t.local`, passwordHash: "x",
        firstName: "Ola", lastName: "Owner", role: "super_admin", verticals: ["roofing", "solar"],
      },
    })
  ).id;
  await ensureChartOfAccounts(companyId);
  revenueId = (await systemAccountId(companyId, "roofing_revenue"))!;

  const bank = await createBankAccount({
    companyId, name: "Truist Checking", openingBalanceCents: 1_000_00,
    openingBalanceDate: OPENED, defaultVertical: "roofing", actor: actor(),
  });
  if (!bank.ok) throw new Error("setup");
  bankAccountId = bank.bankAccountId;
  ledgerAccountId = (
    await db.bankAccount.findUniqueOrThrow({ where: { id: bankAccountId }, select: { ledgerAccountId: true } })
  ).ledgerAccountId;
});

afterAll(async () => {
  await db.$disconnect();
});

/** A deposit into the bank on a given date. */
async function deposit(cents: number, date: Date, memo = "Deposit") {
  const res = await postJournalEntry({
    companyId, date, memo, sourceType: "manual", actor: actor(),
    lines: [
      { accountId: ledgerAccountId, debitCents: cents, vertical: "roofing" },
      { accountId: revenueId, creditCents: cents, vertical: "roofing" },
    ],
  });
  if (!res.ok) throw new Error(res.error);
  return res.entryId;
}

describe("opening the reconciliation", () => {
  it("starts from the opening balance, which is an ordinary entry", async () => {
    const view = (await openReconciliation({ companyId, bankAccountId, statementDate: JAN_STATEMENT }))!;
    // Nothing cleared yet, so the beginning is zero and the opening balance is
    // simply the first line waiting to be ticked.
    expect(view.beginningBalanceCents).toBe(0);
    expect(view.candidates).toHaveLength(1);
    expect(view.candidates[0].amountCents).toBe(1_000_00);
    expect(view.bookBalanceCents).toBe(1_000_00);
  });

  it("offers only lines on or before the statement date", async () => {
    await deposit(500_00, new Date("2026-01-15T12:00:00Z"));
    await deposit(900_00, new Date("2026-02-15T12:00:00Z"));

    const jan = (await openReconciliation({ companyId, bankAccountId, statementDate: JAN_STATEMENT }))!;
    expect(jan.candidates).toHaveLength(2); // opening + January deposit
    // …but the book balance is the whole account, cleared or not.
    expect(jan.bookBalanceCents).toBe(2_400_00);
  });
});

describe("closing the statement", () => {
  it("REFUSES to close out of balance, and names the difference", async () => {
    const view = (await openReconciliation({ companyId, bankAccountId, statementDate: JAN_STATEMENT }))!;
    const res = await completeReconciliation({
      companyId, bankAccountId, statementDate: JAN_STATEMENT,
      statementBalanceCents: 999_00, // the bank says something else
      lineIds: view.candidates.map((c) => c.lineId),
      actor: actor(),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.differenceCents).toBe(999_00 - 1_000_00);
      expect(res.error).toContain("100"); // the actual gap, not just "out of balance"
    }
    // Nothing was cleared.
    expect(await db.journalLine.count({ where: { companyId, reconciledAt: { not: null } } })).toBe(0);
  });

  it("closes when it balances, and marks exactly those lines", async () => {
    const view = (await openReconciliation({ companyId, bankAccountId, statementDate: JAN_STATEMENT }))!;
    const res = await completeReconciliation({
      companyId, bankAccountId, statementDate: JAN_STATEMENT,
      statementBalanceCents: 1_000_00,
      lineIds: view.candidates.map((c) => c.lineId),
      actor: actor(),
    });
    expect(res).toMatchObject({ ok: true, clearedCount: 1 });

    const cleared = await db.journalLine.findMany({ where: { companyId, reconciledAt: { not: null } } });
    expect(cleared).toHaveLength(1);
    expect(cleared[0].bankReconciliationId).not.toBeNull();

    const audit = await db.financeAuditEvent.findFirstOrThrow({
      where: { companyId, action: "reconciliation.complete" },
    });
    expect(audit.actorId).toBe(ownerId);
  });

  it("derives the NEXT month's beginning from what is already cleared", async () => {
    const jan = (await openReconciliation({ companyId, bankAccountId, statementDate: JAN_STATEMENT }))!;
    await completeReconciliation({
      companyId, bankAccountId, statementDate: JAN_STATEMENT, statementBalanceCents: 1_000_00,
      lineIds: jan.candidates.map((c) => c.lineId), actor: actor(),
    });

    await deposit(250_00, new Date("2026-02-10T12:00:00Z"));
    const feb = (await openReconciliation({ companyId, bankAccountId, statementDate: FEB_STATEMENT }))!;

    // Not typed in, not remembered — summed from the cleared lines.
    expect(feb.beginningBalanceCents).toBe(1_000_00);
    expect(feb.candidates).toHaveLength(1); // only the new deposit
    expect(feb.candidates[0].amountCents).toBe(250_00);

    const res = await completeReconciliation({
      companyId, bankAccountId, statementDate: FEB_STATEMENT, statementBalanceCents: 1_250_00,
      lineIds: feb.candidates.map((c) => c.lineId), actor: actor(),
    });
    expect(res.ok).toBe(true);
  });

  it("refuses a line that is not on this account", async () => {
    const view = (await openReconciliation({ companyId, bankAccountId, statementDate: JAN_STATEMENT }))!;
    const revenueLine = await db.journalLine.findFirstOrThrow({
      where: { companyId, accountId: { not: ledgerAccountId } },
      select: { id: true },
    });
    const res = await completeReconciliation({
      companyId, bankAccountId, statementDate: JAN_STATEMENT, statementBalanceCents: 1_000_00,
      lineIds: [...view.candidates.map((c) => c.lineId), revenueLine.id], actor: actor(),
    });
    expect(res.ok).toBe(false);
  });

  it("refuses an empty selection", async () => {
    const res = await completeReconciliation({
      companyId, bankAccountId, statementDate: JAN_STATEMENT,
      statementBalanceCents: 0, lineIds: [], actor: actor(),
    });
    expect(res.ok).toBe(false);
  });
});

describe("a cleared line is locked", () => {
  it("refuses to void an entry that has been reconciled", async () => {
    const entryId = await deposit(500_00, new Date("2026-01-15T12:00:00Z"));
    const view = (await openReconciliation({ companyId, bankAccountId, statementDate: JAN_STATEMENT }))!;
    await completeReconciliation({
      companyId, bankAccountId, statementDate: JAN_STATEMENT, statementBalanceCents: 1_500_00,
      lineIds: view.candidates.map((c) => c.lineId), actor: actor(),
    });

    const res = await voidJournalEntry({ companyId, entryId, reason: "wrong deal", actor: actor() });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/reconcil/i);
    // Still posted, and still cleared.
    const entry = await db.journalEntry.findUniqueOrThrow({ where: { id: entryId } });
    expect(entry.status).toBe("posted");
  });

  it("allows the void again once the reconciliation is undone", async () => {
    const entryId = await deposit(500_00, new Date("2026-01-15T12:00:00Z"));
    const view = (await openReconciliation({ companyId, bankAccountId, statementDate: JAN_STATEMENT }))!;
    const done = await completeReconciliation({
      companyId, bankAccountId, statementDate: JAN_STATEMENT, statementBalanceCents: 1_500_00,
      lineIds: view.candidates.map((c) => c.lineId), actor: actor(),
    });
    if (!done.ok) throw new Error("setup");

    await undoReconciliation({
      companyId, reconciliationId: done.reconciliationId, reason: "wrong statement", actor: actor(),
    });
    const res = await voidJournalEntry({ companyId, entryId, reason: "wrong deal", actor: actor() });
    expect(res.ok).toBe(true);
  });
});

describe("undo is logged, never deleted", () => {
  async function closeJanuary() {
    const view = (await openReconciliation({ companyId, bankAccountId, statementDate: JAN_STATEMENT }))!;
    const res = await completeReconciliation({
      companyId, bankAccountId, statementDate: JAN_STATEMENT, statementBalanceCents: 1_000_00,
      lineIds: view.candidates.map((c) => c.lineId), actor: actor(),
    });
    if (!res.ok) throw new Error("setup");
    return res.reconciliationId;
  }

  it("releases the lines and KEEPS the record", async () => {
    const id = await closeJanuary();
    const res = await undoReconciliation({ companyId, reconciliationId: id, reason: "wrong statement", actor: actor() });
    expect(res.ok).toBe(true);

    // The row survives, marked, with who and why.
    const row = await db.bankReconciliation.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("undone");
    expect(row.undoneReason).toBe("wrong statement");
    expect(row.undoneById).toBe(ownerId);

    // The lines are free again.
    expect(await db.journalLine.count({ where: { companyId, reconciledAt: { not: null } } })).toBe(0);

    const history = await reconciliationHistory(companyId, bankAccountId);
    expect(history).toHaveLength(1);

    const audit = await db.financeAuditEvent.findFirstOrThrow({
      where: { companyId, action: "reconciliation.undo" },
    });
    expect(audit.reason).toBe("wrong statement");
  });

  it("demands a reason", async () => {
    const id = await closeJanuary();
    const res = await undoReconciliation({ companyId, reconciliationId: id, reason: "   ", actor: actor() });
    expect(res.ok).toBe(false);
  });

  it("refuses a second undo", async () => {
    const id = await closeJanuary();
    await undoReconciliation({ companyId, reconciliationId: id, reason: "once", actor: actor() });
    const again = await undoReconciliation({ companyId, reconciliationId: id, reason: "twice", actor: actor() });
    expect(again.ok).toBe(false);
  });

  it("refuses to undo a month with a later month still reconciled", async () => {
    const january = await closeJanuary();
    await deposit(250_00, new Date("2026-02-10T12:00:00Z"));
    const feb = (await openReconciliation({ companyId, bankAccountId, statementDate: FEB_STATEMENT }))!;
    await completeReconciliation({
      companyId, bankAccountId, statementDate: FEB_STATEMENT, statementBalanceCents: 1_250_00,
      lineIds: feb.candidates.map((c) => c.lineId), actor: actor(),
    });

    // Undoing January would move February's beginning balance underneath it.
    const res = await undoReconciliation({ companyId, reconciliationId: january, reason: "nope", actor: actor() });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/later statement/i);
  });
});
