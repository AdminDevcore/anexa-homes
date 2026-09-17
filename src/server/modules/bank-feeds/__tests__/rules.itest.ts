import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { applyAutoPostRules, suggestionsForQueue } from "../rules";
import { ensureChartOfAccounts, systemAccountId } from "@/server/modules/books/chart";
import { createBankAccount } from "@/server/modules/books/bank-accounts";

/**
 * RULES AGAINST A REAL DATABASE.
 *
 * The unit test pins what a rule MATCHES. This pins what a rule DOES, which is
 * the part that writes to the books:
 *
 *   • a suggestion posts nothing, ever;
 *   • an auto-post writes one real entry and records that it fired;
 *   • a pending row is never posted by a rule, because it may never settle;
 *   • an auto-post that FAILS leaves the row in the queue — silently swallowing
 *     it would make an unhandled transaction look handled, which is worse than
 *     the failure.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let ownerId: string;
let bankAccountId: string;
let fuelAccountId: string;

const owner = () => ({ kind: "user" as const, userId: ownerId, role: "super_admin" as const });
const DAY = new Date("2026-06-15T12:00:00Z");

beforeEach(async () => {
  const company = await db.company.create({
    data: { name: "Rules Co", slug: `rules-${process.pid}-${Date.now()}`, overheadPct: 0, paFeePct: 0 },
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

  const bank = await createBankAccount({
    companyId, name: "Operating", institution: "Truist", mask: "4321",
    kind: "checking", defaultVertical: null, openingBalanceCents: 0,
    openingBalanceDate: null, actor: owner(),
  });
  if (!bank.ok) throw new Error(bank.error);
  bankAccountId = bank.bankAccountId;

  const fuel = await systemAccountId(companyId, "materials");
  if (!fuel) throw new Error("chart is missing materials");
  fuelAccountId = fuel;
});

afterAll(async () => {
  await db.$disconnect();
});

let seq = 0;
/**
 * `merchantName` is patchable, and that is not incidental.
 *
 * A rule matches against the description OR the merchant. An earlier version of
 * this helper pinned the merchant to "Shell" whatever description a test asked
 * for, so a row meant to match nothing still carried a matching merchant — and
 * the "no rule claims this" test failed against perfectly correct code. Both
 * fields have to be controllable or the fixture quietly contradicts the test.
 */
async function feedRow(
  patch: Partial<{
    amountCents: number;
    description: string;
    merchantName: string | null;
    pending: boolean;
  }> = {}
) {
  seq += 1;
  return db.bankFeedTransaction.create({
    data: {
      companyId,
      bankAccountId,
      providerTransactionId: `rl-${process.pid}-${Date.now()}-${seq}`,
      providerAccountId: "prov",
      postedAt: DAY,
      amountCents: patch.amountCents ?? -64_20,
      description: patch.description ?? "SHELL OIL 574",
      merchantName: patch.merchantName === undefined ? "Shell" : patch.merchantName,
      pending: patch.pending ?? false,
    },
    select: { id: true },
  });
}

async function makeRule(patch: Partial<{ autoPost: boolean; priority: number; accountId: string; matchText: string; name: string }> = {}) {
  return db.bankRule.create({
    data: {
      companyId,
      name: patch.name ?? "Fuel",
      matchText: patch.matchText ?? "shell",
      matchType: "contains",
      direction: "money_out",
      accountId: patch.accountId ?? fuelAccountId,
      autoPost: patch.autoPost ?? false,
      priority: patch.priority ?? 100,
    },
    select: { id: true },
  });
}

describe("suggestionsForQueue", () => {
  it("suggests without writing anything", async () => {
    const row = await feedRow();
    const rule = await makeRule({ autoPost: false });

    const suggestions = await suggestionsForQueue(companyId);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      feedTransactionId: row.id,
      ruleId: rule.id,
      accountId: fuelAccountId,
      autoPost: false,
    });

    // A suggestion is a suggestion. Nothing reached the books.
    expect(await db.journalEntry.count({ where: { companyId } })).toBe(0);
    const after = await db.bankFeedTransaction.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe("review");
  });

  it("says nothing about a row no rule claims", async () => {
    // Both fields must miss: a rule matches the description OR the merchant.
    await feedRow({ description: "TEXACO 12", merchantName: "Texaco" });
    await makeRule();
    expect(await suggestionsForQueue(companyId)).toHaveLength(0);
  });

  it("claims a row when only the MERCHANT matches", async () => {
    // The bank put nothing useful in the description, which is the ordinary
    // case on card transactions and the reason both fields are searched.
    await feedRow({ description: "POS PURCHASE 4821", merchantName: "Shell" });
    await makeRule();
    expect(await suggestionsForQueue(companyId)).toHaveLength(1);
  });
});

