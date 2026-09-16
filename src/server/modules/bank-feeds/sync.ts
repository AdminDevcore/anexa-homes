import type { BankAccountKind } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { encryptField, decryptField } from "@/server/lib/crypto";
import { voidJournalEntry, type PostingActor } from "@/server/modules/books/posting";
import { createBankAccount } from "@/server/modules/books/bank-accounts";
import { bankFeedProvider, configuredProviderId } from "./index";
import type { BankFeedProvider, ProviderAccountKind, ProviderTransaction } from "./types";

/**
 * INGEST: the bank's version of events, brought in and kept raw.
 *
 * Nothing here posts to the journal. A feed row lands in the review queue and
 * stays there until a person or a rule decides what it is. That separation is
 * the point: the bank knows what moved, it does not know what it MEANT, and a
 * system that guesses produces books whose errors are invisible because every
 * entry balances.
 *
 * ── WHAT MAKES THIS SAFE TO RE-RUN ──────────────────────────────────────────
 * Every write is keyed. Transactions dedupe on
 * `(companyId, providerTransactionId)`; the cursor is persisted after EVERY
 * page. So a sync killed by a timeout, a deploy or a crash resumes from where
 * it stopped rather than re-ingesting two years of history — and re-ingesting
 * would not corrupt anything either, because the upsert would recognise every
 * row it had already seen.
 */

const CENTS = 100;

/** Vercel's function ceiling is 60s. A page is a network round trip, so the
 * loop takes a bounded bite and tells the caller whether more is waiting. */
const MAX_PAGES_PER_RUN = 12;

export type SyncResult = {
  connectionId: string;
  added: number;
  modified: number;
  removed: number;
  /** True when the provider still has pages. The cron picks it up next run. */
  hasMore: boolean;
  error?: string;
};

function toBankAccountKind(kind: ProviderAccountKind): BankAccountKind {
  // "other" has no honest home, and a savings account is closer to checking
  // than to a credit card. Anything we cannot classify is treated as an asset
  // account rather than silently becoming a liability.
  return kind === "credit_card" ? "credit_card" : kind === "savings" ? "savings" : "checking";
}

/**
 * Connect an institution and map its accounts.
 *
 * The access token is encrypted with FINANCE_ENC_KEY before it touches the
 * database and is never returned, logged, or sent to the browser.
 */
export async function connectBank(args: {
  companyId: string;
  userId: string;
  publicToken: string;
  actor: PostingActor;
}): Promise<{ ok: true; connectionId: string; accountsLinked: number } | { ok: false; error: string }> {
  const provider = await bankFeedProvider();

  let exchanged;
  try {
    exchanged = await provider.exchangePublicToken(args.publicToken);
  } catch (err) {
    console.error("[bank-feeds] token exchange failed", err);
    return { ok: false, error: "Could not complete the bank connection." };
  }

  /**
   * RECONNECTING REUSES THE ROW. A second connection to the same institution
   * would start its own cursor and re-ingest everything as if it were new, and
   * the two would then both deliver the same transactions under different
   * connection ids.
   */
  const connection = await prisma.bankConnection.upsert({
    where: {
      companyId_provider_providerItemId: {
        companyId: args.companyId,
        provider: configuredProviderId(),
        providerItemId: exchanged.providerItemId,
      },
    },
    create: {
      companyId: args.companyId,
      provider: configuredProviderId(),
      providerItemId: exchanged.providerItemId,
      institutionId: exchanged.institutionId,
      institutionName: exchanged.institutionName,
      accessTokenEnc: encryptField(exchanged.accessToken),
      status: "active",
      createdById: args.actor.kind === "user" ? args.actor.userId : null,
    },
    update: {
      // A repaired credential replaces the old one; the cursor is deliberately
      // left alone so history is not re-fetched.
      accessTokenEnc: encryptField(exchanged.accessToken),
      status: "active",
      needsReconnectAt: null,
      lastError: null,
    },
    select: { id: true },
  });

  let accountsLinked = 0;
  try {
    const accounts = await provider.listAccounts(exchanged.accessToken);
    for (const a of accounts) {
      const existing = await prisma.bankAccount.findFirst({
        where: { companyId: args.companyId, providerAccountId: a.providerAccountId },
        select: { id: true },
      });
      if (existing) {
        await prisma.bankAccount.update({
          where: { id: existing.id },
          data: { bankConnectionId: connection.id },
        });
        accountsLinked += 1;
        continue;
      }

      /**
       * A new account gets a real ledger account behind it, through the same
       * door a hand-made one uses — so a connected account and a typed one are
       * the same kind of thing from the books' point of view.
       *
       * NO OPENING BALANCE. The provider's current balance is what the bank
       * thinks TODAY, which includes everything the feed is about to deliver.
       * Booking it as an opening balance and then ingesting the history would
       * count the same money twice.
       */
      const created = await createBankAccount({
        companyId: args.companyId,
        name: a.name,
        institution: exchanged.institutionName,
        mask: a.mask,
        kind: toBankAccountKind(a.kind),
        defaultVertical: null,
        openingBalanceCents: 0,
        openingBalanceDate: null,
        actor: args.actor,
      });
      if (!created.ok) {
        console.error(`[bank-feeds] could not create account "${a.name}": ${created.error}`);
        continue;
      }
      await prisma.bankAccount.update({
        where: { id: created.bankAccountId },
        data: { bankConnectionId: connection.id, providerAccountId: a.providerAccountId },
      });
      accountsLinked += 1;
    }
  } catch (err) {
    console.error("[bank-feeds] account mapping failed", err);
    // The connection itself is good; accounts can be mapped on the next sync.
  }

  return { ok: true, connectionId: connection.id, accountsLinked };
}

