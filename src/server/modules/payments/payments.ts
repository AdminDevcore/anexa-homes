import { Prisma, type PaymentStatus } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { verifyMfa } from "@/server/auth/mfa";
import { payBill } from "@/server/modules/books/bills";
import { voidJournalEntry, type PostingActor } from "@/server/modules/books/posting";
import { bankDetailsForPayment } from "./payees";
import { achProvider, configuredAchProviderId } from "./providers";
import type { TransferStatus } from "./providers/types";

/**
 * MONEY LEAVING THE COMPANY.
 *
 * Every other module in the books records what happened. This one makes
 * something happen, and it is the only one where a mistake cannot be corrected
 * by a reversing entry — a reversing entry does not bring the money back.
 * So the controls are stacked, and each is independent of the others:
 *
 *   1. MAKER AND CHECKER ARE DIFFERENT PEOPLE. The person who raises a payment
 *      can never be the person who approves it. This is the control that
 *      survives a single compromised or dishonest account, and it is enforced
 *      here rather than by role, because a role cannot express "somebody other
 *      than you".
 *   2. APPROVAL TAKES A SECOND FACTOR, and the code is spent when used, so one
 *      shoulder-surfed code cannot approve two payments.
 *   3. THE PAYEE'S COOLING-OFF PERIOD is checked at SEND, not at approval —
 *      see `sendPayment`.
 *   4. LIMITS, per payment and per day, so a compromised account cannot empty
 *      the account in one afternoon even with everything else satisfied.
 *
 * ── A PAYMENT SETTLES A BILL ────────────────────────────────────────────────
 * Deliberately. Money out must answer to a categorised expense, tagged to a
 * department, before it moves — so "pay something that has no bill" is "enter
 * the bill, then pay it", which takes a moment and leaves the books correct.
 * Sending therefore delegates to `payBill` rather than posting a second,
 * competing bill-payment entry: one way to pay a bill, already tested.
 *
 * ── LIMITS ARE CONSTANTS, FOR NOW ───────────────────────────────────────────
 * Overridable by environment, and NOT yet per-company settings — that needs a
 * migration on CompanySettings and is recorded as remaining work rather than
 * quietly skipped. The control is enforced either way; what is missing is the
 * ability for an owner to change it without a deploy.
 */

const envCents = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

/** $50,000 — a single payment above this is refused outright. */
export const singlePaymentLimitCents = () => envCents("PAYMENT_SINGLE_LIMIT_CENTS", 5_000_000);
/** $100,000 — everything approved in one calendar day, together. */
export const dailyLimitCents = () => envCents("PAYMENT_DAILY_LIMIT_CENTS", 10_000_000);

export type PaymentResult = { ok: true; paymentId: string } | { ok: false; error: string };
export type PaymentStep = { ok: true; paymentId: string; entryId?: string } | { ok: false; error: string };

const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

/**
 * Raise a payment against a bill. This is the MAKER's act, and it moves nothing.
 */
export async function createPayment(args: {
  companyId: string;
  payeeId: string;
  billId: string;
  bankAccountId: string;
  amountCents: number;
  memo?: string | null;
  actorUserId: string;
}): Promise<PaymentResult> {
  if (!Number.isInteger(args.amountCents) || args.amountCents <= 0) {
    return { ok: false, error: "A payment must be a positive whole number of cents." };
  }
  if (args.amountCents > singlePaymentLimitCents()) {
    return {
      ok: false,
      error: `That is above the ${money(singlePaymentLimitCents())} limit for a single payment.`,
    };
  }

  const payee = await prisma.payee.findFirst({
    where: { id: args.payeeId, companyId: args.companyId },
    select: { id: true, active: true },
  });
  if (!payee) return { ok: false, error: "That payee is not on this company." };
  if (!payee.active) return { ok: false, error: "That payee is no longer active." };

  const bill = await prisma.bill.findFirst({
    where: { id: args.billId, companyId: args.companyId },
    select: { id: true, status: true, amountCents: true, journalEntryId: true },
  });
  if (!bill) return { ok: false, error: "That bill is not on this company." };
  if (bill.status === "paid") return { ok: false, error: "That bill has already been paid." };
  if (bill.status === "void") return { ok: false, error: "That bill has been voided." };
  if (!bill.journalEntryId) {
    return { ok: false, error: "Post that bill to the books before paying it." };
  }
  if (bill.amountCents !== args.amountCents) {
    return {
      ok: false,
      error: `The bill is ${money(bill.amountCents)}. A payment settles it in full.`,
    };
  }

  // One live payment per bill. Without this, two drafts against the same bill
  // both pass every later check and the vendor is paid twice.
  const inFlight = await prisma.payment.findFirst({
    where: {
      companyId: args.companyId,
      billId: bill.id,
      status: { in: ["draft", "submitted", "approved", "sent", "settled"] },
    },
    select: { id: true },
  });
  if (inFlight) return { ok: false, error: "There is already a payment against that bill." };

  const account = await prisma.bankAccount.findFirst({
    where: { id: args.bankAccountId, companyId: args.companyId },
    select: { id: true },
  });
  if (!account) return { ok: false, error: "That bank account is not on this company." };

  const payment = await prisma.payment.create({
    data: {
      companyId: args.companyId,
      payeeId: payee.id,
      billId: bill.id,
      bankAccountId: account.id,
      amountCents: args.amountCents,
      memo: args.memo ?? null,
      status: "draft",
      createdById: args.actorUserId,
    },
    select: { id: true },
  });
  return { ok: true, paymentId: payment.id };
}