describe("applyAutoPostRules", () => {
  it("posts a claimed row and records that the rule fired", async () => {
    const row = await feedRow();
    const rule = await makeRule({ autoPost: true });

    const res = await applyAutoPostRules({ companyId, actor: owner() });
    expect(res.posted).toBe(1);
    expect(res.errors).toEqual([]);

    const after = await db.bankFeedTransaction.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe("posted");
    expect(after.journalEntryId).not.toBeNull();

    // Money out: the bank is credited, the category debited.
    const lines = await db.journalLine.findMany({
      where: { companyId, entryId: after.journalEntryId! },
      select: { accountId: true, debitCents: true, creditCents: true },
    });
    expect(lines).toContainEqual(
      expect.objectContaining({ accountId: fuelAccountId, debitCents: 64_20, creditCents: 0 })
    );

    // Counted, so a rule matching nothing — or everything — is visible.
    const counted = await db.bankRule.findUniqueOrThrow({ where: { id: rule.id } });
    expect(counted.timesApplied).toBe(1);
    expect(counted.lastAppliedAt).not.toBeNull();
  });

  it("leaves a SUGGEST-only rule's rows alone", async () => {
    const row = await feedRow();
    await makeRule({ autoPost: false });

    const res = await applyAutoPostRules({ companyId, actor: owner() });
    expect(res.posted).toBe(0);
    const after = await db.bankFeedTransaction.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe("review");
  });

  it("never posts a PENDING row", async () => {
    const row = await feedRow({ pending: true });
    await makeRule({ autoPost: true });

    const res = await applyAutoPostRules({ companyId, actor: owner() });
    expect(res.posted).toBe(0);

    // An authorisation may never settle; booking one puts money in the books
    // that never moved.
    const after = await db.bankFeedTransaction.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe("review");
    expect(await db.journalEntry.count({ where: { companyId } })).toBe(0);
  });

  it("applies the highest-priority rule when two claim the same row", async () => {
    await feedRow();
    const permits = await systemAccountId(companyId, "permits");
    const first = await makeRule({ autoPost: true, priority: 10, accountId: permits!, name: "Specific" });
    await makeRule({ autoPost: true, priority: 50, accountId: fuelAccountId, name: "General" });

    await applyAutoPostRules({ companyId, actor: owner() });

    const posted = await db.journalLine.findMany({
      where: { companyId, debitCents: { gt: 0 } },
      select: { accountId: true },
    });
    expect(posted).toHaveLength(1);
    expect(posted[0].accountId).toBe(permits);

    const winner = await db.bankRule.findUniqueOrThrow({ where: { id: first.id } });
    expect(winner.timesApplied).toBe(1);
  });

  it("leaves a row IN THE QUEUE when its rule cannot post", async () => {
    const row = await feedRow();

    // A rule pointing at another company's account. The ledger door refuses a
    // foreign account, which is exactly the failure this must survive.
    const other = await db.company.create({
      data: { name: "Other Co", slug: `other-r-${process.pid}-${Date.now()}`, overheadPct: 0, paFeePct: 0 },
    });
    await ensureChartOfAccounts(other.id);
    const foreignAccount = await systemAccountId(other.id, "materials");
    const rule = await makeRule({ autoPost: true, accountId: foreignAccount! });

    const res = await applyAutoPostRules({ companyId, actor: owner() });

    expect(res.posted).toBe(0);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].feedTransactionId).toBe(row.id);

    /**
     * The row is untouched. Marking it in any way would make an unhandled
     * transaction look handled, and the person would never come back to it.
     */
    const after = await db.bankFeedTransaction.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe("review");
    expect(after.journalEntryId).toBeNull();
    expect(await db.journalEntry.count({ where: { companyId } })).toBe(0);

    // A rule that failed did not fire.
    const counted = await db.bankRule.findUniqueOrThrow({ where: { id: rule.id } });
    expect(counted.timesApplied).toBe(0);
  });

  it("does not catch a refund from the same merchant", async () => {
    // money_out rule, money coming IN.
    await feedRow({ amountCents: 64_20 });
    await makeRule({ autoPost: true });

    const res = await applyAutoPostRules({ companyId, actor: owner() });
    expect(res.posted).toBe(0);
    expect(await db.journalEntry.count({ where: { companyId } })).toBe(0);
  });
});
