import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { connectBank, syncConnection } from "../sync";
import { FixtureBankFeedProvider } from "../providers/fixture";
import { ensureChartOfAccounts, systemAccountId } from "@/server/modules/books/chart";
import { postJournalEntry } from "@/server/modules/books/posting";
import type { SyncPage } from "../types";

/**
 * INGEST, AGAINST A REAL DATABASE.
 *
 * The properties pinned here are the ones whose failure is SILENT — each
 * produces books that balance perfectly and are wrong:
 *
 *   • the sign convention. Money in must stay money in. A flip books every
 *     expense as income and nothing throws.
 *   • dedupe by the provider's id, and ONLY by it. Two genuine purchases at the
 *     same shop for the same amount are two purchases; collapsing them loses
 *     real money from the books.
 *   • the cursor, persisted every page, so an interrupted sync resumes rather
 *     than re-ingesting two years.
 *   • a posted row is never rewritten under the entry made from it.
 *   • a retracted transaction is REVERSED, never deleted.
 *   • no opening balance on a connected account, or the feed's own history is
 *     counted twice.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";
process.env.BANK_FEED_PROVIDER = "fixture";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let ownerId: string;

const owner = () => ({ kind: "user" as const, userId: ownerId, role: "super_admin" as const });

beforeEach(async () => {
  const company = await db.company.create({
    data: { name: "Feed Co", slug: `feed-${process.pid}-${Date.now()}`, overheadPct: 0, paFeePct: 0 },
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
});

afterAll(async () => {
  await db.$disconnect();
});

async function connect() {
  const res = await connectBank({
    companyId,
    userId: ownerId,
    publicToken: "public-sandbox-token",
    actor: owner(),
  });
  if (!res.ok) throw new Error(`connect failed: ${res.error}`);
  return res;
}

const feedRows = () =>
  db.bankFeedTransaction.findMany({
    where: { companyId },
    orderBy: { providerTransactionId: "asc" },
  });

const rowById = async (providerTransactionId: string) =>
  db.bankFeedTransaction.findUniqueOrThrow({
    where: { companyId_providerTransactionId: { companyId, providerTransactionId } },
  });

describe("connectBank", () => {
  it("stores the credential ENCRYPTED and links the accounts", async () => {
    const res = await connect();
    expect(res.accountsLinked).toBe(2);

    const connection = await db.bankConnection.findUniqueOrThrow({ where: { id: res.connectionId } });
    // The access token the fixture handed back must not be sitting in the row.
    expect(connection.accessTokenEnc).not.toContain("access-fixture");
    expect(connection.accessTokenEnc).toMatch(/^v1\./);
    expect(connection.status).toBe("active");

    const accounts = await db.bankAccount.findMany({ where: { companyId }, orderBy: { name: "asc" } });
    expect(accounts.map((a) => a.providerAccountId).sort()).toEqual(["fix-card", "fix-checking"]);
    // A card is a liability, not another chequing account.
    expect(accounts.find((a) => a.providerAccountId === "fix-card")?.kind).toBe("credit_card");
  });

  it("books NO opening balance for a connected account", async () => {
    await connect();

    /**
     * The provider reports what the bank thinks TODAY, which already includes
     * every transaction the feed is about to deliver. Booking that as an opening
     * balance and then ingesting the history counts the same money twice.
     */
    const obe = await systemAccountId(companyId, "opening_balance_equity");
    const lines = await db.journalLine.count({ where: { companyId, accountId: obe ?? undefined } });
    expect(lines).toBe(0);

    const entries = await db.journalEntry.count({ where: { companyId } });
    expect(entries).toBe(0);
  });

  it("reconnecting REUSES the row and keeps the cursor", async () => {
    const first = await connect();
    await db.bankConnection.update({
      where: { id: first.connectionId },
      data: { cursor: "3", status: "needs_reconnect", needsReconnectAt: new Date() },
    });

    const second = await connect();

    // Same row — a second connection would start its own cursor and re-ingest
    // everything as though it were new.
    expect(second.connectionId).toBe(first.connectionId);
    expect(await db.bankConnection.count({ where: { companyId } })).toBe(1);

    const row = await db.bankConnection.findUniqueOrThrow({ where: { id: first.connectionId } });
    expect(row.cursor).toBe("3");
    expect(row.status).toBe("active");
    expect(row.needsReconnectAt).toBeNull();
  });
});

