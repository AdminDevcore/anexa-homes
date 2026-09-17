import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import {
  acceptFeedTransaction,
  matchFeedTransaction,
  markAsTransfer,
  excludeFeedTransaction,
  undoDecision,
  suggestTransferPairs,
} from "../review";
import { ensureChartOfAccounts, systemAccountId } from "@/server/modules/books/chart";
import { createBankAccount } from "@/server/modules/books/bank-accounts";
import { postJournalEntry } from "@/server/modules/books/posting";

/**
 * THE REVIEW QUEUE, where a bank fact becomes an accounting judgement.
 *
 * Each property below fails SILENTLY if it is wrong — the entry balances, the
 * queue empties, and the books are untrue:
 *
 *   • the sign rule, in both directions;
 *   • a split must account for the whole amount, with no plug line;
 *   • a pending authorisation cannot post;
 *   • a transfer is ONE entry, not an expense and an income;
 *   • matching refuses an entry that does not actually move that amount through
 *     that account;
 *   • excluding writes nothing;
 *   • a decision that produced an entry cannot be quietly undone.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let ownerId: string;
let checkingId: string;
let checkingLedgerId: string;
let cardId: string;
let cardLedgerId: string;

const owner = () => ({ kind: "user" as const, userId: ownerId, role: "super_admin" as const });
const DAY = new Date("2026-06-15T12:00:00Z");

beforeEach(async () => {
  const company = await db.company.create({
    data: { name: "Queue Co", slug: `queue-${process.pid}-${Date.now()}`, overheadPct: 0, paFeePct: 0 },
  });
  companyId = company.id;
  ownerId = (
    await db.user.create({
      data: {
        companyId,
        email: `owner-${process.pid}-${Date.now()}@t.local`,
        passwordHash: "x",
        firstName: "Ola",
        lastName: "Owner",
        role: "super_admin",
        verticals: ["roofing", "solar"],
      },
      select: { id: true },
    })
  ).id;
  await ensureChartOfAccounts(companyId);

  const checking = await createBankAccount({
    companyId, name: "Operating", institution: "Truist", mask: "4321",
    kind: "checking", defaultVertical: null, openingBalanceCents: 0,
    openingBalanceDate: null, actor: owner(),
  });
  if (!checking.ok) throw new Error(checking.error);
  checkingId = checking.bankAccountId;

  const card = await createBankAccount({
    companyId, name: "Company Card", institution: "Truist", mask: "9876",
    kind: "credit_card", defaultVertical: null, openingBalanceCents: 0,
    openingBalanceDate: null, actor: owner(),
  });
  if (!card.ok) throw new Error(card.error);
  cardId = card.bankAccountId;

  const ids = await db.bankAccount.findMany({
    where: { companyId },
    select: { id: true, ledgerAccountId: true },
  });
  checkingLedgerId = ids.find((a) => a.id === checkingId)!.ledgerAccountId;
  cardLedgerId = ids.find((a) => a.id === cardId)!.ledgerAccountId;
});

afterAll(async () => {
  await db.$disconnect();
});

let seq = 0;
async function feedRow(opts: {
  amountCents: number;
  bankAccountId?: string | null;
  pending?: boolean;
  postedAt?: Date;
  description?: string;
}) {
  seq += 1;
  return db.bankFeedTransaction.create({
    data: {
      companyId,
      bankAccountId: opts.bankAccountId === undefined ? checkingId : opts.bankAccountId,
      providerTransactionId: `rv-${process.pid}-${Date.now()}-${seq}`,
      providerAccountId: "prov-acct",
      postedAt: opts.postedAt ?? DAY,
      amountCents: opts.amountCents,
      description: opts.description ?? "TEST ROW",
      pending: opts.pending ?? false,
    },
    select: { id: true },
  });
}

const key = async (k: Parameters<typeof systemAccountId>[1]) => {
  const id = await systemAccountId(companyId, k);
  if (!id) throw new Error(`missing system account ${k}`);
  return id;
};

async function linesOf(entryId: string) {
  return db.journalLine.findMany({
    where: { entryId },
    select: { accountId: true, debitCents: true, creditCents: true, vertical: true },
    orderBy: { position: "asc" },
  });
}

describe("acceptFeedTransaction", () => {
  it("money OUT credits the bank and debits the category", async () => {
    const row = await feedRow({ amountCents: -125_00 });
    const materials = await key("materials");

    const res = await acceptFeedTransaction({
      companyId, feedTransactionId: row.id, actor: owner(),
      lines: [{ accountId: materials, amountCents: 125_00 }],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const lines = await linesOf(res.entryId!);
    expect(lines).toContainEqual(
      expect.objectContaining({ accountId: checkingLedgerId, creditCents: 125_00, debitCents: 0 })
    );
    expect(lines).toContainEqual(
      expect.objectContaining({ accountId: materials, debitCents: 125_00, creditCents: 0 })
    );

    const after = await db.bankFeedTransaction.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe("posted");
    expect(after.journalEntryId).toBe(res.entryId);
  });

  it("money IN debits the bank and credits the category", async () => {
    const row = await feedRow({ amountCents: 8_400_00 });
    const revenue = await key("solar_revenue");

    const res = await acceptFeedTransaction({
      companyId, feedTransactionId: row.id, actor: owner(),
      lines: [{ accountId: revenue, amountCents: 8_400_00, vertical: "solar" }],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const lines = await linesOf(res.entryId!);
    // THE OTHER DIRECTION. A sign flip would make this deposit an expense while
    // the entry still balanced perfectly.
    expect(lines).toContainEqual(
      expect.objectContaining({ accountId: checkingLedgerId, debitCents: 8_400_00, creditCents: 0 })
    );
    expect(lines).toContainEqual(
      expect.objectContaining({ accountId: revenue, creditCents: 8_400_00, vertical: "solar" })
    );
  });

  it("splits across several accounts", async () => {
    const row = await feedRow({ amountCents: -300_00 });
    const [materials, permits] = await Promise.all([key("materials"), key("permits")]);

    const res = await acceptFeedTransaction({
      companyId, feedTransactionId: row.id, actor: owner(),
      lines: [
        { accountId: materials, amountCents: 200_00 },
        { accountId: permits, amountCents: 100_00 },
      ],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(await linesOf(res.entryId!)).toHaveLength(3);
  });

  it("REFUSES a split that does not add up, rather than plugging it", async () => {
    const row = await feedRow({ amountCents: -300_00 });
    const materials = await key("materials");

    const short = await acceptFeedTransaction({
      companyId, feedTransactionId: row.id, actor: owner(),
      lines: [{ accountId: materials, amountCents: 250_00 }],
    });
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.error).toMatch(/under by 5000/);

    const over = await acceptFeedTransaction({
      companyId, feedTransactionId: row.id, actor: owner(),
      lines: [{ accountId: materials, amountCents: 350_00 }],
    });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error).toMatch(/over by 5000/);

    // Nothing was written by either refusal.
    expect(await db.journalEntry.count({ where: { companyId } })).toBe(0);
    const after = await db.bankFeedTransaction.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe("review");
  });

  it("refuses a PENDING row — an authorisation may never settle", async () => {
    const row = await feedRow({ amountCents: -64_20, pending: true });
    const materials = await key("materials");

    const res = await acceptFeedTransaction({
      companyId, feedTransactionId: row.id, actor: owner(),
      lines: [{ accountId: materials, amountCents: 64_20 }],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/pending/i);
    expect(await db.journalEntry.count({ where: { companyId } })).toBe(0);
  });

  it("refuses a row already decided, so it cannot post twice", async () => {
    const row = await feedRow({ amountCents: -125_00 });
    const materials = await key("materials");
    const first = await acceptFeedTransaction({
      companyId, feedTransactionId: row.id, actor: owner(),
      lines: [{ accountId: materials, amountCents: 125_00 }],
    });
    expect(first.ok).toBe(true);

    const second = await acceptFeedTransaction({
      companyId, feedTransactionId: row.id, actor: owner(),
      lines: [{ accountId: materials, amountCents: 125_00 }],
    });
    expect(second.ok).toBe(false);
    expect(await db.journalEntry.count({ where: { companyId } })).toBe(1);
  });

  it("refuses a row whose feed account nobody has mapped", async () => {
    const row = await feedRow({ amountCents: -125_00, bankAccountId: null });
    const materials = await key("materials");
    const res = await acceptFeedTransaction({
      companyId, feedTransactionId: row.id, actor: owner(),
      lines: [{ accountId: materials, amountCents: 125_00 }],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/link this feed account/i);
  });
});

describe("matchFeedTransaction", () => {
  it("links a row to an entry the books already had", async () => {
    const row = await feedRow({ amountCents: -2_500_00 });
    const labour = await key("subcontractor_labor");
    const entry = await postJournalEntry({
      companyId, date: DAY, memo: "Paid earlier", sourceType: "manual", sourceId: null,
      actor: owner(),
      lines: [
        { accountId: labour, debitCents: 2_500_00 },
        { accountId: checkingLedgerId, creditCents: 2_500_00 },
      ],
    });
    if (!entry.ok) throw new Error(entry.error);

    const res = await matchFeedTransaction({
      companyId, feedTransactionId: row.id, journalEntryId: entry.entryId, actor: owner(),
    });
    expect(res.ok).toBe(true);

    const after = await db.bankFeedTransaction.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe("matched");
    expect(after.journalEntryId).toBe(entry.entryId);
    // Matching posts nothing — the entry already existed.
    expect(await db.journalEntry.count({ where: { companyId } })).toBe(1);
  });

  it("refuses an entry that does not move that amount through that account", async () => {
    const row = await feedRow({ amountCents: -2_500_00 });
    const labour = await key("materials");
    // Right amount, WRONG bank account.
    const entry = await postJournalEntry({
      companyId, date: DAY, memo: "Card purchase", sourceType: "manual", sourceId: null,
      actor: owner(),
      lines: [
        { accountId: labour, debitCents: 2_500_00 },
        { accountId: cardLedgerId, creditCents: 2_500_00 },
      ],
    });
    if (!entry.ok) throw new Error(entry.error);

    const res = await matchFeedTransaction({
      companyId, feedTransactionId: row.id, journalEntryId: entry.entryId, actor: owner(),
    });
    /**
     * Left unchecked this marks the bank row settled while the real entry stays
     * open. Both records look complete, which is why nobody finds it until a
     * reconciliation refuses to balance months later.
     */
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/does not move this amount/i);
  });
});