/** Resolve which of our bank accounts a feed row belongs to, if any. */
async function accountIndex(companyId: string, connectionId: string) {
  const rows = await prisma.bankAccount.findMany({
    where: { companyId, bankConnectionId: connectionId, providerAccountId: { not: null } },
    select: { id: true, providerAccountId: true },
  });
  return new Map(rows.map((r) => [r.providerAccountId as string, r.id]));
}

function rowData(t: ProviderTransaction, companyId: string, connectionId: string, bankAccountId: string | null) {
  return {
    companyId,
    bankConnectionId: connectionId,
    bankAccountId,
    providerAccountId: t.providerAccountId,
    postedAt: t.postedAt,
    amountCents: t.amountCents,
    description: t.description,
    merchantName: t.merchantName,
    pending: t.pending,
    category: t.category,
    checkNumber: t.checkNumber,
    currency: t.currency,
  };
}

/**
 * Pull everything new for one connection.
 *
 * Returns rather than throws on a provider failure: one broken connection must
 * not stop the sweep from syncing the others.
 */
export async function syncConnection(args: {
  companyId: string;
  connectionId: string;
  actor: PostingActor;
  maxPages?: number;
  /**
   * Override the configured provider.
   *
   * A seam, not a convenience: the retraction path — "the bank took a
   * transaction back, so reverse the entry made from it" — is the single most
   * consequential branch in this file and the fixture never reports removals.
   * Without somewhere to inject, that branch could only be tested by mocking
   * the module graph, which tests the mock. Production never passes this.
   */
  provider?: BankFeedProvider;
}): Promise<SyncResult> {
  const result: SyncResult = {
    connectionId: args.connectionId,
    added: 0,
    modified: 0,
    removed: 0,
    hasMore: false,
  };

  const connection = await prisma.bankConnection.findFirst({
    where: { id: args.connectionId, companyId: args.companyId },
    select: { id: true, accessTokenEnc: true, cursor: true, status: true },
  });
  if (!connection) return { ...result, error: "No such connection." };
  if (connection.status === "disconnected") return { ...result, error: "Connection is disconnected." };

  const accessToken = decryptField(connection.accessTokenEnc);
  if (!accessToken) {
    // The blob cannot be read — a key was rotated away or the row is corrupt.
    // Loud, and never printing the blob.
    await prisma.bankConnection.update({
      where: { id: connection.id },
      data: { status: "error", lastError: "Stored credential could not be decrypted." },
    });
    return { ...result, error: "Stored credential could not be decrypted." };
  }

  const provider = args.provider ?? (await bankFeedProvider());
  const byProviderAccount = await accountIndex(args.companyId, connection.id);
  let cursor = connection.cursor;
  const limit = args.maxPages ?? MAX_PAGES_PER_RUN;

  for (let page = 0; page < limit; page += 1) {
    let sync;
    try {
      sync = await provider.syncTransactions({ accessToken, cursor });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sync failed.";
      // An auth failure is a different state from a transient one: it needs a
      // human to re-authenticate, and the UI says so rather than retrying
      // forever behind their back.
      const needsReconnect = /ITEM_LOGIN_REQUIRED|INVALID_ACCESS_TOKEN/i.test(message);
      await prisma.bankConnection.update({
        where: { id: connection.id },
        data: {
          status: needsReconnect ? "needs_reconnect" : "error",
          ...(needsReconnect ? { needsReconnectAt: new Date() } : {}),
          lastError: message.slice(0, 500),
        },
      });
      return { ...result, error: message };
    }

    for (const t of [...sync.added, ...sync.modified]) {
      const bankAccountId = byProviderAccount.get(t.providerAccountId) ?? null;
      const data = rowData(t, args.companyId, connection.id, bankAccountId);
      const existing = await prisma.bankFeedTransaction.findUnique({
        where: {
          companyId_providerTransactionId: {
            companyId: args.companyId,
            providerTransactionId: t.providerTransactionId,
          },
        },
        select: { id: true, status: true },
      });

      if (!existing) {
        await prisma.bankFeedTransaction.create({
          data: { ...data, providerTransactionId: t.providerTransactionId },
        });
        result.added += 1;
        continue;
      }

      /**
       * A row that has already been POSTED is not overwritten by a later
       * revision of itself. The entry in the books was made from what the bank
       * said at the time, and silently rewriting the evidence under a posted
       * entry would make the two disagree with no trace. Only its pending flag
       * is allowed to settle.
       */
      if (existing.status === "posted" || existing.status === "matched") {
        if (!t.pending) {
          await prisma.bankFeedTransaction.update({
            where: { id: existing.id },
            data: { pending: false },
          });
        }
        continue;
      }

      await prisma.bankFeedTransaction.update({ where: { id: existing.id }, data });
      result.modified += 1;
    }

    for (const removedId of sync.removed) {
      const row = await prisma.bankFeedTransaction.findUnique({
        where: {
          companyId_providerTransactionId: {
            companyId: args.companyId,
            providerTransactionId: removedId,
          },
        },
        select: { id: true, journalEntryId: true, status: true },
      });
      if (!row) continue;

      /**
       * The bank retracted a transaction we had already booked. The entry is
       * REVERSED, never deleted — the same rule as every other void, and the
       * reason the books can always explain themselves.
       */
      if (row.journalEntryId) {
        const voided = await voidJournalEntry({
          companyId: args.companyId,
          entryId: row.journalEntryId,
          reason: "The bank retracted this transaction.",
          actor: args.actor,
        });
        if (!voided.ok) {
          console.error(`[bank-feeds] could not reverse entry for retracted ${removedId}: ${voided.error}`);
        }
      }

      await prisma.bankFeedTransaction.update({
        where: { id: row.id },
        data: { status: "removed", removedAt: new Date() },
      });
      result.removed += 1;
    }

    cursor = sync.cursor;
    // PERSISTED EVERY PAGE. This single line is what makes an interrupted sync
    // resumable instead of a restart.
    await prisma.bankConnection.update({
      where: { id: connection.id },
      data: { cursor, lastSyncedAt: new Date(), lastError: null, status: "active" },
    });

    if (!sync.hasMore) return result;
  }

  result.hasMore = true;
  return result;
}

/**
 * The sweep behind the cron. Every active connection, across every company.
 *
 * One failure is recorded against its own connection and the loop continues —
 * a single bank with an expired login must not stop everybody else's books
 * from updating.
 */
export async function syncAllConnections(args: {
  actor: PostingActor;
  limit?: number;
}): Promise<{ synced: number; results: SyncResult[] }> {
  const connections = await prisma.bankConnection.findMany({
    where: { status: { in: ["active", "error"] } },
    orderBy: [{ lastSyncedAt: "asc" }],
    take: args.limit ?? 25,
    select: { id: true, companyId: true },
  });

  const results: SyncResult[] = [];
  for (const c of connections) {
    results.push(
      await syncConnection({ companyId: c.companyId, connectionId: c.id, actor: args.actor })
    );
  }
  return { synced: results.length, results };
}

/** Dollars from a signed cent amount, for display. */
export const toDollars = (cents: number) => cents / CENTS;