describe("syncConnection", () => {
  it("pages through the whole feed and keeps the sign convention", async () => {
    const { connectionId } = await connect();
    const res = await syncConnection({ companyId, connectionId, actor: owner() });

    expect(res.error).toBeUndefined();
    expect(res.hasMore).toBe(false);
    expect(await db.bankFeedTransaction.count({ where: { companyId } })).toBe(8);

    // MONEY OUT STAYS NEGATIVE, MONEY IN STAYS POSITIVE. A flip here would book
    // every expense as income while every entry still balanced.
    expect((await rowById("fx-001")).amountCents).toBe(-125_00);
    expect((await rowById("fx-002")).amountCents).toBe(8_400_00);

    // Nothing is posted by ingesting. The queue decides, not the feed.
    const all = await feedRows();
    expect(all.every((r) => r.status === "review")).toBe(true);
    expect(all.every((r) => r.journalEntryId === null)).toBe(true);
  });

  it("keeps two genuine purchases that look identical", async () => {
    const { connectionId } = await connect();
    await syncConnection({ companyId, connectionId, actor: owner() });

    // Same merchant, same amount, different days, DIFFERENT provider ids.
    // Deduping on anything but the provider's id would lose $125 of real spend.
    const a = await rowById("fx-001");
    const b = await rowById("fx-003");
    expect(a.amountCents).toBe(b.amountCents);
    expect(a.merchantName).toBe(b.merchantName);
    expect(a.id).not.toBe(b.id);
  });

  it("persists the cursor every page, so an interrupted sync resumes", async () => {
    const { connectionId } = await connect();

    const first = await syncConnection({ companyId, connectionId, actor: owner(), maxPages: 1 });
    expect(first.added).toBe(3);
    expect(first.hasMore).toBe(true);

    const mid = await db.bankConnection.findUniqueOrThrow({ where: { id: connectionId } });
    expect(mid.cursor).toBe("3");
    expect(await db.bankFeedTransaction.count({ where: { companyId } })).toBe(3);

    // Resuming picks up from the cursor rather than starting again.
    const rest = await syncConnection({ companyId, connectionId, actor: owner() });
    expect(rest.added).toBe(5);
    expect(await db.bankFeedTransaction.count({ where: { companyId } })).toBe(8);
  });

  it("is idempotent — a second full sync adds nothing", async () => {
    const { connectionId } = await connect();
    await syncConnection({ companyId, connectionId, actor: owner() });

    // Rewind the cursor so the provider replays everything it already sent,
    // which is exactly what an at-least-once feed does.
    await db.bankConnection.update({ where: { id: connectionId }, data: { cursor: null } });
    const again = await syncConnection({ companyId, connectionId, actor: owner() });

    expect(again.added).toBe(0);
    expect(await db.bankFeedTransaction.count({ where: { companyId } })).toBe(8);
  });

  it("settles a pending row instead of duplicating it", async () => {
    const { connectionId } = await connect();

    // fx-008 arrives pending on the last page and is reported settled in the
    // same page's modifications.
    const partial = await syncConnection({ companyId, connectionId, actor: owner(), maxPages: 2 });
    expect(partial.hasMore).toBe(true);

    await syncConnection({ companyId, connectionId, actor: owner() });
    const settled = await rowById("fx-008");
    expect(settled.pending).toBe(false);
    expect(await db.bankFeedTransaction.count({ where: { companyId } })).toBe(8);
  });

  it("does NOT rewrite a row that has already been posted", async () => {
    const { connectionId } = await connect();
    await syncConnection({ companyId, connectionId, actor: owner() });

    const row = await rowById("fx-001");
    const materials = await systemAccountId(companyId, "materials");
    const bank = await db.bankAccount.findFirstOrThrow({
      where: { companyId, providerAccountId: "fix-checking" },
      select: { ledgerAccountId: true },
    });
    const entry = await postJournalEntry({
      companyId,
      date: row.postedAt,
      memo: "Materials",
      sourceType: "bank_feed",
      sourceId: `feed:${row.id}`,
      actor: owner(),
      lines: [
        { accountId: materials!, debitCents: 125_00 },
        { accountId: bank.ledgerAccountId, creditCents: 125_00 },
      ],
    });
    if (!entry.ok) throw new Error(entry.error);
    await db.bankFeedTransaction.update({
      where: { id: row.id },
      data: { status: "posted", journalEntryId: entry.entryId },
    });

    /**
     * The provider replays a REVISED version of a transaction we have booked.
     *
     * A SUBCLASS, not a spread of an instance: spreading copies own properties
     * only, so the prototype's methods are left behind and the object satisfies
     * the interface by cast rather than in fact. That cast hid six missing
     * methods here, and it held up only because this test calls one of them.
     */
    class RevisingProvider extends FixtureBankFeedProvider {
      override async syncTransactions(): Promise<SyncPage> {
        return {
          added: [],
          modified: [
            {
              providerTransactionId: "fx-001",
              providerAccountId: "fix-checking",
              postedAt: row.postedAt,
              amountCents: -999_00, // a different amount entirely
              description: "REVISED DESCRIPTION",
              merchantName: "Somewhere Else",
              pending: false,
              category: [],
              checkNumber: null,
              currency: "USD",
            },
          ],
          removed: [],
          cursor: "done",
          hasMore: false,
        };
      }
    }

    await syncConnection({
      companyId,
      connectionId,
      actor: owner(),
      provider: new RevisingProvider(),
    });

    /**
     * The evidence under a posted entry is immutable. Rewriting it would leave
     * the books saying $125 and the bank row saying $999, with nothing recording
     * that they ever agreed.
     */
    const after = await rowById("fx-001");
    expect(after.amountCents).toBe(-125_00);
    expect(after.description).toBe("HOME DEPOT #4821");
  });

  it("REVERSES the entry when the bank retracts a transaction", async () => {
    const { connectionId } = await connect();
    await syncConnection({ companyId, connectionId, actor: owner() });

    const row = await rowById("fx-007");
    const labour = await systemAccountId(companyId, "subcontractor_labor");
    const bank = await db.bankAccount.findFirstOrThrow({
      where: { companyId, providerAccountId: "fix-checking" },
      select: { ledgerAccountId: true },
    });
    const entry = await postJournalEntry({
      companyId,
      date: row.postedAt,
      memo: "Subcontractor",
      sourceType: "bank_feed",
      sourceId: `feed:${row.id}`,
      actor: owner(),
      lines: [
        { accountId: labour!, debitCents: 2_500_00 },
        { accountId: bank.ledgerAccountId, creditCents: 2_500_00 },
      ],
    });
    if (!entry.ok) throw new Error(entry.error);
    await db.bankFeedTransaction.update({
      where: { id: row.id },
      data: { status: "posted", journalEntryId: entry.entryId },
    });

    class RetractingProvider extends FixtureBankFeedProvider {
      override async syncTransactions(): Promise<SyncPage> {
        return { added: [], modified: [], removed: ["fx-007"], cursor: "done", hasMore: false };
      }
    }

    const res = await syncConnection({
      companyId,
      connectionId,
      actor: owner(),
      provider: new RetractingProvider(),
    });
    expect(res.removed).toBe(1);

    const after = await rowById("fx-007");
    expect(after.status).toBe("removed");
    expect(after.removedAt).not.toBeNull();

    // VOIDED BY REVERSAL, NOT DELETED. Both entries survive and cancel.
    const original = await db.journalEntry.findUniqueOrThrow({ where: { id: entry.entryId } });
    expect(original.status).toBe("void");
    const reversal = await db.journalEntry.findFirst({ where: { companyId, reversesId: entry.entryId } });
    expect(reversal).not.toBeNull();

    // The account nets to nothing, which is the proof the reversal worked.
    const net = await db.journalLine.aggregate({
      where: { companyId, accountId: labour! },
      _sum: { debitCents: true, creditCents: true },
    });
    expect((net._sum.debitCents ?? 0) - (net._sum.creditCents ?? 0)).toBe(0);
  });

  it("marks the connection when its stored credential cannot be read", async () => {
    const { connectionId } = await connect();
    await db.bankConnection.update({
      where: { id: connectionId },
      data: { accessTokenEnc: "v1.fin:not:a:blob" },
    });

    const res = await syncConnection({ companyId, connectionId, actor: owner() });
    expect(res.error).toMatch(/could not be decrypted/i);

    const row = await db.bankConnection.findUniqueOrThrow({ where: { id: connectionId } });
    expect(row.status).toBe("error");
    // The failure is recorded without ever putting the blob in the message.
    expect(row.lastError).not.toContain("v1.fin");
  });
});
