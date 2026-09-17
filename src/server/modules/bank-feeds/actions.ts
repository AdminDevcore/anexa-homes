"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Vertical } from "@prisma/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { projectAccessible } from "@/server/rbac/lead-access";
import { prisma } from "@/server/db/client";
import { bankFeedProvider } from "./index";
import { connectBank, syncConnection } from "./sync";
import {
  acceptFeedTransaction,
  matchFeedTransaction,
  markAsTransfer,
  excludeFeedTransaction,
  undoDecision,
  suggestTransferPairs,
} from "./review";
import { settleFromFeed } from "./settle";
import { importStatement } from "./import";
import type { PostingActor } from "@/server/modules/books/posting";

/**
 * THE BANK FEED ACTION SURFACE.
 *
 * Every export is a `"use server"` endpoint, which is a PUBLIC RPC route rather
 * than a function only its page may call. So each re-establishes the caller and
 * checks the verb; `gate()` is the only way in, exactly as in books/actions.ts.
 *
 * Bank data belongs to super_admin and accounting alone. That is enforced here,
 * at the endpoint, which is what makes it true rather than merely true of the
 * navigation.
 */

function fail(error: string) {
  return { ok: false as const, error };
}

async function gate(action: "create" | "read" | "update" | "delete") {
  const user = await requireUser();
  if (!can(user, action, "Bookkeeping")) {
    return { user: null, actor: null, denied: fail("Not allowed.") };
  }
  const actor: PostingActor = { kind: "user", userId: user.userId, role: user.role };
  return { user, actor, denied: null };
}

function revalidate() {
  revalidatePath("/portal/books");
  revalidatePath("/portal/bookkeeping");
}

// ── Connecting ─────────────────────────────────────────────────────────────

/**
 * A token that opens the provider's connect widget.
 *
 * The widget takes the user's banking credentials directly; they never reach
 * this server. What comes back is a short-lived public token, exchanged below.
 */
export async function createLinkTokenAction() {
  const { user, denied } = await gate("create");
  if (denied) return denied;

  try {
    const provider = await bankFeedProvider();
    const token = await provider.createLinkToken({
      companyId: user!.companyId,
      userId: user!.userId,
      webhookUrl: process.env.PLAID_WEBHOOK_URL?.trim() || null,
    });
    return { ok: true as const, linkToken: token.linkToken };
  } catch (err) {
    // The provider's message can name configuration; the caller gets none of it.
    console.error("[bank-feeds] link token failed", err);
    return fail("Could not start the bank connection.");
  }
}

export async function exchangePublicTokenAction(input: { publicToken: string }) {
  const { user, actor, denied } = await gate("create");
  if (denied) return denied;
  const parsed = z.object({ publicToken: z.string().min(1) }).safeParse(input);
  if (!parsed.success) return fail("Missing the connection token.");

  const res = await connectBank({
    companyId: user!.companyId,
    userId: user!.userId,
    publicToken: parsed.data.publicToken,
    actor: actor!,
  });
  if (!res.ok) return res;

  revalidate();
  return { ok: true as const, connectionId: res.connectionId, accountsLinked: res.accountsLinked };
}

/** Repair a connection whose credentials expired, keeping its history. */
export async function createReconnectTokenAction(input: { connectionId: string }) {
  const { user, denied } = await gate("update");
  if (denied) return denied;

  const connection = await prisma.bankConnection.findFirst({
    where: { id: input.connectionId, companyId: user!.companyId },
    select: { accessTokenEnc: true },
  });
  if (!connection) return fail("No such connection.");

  const { decryptField } = await import("@/server/lib/crypto");
  const accessToken = decryptField(connection.accessTokenEnc);
  if (!accessToken) return fail("That connection's stored credential cannot be read.");

  try {
    const provider = await bankFeedProvider();
    const token = await provider.createUpdateLinkToken({
      accessToken,
      webhookUrl: process.env.PLAID_WEBHOOK_URL?.trim() || null,
    });
    return { ok: true as const, linkToken: token.linkToken };
  } catch (err) {
    console.error("[bank-feeds] reconnect token failed", err);
    return fail("Could not start the reconnection.");
  }
}

export async function syncNowAction(input: { connectionId: string }) {
  const { user, actor, denied } = await gate("update");
  if (denied) return denied;

  const res = await syncConnection({
    companyId: user!.companyId,
    connectionId: input.connectionId,
    actor: actor!,
  });
  revalidate();
  if (res.error) return fail(res.error);
  return { ok: true as const, added: res.added, modified: res.modified, hasMore: res.hasMore };
}

// ── Deciding ───────────────────────────────────────────────────────────────

const splitLineSchema = z.object({
  accountId: z.string().min(1),
  /** Dollars at the edge, cents inside — converted once, here. */
  amount: z.number().positive(),
  vertical: z.enum(["roofing", "solar", "others"]).nullish(),
  projectId: z.string().nullish(),
  vendorId: z.string().nullish(),
  memo: z.string().max(300).nullish(),
});

const acceptSchema = z.object({
  feedTransactionId: z.string().min(1),
  lines: z.array(splitLineSchema).min(1).max(50),
  memo: z.string().max(300).nullish(),
});