/** Hand it to the checker. Still moves nothing. */
export async function submitPayment(args: {
  companyId: string;
  paymentId: string;
  actorUserId: string;
}): Promise<PaymentResult> {
  const payment = await prisma.payment.findFirst({
    where: { id: args.paymentId, companyId: args.companyId },
    select: { id: true, status: true, createdById: true },
  });
  if (!payment) return { ok: false, error: "That payment is not on this company." };
  if (payment.status !== "draft") {
    return { ok: false, error: `This payment has already been ${payment.status}.` };
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: { status: "submitted", submittedAt: new Date() },
  });
  return { ok: true, paymentId: payment.id };
}

/**
 * Approve it. This is the CHECKER's act, and it is the control that matters.
 *
 * Still moves no money — approval and sending are separate so the cooling-off
 * period is evaluated against the moment the money actually leaves.
 */
export async function approvePayment(args: {
  companyId: string;
  paymentId: string;
  actorUserId: string;
  mfaCode: string;
  /** Test seam, threaded to `verifyMfa`. */
  at?: number;
}): Promise<PaymentResult> {
  const payment = await prisma.payment.findFirst({
    where: { id: args.paymentId, companyId: args.companyId },
    select: { id: true, status: true, createdById: true, amountCents: true },
  });
  if (!payment) return { ok: false, error: "That payment is not on this company." };
  if (payment.status !== "submitted") {
    return { ok: false, error: `Only a submitted payment can be approved; this one is ${payment.status}.` };
  }

  /**
   * MAKER ≠ CHECKER. The whole point: one compromised or dishonest account
   * cannot both raise and release money. Checked before the second factor so
   * somebody approving their own payment is told why, rather than being asked
   * for a code that was never going to be accepted.
   */
  if (payment.createdById && payment.createdById === args.actorUserId) {
    return {
      ok: false,
      error: "A payment must be approved by somebody other than the person who raised it.",
    };
  }

  // The daily limit counts everything already approved today, so a series of
  // individually-allowed payments cannot add up to an unallowed day.
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const approvedToday = await prisma.payment.aggregate({
    where: {
      companyId: args.companyId,
      approvedAt: { gte: startOfDay },
      status: { in: ["approved", "sent", "settled"] },
    },
    _sum: { amountCents: true },
  });
  const already = approvedToday._sum.amountCents ?? 0;
  if (already + payment.amountCents > dailyLimitCents()) {
    return {
      ok: false,
      error:
        `This would take today's approvals to ${money(already + payment.amountCents)}, ` +
        `over the ${money(dailyLimitCents())} daily limit.`,
    };
  }

  // The second factor, spent as it is used.
  const verified = await verifyMfa(
    args.at === undefined
      ? { userId: args.actorUserId, code: args.mfaCode }
      : { userId: args.actorUserId, code: args.mfaCode, at: args.at }
  );
  if (!verified.ok) return { ok: false, error: verified.error };

  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: "approved",
      approvedById: args.actorUserId,
      approvedAt: new Date(),
      approvalMfaStep: verified.step,
    },
  });
  return { ok: true, paymentId: payment.id };
}

