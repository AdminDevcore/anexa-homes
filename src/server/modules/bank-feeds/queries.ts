import type { BankConnectionStatus, BankFeedTransactionStatus, Vertical } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { suggestionsForQueue } from "./rules";
import { suggestTransferPairs, type TransferSuggestion } from "./review";

/**
 * Everything the review screen renders, in one round of queries.
 *
 * The rule suggestion is JOINED ON HERE rather than stored on the row — see
 * rules.ts. That means this function is the only place the queue and the rules
 * meet, so a screen can never show a category that the rules no longer produce.
 */

export type QueueRow = {
  id: string;
  postedAt: string;
  amountCents: number;
  description: string;
  merchantName: string | null;
  pending: boolean;
  checkNumber: string | null;
  bankAccountId: string | null;
  bankAccountName: string | null;
  /** The provider's category guess. Shown as a hint, never acted on. */
  category: string[];
  /** What a rule would do with this row, if any rule claims it. */
  suggestion: {
    ruleId: string;
    ruleName: string;
    accountId: string;
    accountName: string;
    vertical: Vertical | null;
    autoPost: boolean;
  } | null;
};

export type ConnectionRow = {
  id: string;
  institutionName: string | null;
  status: BankConnectionStatus;
  lastSyncedAt: string | null;
  lastError: string | null;
  accountCount: number;
  /** True when a person must re-authenticate before the feed resumes. */
  needsAttention: boolean;
};

export type FeedOverview = {
  connections: ConnectionRow[];
  accounts: { id: string; name: string; mask: string | null; kind: string; connected: boolean }[];
  queue: QueueRow[];
  transferSuggestions: TransferSuggestion[];
  counts: Record<BankFeedTransactionStatus, number>;
  /** Accounts a row may be categorised into. */
  postableAccounts: { id: string; number: string; name: string; type: string }[];
};

/** How many queue rows the screen holds. Counts below are over ALL rows. */
export const QUEUE_PAGE = 100;

export async function getFeedOverview(companyId: string): Promise<FeedOverview> {
  const [connections, accounts, rows, grouped, postable, transferSuggestions, ruleSuggestions] =
    await Promise.all([
      prisma.bankConnection.findMany({
        where: { companyId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true, institutionName: true, status: true, lastSyncedAt: true,
          lastError: true, _count: { select: { accounts: true } },
        },
      }),
      prisma.bankAccount.findMany({
        where: { companyId, active: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, mask: true, kind: true, bankConnectionId: true },
      }),
      prisma.bankFeedTransaction.findMany({
        where: { companyId, status: "review" },
        orderBy: [{ postedAt: "desc" }, { id: "asc" }],
        take: QUEUE_PAGE,
        select: {
          id: true, postedAt: true, amountCents: true, description: true,
          merchantName: true, pending: true, checkNumber: true, category: true,
          bankAccountId: true, bankAccount: { select: { name: true } },
        },
      }),
      // Counts come from an aggregate over EVERY row, never from the page above:
      // summing a capped list is how a total silently under-reports.
      prisma.bankFeedTransaction.groupBy({
        by: ["status"],
        where: { companyId },
        _count: { _all: true },
      }),
      prisma.ledgerAccount.findMany({
        where: { companyId, active: true },
        orderBy: { number: "asc" },
        select: { id: true, number: true, name: true, type: true },
      }),
      suggestTransferPairs(companyId),
      suggestionsForQueue(companyId, QUEUE_PAGE),
    ]);

  const accountNames = new Map(postable.map((a) => [a.id, a.name]));
  const byTransaction = new Map(ruleSuggestions.map((s) => [s.feedTransactionId, s]));

  const counts = {
    review: 0, posted: 0, matched: 0, excluded: 0, removed: 0,
  } as Record<BankFeedTransactionStatus, number>;
  for (const g of grouped) counts[g.status] = g._count._all;

  return {
    connections: connections.map((c) => ({
      id: c.id,
      institutionName: c.institutionName,
      status: c.status,
      lastSyncedAt: c.lastSyncedAt ? c.lastSyncedAt.toISOString() : null,
      lastError: c.lastError,
      accountCount: c._count.accounts,
      // `error` is often transient and retries on its own; needs_reconnect
      // cannot resolve without a person, so only that one is called out.
      needsAttention: c.status === "needs_reconnect",
    })),
    accounts: accounts.map((a) => ({
      id: a.id,
      name: a.name,
      mask: a.mask,
      kind: a.kind,
      connected: a.bankConnectionId !== null,
    })),
    queue: rows.map((r) => {
      const hit = byTransaction.get(r.id);
      return {
        id: r.id,
        postedAt: r.postedAt.toISOString(),
        amountCents: r.amountCents,
        description: r.description,
        merchantName: r.merchantName,
        pending: r.pending,
        checkNumber: r.checkNumber,
        bankAccountId: r.bankAccountId,
        bankAccountName: r.bankAccount?.name ?? null,
        category: r.category,
        suggestion: hit
          ? {
              ruleId: hit.ruleId,
              ruleName: hit.ruleName,
              accountId: hit.accountId,
              accountName: accountNames.get(hit.accountId) ?? "(unknown account)",
              vertical: hit.vertical,
              autoPost: hit.autoPost,
            }
          : null,
      };
    }),
    transferSuggestions,
    counts,
    postableAccounts: postable,
  };
}

/** The rules screen: every rule with the account it posts to. */
export async function listBankRules(companyId: string) {
  return prisma.bankRule.findMany({
    where: { companyId },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true, name: true, enabled: true, priority: true, direction: true,
      matchText: true, matchType: true, minAmountCents: true, maxAmountCents: true,
      autoPost: true, timesApplied: true, lastAppliedAt: true, vertical: true,
      account: { select: { id: true, number: true, name: true } },
      bankAccount: { select: { id: true, name: true } },
    },
  });
}