export async function acceptFeedTransactionAction(input: z.infer<typeof acceptSchema>) {
  const { user, actor, denied } = await gate("create");
  if (denied) return denied;
  const parsed = acceptSchema.safeParse(input);
  if (!parsed.success) return fail("Choose an account and an amount.");

  /**
   * EVERY JOB THE CALLER NAMED MUST BE ONE THEY CAN REACH.
   *
   * `projectId` arrives from the browser and is written onto a journal line as
   * the job's cost. Unchecked, a bookkeeper could tag a line to a job in
   * another company — or one their own scope excludes — and the cost would
   * appear on a deal's profit with nothing in the entry looking wrong.
   *
   * `projectAccessible` asks the question through `listScope`, so the answer is
   * the viewer's, not merely the company's.
   */
  for (const line of parsed.data.lines) {
    if (!line.projectId) continue;
    if (!(await projectAccessible(user!, line.projectId))) {
      return fail("That job is not available to you.");
    }
  }

  const res = await acceptFeedTransaction({
    companyId: user!.companyId,
    feedTransactionId: parsed.data.feedTransactionId,
    memo: parsed.data.memo ?? null,
    actor: actor!,
    lines: parsed.data.lines.map((l) => ({
      accountId: l.accountId,
      amountCents: Math.round(l.amount * 100),
      vertical: (l.vertical ?? null) as Vertical | null,
      projectId: l.projectId ?? null,
      vendorId: l.vendorId ?? null,
      memo: l.memo ?? null,
    })),
  });
  if (!res.ok) return res;
  revalidate();
  return res;
}

export async function matchFeedTransactionAction(input: {
  feedTransactionId: string;
  journalEntryId: string;
}) {
  const { user, actor, denied } = await gate("update");
  if (denied) return denied;

  const res = await matchFeedTransaction({
    companyId: user!.companyId,
    feedTransactionId: input.feedTransactionId,
    journalEntryId: input.journalEntryId,
    actor: actor!,
  });
  if (!res.ok) return res;
  revalidate();
  return res;
}

const settleSchema = z.object({
  feedTransactionId: z.string().min(1),
  target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("invoice"), invoiceId: z.string().min(1) }),
    z.object({ kind: z.literal("bill"), billId: z.string().min(1) }),
    z.object({ kind: z.literal("funding"), fundingId: z.string().min(1) }),
  ]),
  memo: z.string().max(300).nullish(),
});

/**
 * Settle an open item from a bank row: collect an invoice, pay a bill, or
 * recognise a lender funding.
 *
 * Gated on `create` rather than `update` because it brings a journal entry into
 * existence, exactly as accepting a row does. The id it takes names an invoice,
 * bill or funding — each looked up filtered by `companyId` inside the module
 * that owns it, so an id from another tenant resolves to nothing rather than
 * being settled.
 */
export async function settleFromFeedAction(input: z.infer<typeof settleSchema>) {
  const { user, actor, denied } = await gate("create");
  if (denied) return denied;
  const parsed = settleSchema.safeParse(input);
  if (!parsed.success) return fail("Choose what this transaction settles.");

  const res = await settleFromFeed({
    companyId: user!.companyId,
    feedTransactionId: parsed.data.feedTransactionId,
    target: parsed.data.target,
    actor: actor!,
    memo: parsed.data.memo ?? null,
  });
  if (!res.ok) return res;
  revalidate();
  return res;
}

export async function markAsTransferAction(input: {
  outFeedTransactionId: string;
  inFeedTransactionId: string;
}) {
  const { user, actor, denied } = await gate("create");
  if (denied) return denied;

  const res = await markAsTransfer({
    companyId: user!.companyId,
    outFeedTransactionId: input.outFeedTransactionId,
    inFeedTransactionId: input.inFeedTransactionId,
    actor: actor!,
  });
  if (!res.ok) return res;
  revalidate();
  return res;
}

export async function excludeFeedTransactionAction(input: { feedTransactionId: string }) {
  const { user, actor, denied } = await gate("update");
  if (denied) return denied;

  const res = await excludeFeedTransaction({
    companyId: user!.companyId,
    feedTransactionId: input.feedTransactionId,
    actor: actor!,
  });
  if (!res.ok) return res;
  revalidate();
  return res;
}

export async function undoDecisionAction(input: { feedTransactionId: string }) {
  const { user, denied } = await gate("update");
  if (denied) return denied;

  const res = await undoDecision({
    companyId: user!.companyId,
    feedTransactionId: input.feedTransactionId,
  });
  if (!res.ok) return res;
  revalidate();
  return res;
}

export async function suggestTransfersAction() {
  const { user, denied } = await gate("read");
  if (denied) return denied;
  return { ok: true as const, suggestions: await suggestTransferPairs(user!.companyId) };
}

// ── Importing ──────────────────────────────────────────────────────────────

const importSchema = z.object({
  bankAccountId: z.string().min(1),
  filename: z.string().min(1).max(260),
  /** The file's text. Statements are small; this is not a media upload. */
  content: z.string().min(1).max(8_000_000),
});

export async function importStatementAction(input: z.infer<typeof importSchema>) {
  const { user, denied } = await gate("create");
  if (denied) return denied;
  const parsed = importSchema.safeParse(input);
  if (!parsed.success) return fail("Choose an account and a statement file.");

  const res = await importStatement({
    companyId: user!.companyId,
    bankAccountId: parsed.data.bankAccountId,
    filename: parsed.data.filename,
    content: parsed.data.content,
  });
  revalidate();
  return { ok: true as const, ...res };
}