/**
 * Send it. This is where money actually leaves.
 *
 * THE COOLING-OFF PERIOD IS CHECKED HERE, not at approval, and the difference
 * matters: details changed between approval and release would otherwise slip
 * through on an approval given against the old ones. `bankDetailsForPayment`
 * owns that rule, so it cannot be forgotten by a caller.
 *
 * The provider call is keyed on the payment id, so a retry after a timeout is
 * the same transfer rather than a second one. The ledger entry is posted only
 * after the provider accepts — booking first would record money that never
 * moved if the send failed.
 */
export async function sendPayment(args: {
  companyId: string;
  paymentId: string;
  actor: PostingActor;
  /**
   * The ACCOUNTING date of the resulting entry, and nothing else.
   *
   * Named for exactly what it is, because when it was called `at` it was
   * threaded into the cooling-off check as well, and one ambiguous name doing
   * two jobs is what made that bypassable. See the check below.
   */
  postingDate?: Date;
}): Promise<PaymentStep> {
  const payment = await prisma.payment.findFirst({
    where: { id: args.paymentId, companyId: args.companyId },
    select: {
      id: true,
      status: true,
      amountCents: true,
      payeeId: true,
      billId: true,
      bankAccountId: true,
      memo: true,
      providerTransferId: true,
      bankAccount: { select: { ledgerAccountId: true } },
    },
  });
  if (!payment) return { ok: false, error: "That payment is not on this company." };
  if (payment.status !== "approved") {
    return { ok: false, error: `Only an approved payment can be sent; this one is ${payment.status}.` };
  }
  if (!payment.billId) return { ok: false, error: "This payment has no bill." };
  if (!payment.bankAccount) return { ok: false, error: "This payment has no bank account." };

  /**
   * EVALUATED AT REAL TIME, and deliberately NOT at the caller's date.
   *
   * The accounting date of an entry and the moment money physically leaves are
   * different axes, and this check belongs to the second one. Passing the
   * posting date in here — which is what the first version did — would make the
   * cooling-off period bypassable by back-dating the payment: change a payee's
   * bank details, post "as of" last month, and the delay evaluates against a
   * date that has already passed.
   *
   * A fraud control a caller can step around by choosing a date is not a
   * control, so there is no parameter here to choose with.
   */
  const details = await bankDetailsForPayment({
    companyId: args.companyId,
    payeeId: payment.payeeId,
  });
  if (!details.ok) return { ok: false, error: details.error };

  const provider = await achProvider();
  const sent = await provider.send({
    // OUR id as the idempotency key — a timeout is indistinguishable from
    // success, and a retry must be the same transfer.
    idempotencyKey: payment.id,
    amountCents: payment.amountCents,
    routingNumber: details.bank.routingNumber,
    accountNumber: details.bank.accountNumber,
    accountType: details.bank.accountType,
    payeeName: details.bank.payeeName,
    memo: payment.memo,
  });
  if (!sent.ok) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "failed", returnReason: sent.error },
    });
    return { ok: false, error: sent.error };
  }

  // The money has moved. Record it in the books through the one door that pays
  // a bill, so there is never a second way to mark a bill paid.
  const posted = await payBill({
    companyId: args.companyId,
    billId: payment.billId,
    bankLedgerAccountId: payment.bankAccount.ledgerAccountId,
    date: args.postingDate ?? new Date(),
    actor: args.actor,
    memo: payment.memo,
  });
  if (!posted.ok) {
    // The transfer is away; refusing to record it would be worse than
    // recording it late. Surface the failure loudly with the transfer id.
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: "sent",
        providerId: configuredAchProviderId(),
        providerTransferId: sent.providerTransferId,
        sentAt: new Date(),
        returnReason: `SENT BUT NOT POSTED: ${posted.error}`,
      },
    });
    return { ok: false, error: `The payment was sent but could not be posted: ${posted.error}` };
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: "sent",
      providerId: configuredAchProviderId(),
      providerTransferId: sent.providerTransferId,
      sentAt: new Date(),
      journalEntryId: posted.entryId,
    },
  });
  return { ok: true, paymentId: payment.id, entryId: posted.entryId };
}