describe("markAsTransfer", () => {
  it("books ONE entry and touches neither income nor expense", async () => {
    const out = await feedRow({ amountCents: -340_00, bankAccountId: checkingId });
    const into = await feedRow({ amountCents: 340_00, bankAccountId: cardId });

    const res = await markAsTransfer({
      companyId, outFeedTransactionId: out.id, inFeedTransactionId: into.id, actor: owner(),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(await db.journalEntry.count({ where: { companyId } })).toBe(1);
    const lines = await linesOf(res.entryId!);
    expect(lines).toHaveLength(2);
    expect(lines).toContainEqual(
      expect.objectContaining({ accountId: cardLedgerId, debitCents: 340_00 })
    );
    expect(lines).toContainEqual(
      expect.objectContaining({ accountId: checkingLedgerId, creditCents: 340_00 })
    );

    /**
     * THE POINT. Accepting each side separately would book an expense and an
     * income for money that never left the business, inflating both the P&L and
     * the tax bill.
     */
    const touched = await db.journalLine.findMany({
      where: { companyId, account: { type: { in: ["income", "expense", "cogs"] } } },
      select: { id: true },
    });
    expect(touched).toHaveLength(0);

    const rows = await db.bankFeedTransaction.findMany({ where: { companyId } });
    expect(rows.every((r) => r.status === "matched" && r.journalEntryId === res.entryId)).toBe(true);
  });

  it("refuses two sides that are not a transfer", async () => {
    const a = await feedRow({ amountCents: -340_00, bankAccountId: checkingId });
    const b = await feedRow({ amountCents: 200_00, bankAccountId: cardId });
    const sameAccount = await feedRow({ amountCents: 340_00, bankAccountId: checkingId });

    const mismatched = await markAsTransfer({
      companyId, outFeedTransactionId: a.id, inFeedTransactionId: b.id, actor: owner(),
    });
    expect(mismatched.ok).toBe(false);

    const same = await markAsTransfer({
      companyId, outFeedTransactionId: a.id, inFeedTransactionId: sameAccount.id, actor: owner(),
    });
    expect(same.ok).toBe(false);
    if (!same.ok) expect(same.error).toMatch(/two different accounts/i);

    expect(await db.journalEntry.count({ where: { companyId } })).toBe(0);
  });
});

describe("excluding and undoing", () => {
  it("excluding writes no entry and keeps the row visible", async () => {
    const row = await feedRow({ amountCents: -64_20 });
    const res = await excludeFeedTransaction({
      companyId, feedTransactionId: row.id, actor: owner(),
    });
    expect(res.ok).toBe(true);

    const after = await db.bankFeedTransaction.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe("excluded");
    expect(after.journalEntryId).toBeNull();
    expect(await db.journalEntry.count({ where: { companyId } })).toBe(0);
  });

  it("an excluded row can go back in the queue", async () => {
    const row = await feedRow({ amountCents: -64_20 });
    await excludeFeedTransaction({ companyId, feedTransactionId: row.id, actor: owner() });
    expect(await undoDecision({ companyId, feedTransactionId: row.id })).toEqual({ ok: true });

    const after = await db.bankFeedTransaction.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe("review");
    expect(after.decidedAt).toBeNull();
  });

  it("a POSTED row cannot be quietly undone", async () => {
    const row = await feedRow({ amountCents: -125_00 });
    const materials = await key("materials");
    await acceptFeedTransaction({
      companyId, feedTransactionId: row.id, actor: owner(),
      lines: [{ accountId: materials, amountCents: 125_00 }],
    });

    // Undoing would orphan a posted entry. Voiding is a separate audited act,
    // never a side effect of changing one's mind about a queue row.
    const res = await undoDecision({ companyId, feedTransactionId: row.id });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/void the journal entry first/i);
  });
});

describe("suggestTransferPairs", () => {
  it("pairs opposite sides across accounts, and only suggests", async () => {
    const out = await feedRow({ amountCents: -340_00, bankAccountId: checkingId, postedAt: DAY });
    const into = await feedRow({
      amountCents: 340_00,
      bankAccountId: cardId,
      postedAt: new Date(DAY.getTime() + 86_400_000),
    });

    const suggestions = await suggestTransferPairs(companyId);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({ outId: out.id, inId: into.id, amountCents: 340_00, daysApart: 1 });

    // A suggestion changes nothing on its own — a person confirms, because the
    // same shape describes a real payment to a supplier who banks with us.
    const rows = await db.bankFeedTransaction.findMany({ where: { companyId } });
    expect(rows.every((r) => r.status === "review")).toBe(true);
    expect(await db.journalEntry.count({ where: { companyId } })).toBe(0);
  });

  it("does not pair two rows on the same account, or outside the window", async () => {
    await feedRow({ amountCents: -340_00, bankAccountId: checkingId, postedAt: DAY });
    await feedRow({ amountCents: 340_00, bankAccountId: checkingId, postedAt: DAY });
    await feedRow({
      amountCents: 500_00,
      bankAccountId: cardId,
      postedAt: new Date(DAY.getTime() + 40 * 86_400_000),
    });
    await feedRow({ amountCents: -500_00, bankAccountId: checkingId, postedAt: DAY });

    expect(await suggestTransferPairs(companyId)).toHaveLength(0);
  });
});