/** Abandon a payment before it goes. Never available once it has been sent. */
export async function cancelPayment(args: {
  companyId: string;
  paymentId: string;
}): Promise<PaymentResult> {
  const payment = await prisma.payment.findFirst({
    where: { id: args.paymentId, companyId: args.companyId },
    select: { id: true, status: true },
  });
  if (!payment) return { ok: false, error: "That payment is not on this company." };
  if (["sent", "settled", "returned"].includes(payment.status)) {
    return { ok: false, error: "This payment has already been sent." };
  }

  await prisma.payment.update({ where: { id: payment.id }, data: { status: "cancelled" } });
  return { ok: true, paymentId: payment.id };
}

export type EventApplication =
  | { ok: true; applied: boolean; status: PaymentStatus | null; reversalEntryId?: string | null }
  | { ok: false; error: string };

/**
 * Apply a verified provider event.
 *
 * DEDUPED BY THE PROVIDER'S EVENT ID, on a unique index. Providers redeliver
 * routinely, and an event applied twice moves a payment's status backwards or
 * reverses a reversal. `applied: false` means "we already had this one", which
 * is a success rather than an error — the endpoint must still answer 2xx or the
 * provider will keep trying.
 *
 * A RETURN IS REVERSED, NEVER UNPOSTED. ACH can bounce days later, and both
 * facts are true: the money left, and it came back. The bill it settled becomes
 * owed again, because it is.
 */
export async function applyPaymentEvent(args: {
  providerId: string;
  eventId: string;
  kind: string;
  providerTransferId: string | null;
  status: TransferStatus | null;
  returnCode?: string | null;
  returnReason?: string | null;
  payload: Record<string, unknown>;
  actor: PostingActor;
}): Promise<EventApplication> {
  const payment = args.providerTransferId
    ? await prisma.payment.findFirst({
        where: { providerTransferId: args.providerTransferId },
        select: { id: true, companyId: true, status: true, billId: true, journalEntryId: true },
      })
    : null;

  /**
   * An event about a transfer we have never heard of is answered before any
   * write. There is no company to attribute it to, and the first version
   * attempted the insert anyway with `companyId: ""` — which cannot satisfy the
   * foreign key, so it always failed and was then reported by the catch below
   * as "already had this one".
   */
  if (!payment) return { ok: true, applied: false, status: null };

  // Recorded FIRST, and the unique index is what makes redelivery safe: the
  // second attempt throws here, before anything is applied.
  try {
    await prisma.paymentEvent.create({
      data: {
        companyId: payment.companyId,
        paymentId: payment.id,
        providerId: args.providerId,
        providerEventId: args.eventId,
        kind: args.kind,
        payload: args.payload as object,
      },
    });
  } catch (err) {
    /**
     * ONLY a duplicate means "we already had this one".
     *
     * The first version caught everything, so ANY failure to store the event —
     * a dropped connection, a constraint we did not anticipate — was reported
     * as a redelivery and the event was never applied. That silently loses a
     * settlement or a return, which are the two things this function exists to
     * apply, and it loses them while answering success.
     */
    const duplicate =
      err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
    if (duplicate) return { ok: true, applied: false, status: null };
    return { ok: false, error: "That event could not be recorded." };
  }
  if (!args.status) return { ok: true, applied: true, status: null };

  if (args.status === "settled") {
    if (payment.status === "returned") {
      // Out of order. A settlement after a return is stale; the return wins.
      return { ok: true, applied: false, status: "returned" };
    }
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "settled", settledAt: new Date() },
    });
    return { ok: true, applied: true, status: "settled" };
  }

  if (args.status === "returned" || args.status === "failed") {
    let reversalEntryId: string | null = null;

    if (payment.journalEntryId) {
      const reversed = await voidJournalEntry({
        companyId: payment.companyId,
        entryId: payment.journalEntryId,
        reason: args.returnReason ?? `Payment ${args.status} by the bank (${args.returnCode ?? "no code"})`,
        actor: args.actor,
      });
      if (!reversed.ok) return { ok: false, error: reversed.error };
      reversalEntryId = reversed.entryId;
    }

    // The bill is owed again, because it is.
    if (payment.billId) {
      await prisma.bill.updateMany({
        where: { id: payment.billId, status: "paid" },
        data: { status: "open", paidAt: null },
      });
    }

    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: args.status === "returned" ? "returned" : "failed",
        returnedAt: new Date(),
        returnCode: args.returnCode ?? null,
        returnReason: args.returnReason ?? null,
        reversalEntryId,
      },
    });
    return { ok: true, applied: true, status: args.status === "returned" ? "returned" : "failed", reversalEntryId };
  }

  return { ok: true, applied: true, status: null };
}
