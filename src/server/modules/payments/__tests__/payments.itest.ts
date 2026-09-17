import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { ensureChartOfAccounts, systemAccountId } from "@/server/modules/books/chart";
import { createBankAccount } from "@/server/modules/books/bank-accounts";
import { accountBalances, trialBalance } from "@/server/modules/books/reports";
import { createBill } from "@/server/modules/books/bills";
import { beginEnrollment, confirmEnrollment } from "@/server/auth/mfa";
import { totp } from "@/server/lib/totp";
import { createPayee } from "../payees";
import {
  createPayment,
  submitPayment,
  approvePayment,
  sendPayment,
  cancelPayment,
  applyPaymentEvent,
} from "../payments";

/**
 * MONEY LEAVING THE COMPANY.
 *
 * Every other part of the books records what happened. This is the one place
 * where a mistake cannot be undone by a reversing entry, because a reversing
 * entry does not bring the money back. So the controls are stacked, and each
 * one is tested on its own:
 *
 *   • MAKER ≠ CHECKER — the control that survives one compromised account;
 *   • a second factor, SPENT when used, so one code cannot release two
 *     payments;
 *   • the payee cooling-off period, evaluated when the money LEAVES rather
 *     than when it was approved;
 *   • limits per payment and per day;
 *   • idempotency, because a timeout looks exactly like a success;
 *   • and a return that reverses the entry and makes the bill owed again.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let makerId: string;
let checkerId: string;
let checkerSecret: string;
let bankAccountId: string;
let bankLedgerId: string;
let payeeId: string;
let vendorId: string;
let apId: string;
let materialsId: string;

const rand = () => Math.random().toString(36).slice(2, 8);
const HOUR = 3_600_000;
const DAY = new Date("2026-06-15T12:00:00Z");
const YEAR = { startMs: Date.UTC(2026, 0, 1), endMs: Date.UTC(2026, 11, 31, 23, 59, 59, 999) };

const actor = () => ({ kind: "user" as const, userId: makerId, role: "super_admin" as const });

/** Confirming enrolment spends the current step, so codes come from later. */
const later = () => Date.now() + 60_000;

let savedSingle: string | undefined;
let savedDaily: string | undefined;

beforeEach(async () => {
  savedSingle = process.env.PAYMENT_SINGLE_LIMIT_CENTS;
  savedDaily = process.env.PAYMENT_DAILY_LIMIT_CENTS;

  const company = await db.company.create({
    data: { name: "Pay Co", slug: `pay-${process.pid}-${Date.now()}-${rand()}` },
  });
  companyId = company.id;

  const mk = async (first: string) =>
    (
      await db.user.create({
        data: {
          companyId, email: `${first}-${Date.now()}-${Math.random()}@t.local`, passwordHash: "x",
          firstName: first, lastName: "Person", role: "super_admin", verticals: ["roofing"],
        },
        select: { id: true },
      })
    ).id;
  makerId = await mk("Mo");
  checkerId = await mk("Cass");

  // The checker holds the second factor.
  const begun = await beginEnrollment({ userId: checkerId, companyId, accountEmail: "cass@t.local" });
  if (!begun.ok) throw new Error(begun.error);
  const confirmed = await confirmEnrollment({ userId: checkerId, code: totp(begun.secret) });
  if (!confirmed.ok) throw new Error(confirmed.error);
  checkerSecret = begun.secret;

  await ensureChartOfAccounts(companyId);
  const acct = await createBankAccount({
    companyId, name: "Operating", institution: "Truist", mask: "4321",
    kind: "checking", defaultVertical: null, openingBalanceCents: 0,
    openingBalanceDate: null, actor: actor(),
  });
  if (!acct.ok) throw new Error(acct.error);
  bankAccountId = acct.bankAccountId;
  bankLedgerId = (
    await db.bankAccount.findFirstOrThrow({ where: { id: bankAccountId }, select: { ledgerAccountId: true } })
  ).ledgerAccountId;

  vendorId = (await db.bookkeepingVendor.create({ data: { companyId, name: "Ace Supply" } })).id;
  apId = (await systemAccountId(companyId, "accounts_payable"))!;
  materialsId = (await systemAccountId(companyId, "materials"))!;

  const payee = await createPayee({
    companyId, name: `Ace ${rand()}`, vendorId,
    bank: { routingNumber: "021000021", accountNumber: "123456789", accountType: "checking" },
    actorUserId: makerId,
  });
  if (!payee.ok) throw new Error(payee.error);
  payeeId = payee.payeeId;
  // Established, so the cooling-off period is not what is under test.
  await db.payee.update({
    where: { id: payeeId },
    data: { bankDetailsUpdatedAt: new Date(Date.now() - 2 * 24 * HOUR) },
  });
});

afterEach(() => {
  if (savedSingle === undefined) delete process.env.PAYMENT_SINGLE_LIMIT_CENTS;
  else process.env.PAYMENT_SINGLE_LIMIT_CENTS = savedSingle;
  if (savedDaily === undefined) delete process.env.PAYMENT_DAILY_LIMIT_CENTS;
  else process.env.PAYMENT_DAILY_LIMIT_CENTS = savedDaily;
});

afterAll(async () => {
  await db.$disconnect();
});

const aBill = async (amountCents = 125_000) => {
  const res = await createBill({
    companyId, vendorId, billNumber: `B-${rand()}`, amountCents,
    billedAt: DAY, expenseAccountId: materialsId, actor: actor(),
  });
  if (!res.ok) throw new Error(res.error);
  return res.billId;
};

const raise = async (amountCents = 125_000) => {
  const billId = await aBill(amountCents);
  const res = await createPayment({
    companyId, payeeId, billId, bankAccountId, amountCents, actorUserId: makerId,
  });
  if (!res.ok) throw new Error(res.error);
  return { paymentId: res.paymentId, billId };
};

const raiseAndSubmit = async (amountCents = 125_000) => {
  const r = await raise(amountCents);
  const s = await submitPayment({ companyId, paymentId: r.paymentId, actorUserId: makerId });
  if (!s.ok) throw new Error(s.error);
  return r;
};

const approveAs = (paymentId: string, userId: string, at = later()) =>
  approvePayment({ companyId, paymentId, actorUserId: userId, mfaCode: totp(checkerSecret, { at }), at });

const balanceOf = async (accountId: string) =>
  (await accountBalances({ companyId, period: YEAR })).find((r) => r.accountId === accountId)?.balanceCents ?? 0;

describe("maker and checker", () => {
  /** The control that survives one compromised or dishonest account. */
  it("refuses to let the person who raised a payment approve it", async () => {
    const { paymentId } = await raiseAndSubmit();

    // Give the maker a factor too, so this fails on WHO they are and not on a
    // missing authenticator.
    const begun = await beginEnrollment({ userId: makerId, companyId, accountEmail: "mo@t.local" });
    if (!begun.ok) throw new Error(begun.error);
    await confirmEnrollment({ userId: makerId, code: totp(begun.secret) });

    const at = later();
    const res = await approvePayment({
      companyId, paymentId, actorUserId: makerId, mfaCode: totp(begun.secret, { at }), at,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("somebody other than the person who raised it");
  });

  it("lets somebody else approve it", async () => {
    const { paymentId } = await raiseAndSubmit();
    expect((await approveAs(paymentId, checkerId)).ok).toBe(true);

    const row = await db.payment.findFirstOrThrow({ where: { id: paymentId } });
    expect(row.status).toBe("approved");
    expect(row.approvedById).toBe(checkerId);
    expect(row.approvalMfaStep).not.toBeNull();
  });

  it("refuses to approve a payment nobody has submitted", async () => {
    const { paymentId } = await raise();
    const res = await approveAs(paymentId, checkerId);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("submitted");
  });

  it("refuses to approve the same payment twice", async () => {
    const { paymentId } = await raiseAndSubmit();
    expect((await approveAs(paymentId, checkerId)).ok).toBe(true);
    expect((await approveAs(paymentId, checkerId)).ok).toBe(false);
  });
});

describe("the second factor", () => {
  it("refuses a wrong code", async () => {
    const { paymentId } = await raiseAndSubmit();
    const res = await approvePayment({
      companyId, paymentId, actorUserId: checkerId, mfaCode: "000000", at: later(),
    });
    expect(res.ok).toBe(false);
  });

  it("refuses an approver who has no authenticator", async () => {
    const { paymentId } = await raiseAndSubmit();
    const stranger = (
      await db.user.create({
        data: {
          companyId, email: `s-${Date.now()}-${Math.random()}@t.local`, passwordHash: "x",
          firstName: "Sam", lastName: "Stranger", role: "super_admin", verticals: ["roofing"],
        },
        select: { id: true },
      })
    ).id;

    const at = later();
    const res = await approvePayment({
      companyId, paymentId, actorUserId: stranger, mfaCode: totp(checkerSecret, { at }), at,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("no authenticator");
  });

  /**
   * ONE CODE, ONE PAYMENT. Without the spent-step guard, a single code seen
   * over a shoulder releases everything waiting for approval.
   */
  it("refuses to approve a second payment with the same code", async () => {
    const first = await raiseAndSubmit(125_000);
    const second = await raiseAndSubmit(60_000);

    const at = later();
    const code = totp(checkerSecret, { at });

    expect(
      (await approvePayment({ companyId, paymentId: first.paymentId, actorUserId: checkerId, mfaCode: code, at })).ok
    ).toBe(true);

    const reused = await approvePayment({
      companyId, paymentId: second.paymentId, actorUserId: checkerId, mfaCode: code, at: at + 5_000,
    });
    expect(reused.ok).toBe(false);
    if (!reused.ok) expect(reused.error).toContain("already been used");
  });
});

describe("limits", () => {
  it("refuses a single payment over the limit", async () => {
    process.env.PAYMENT_SINGLE_LIMIT_CENTS = "100000"; // $1,000
    const billId = await aBill(125_000);
    const res = await createPayment({
      companyId, payeeId, billId, bankAccountId, amountCents: 125_000, actorUserId: makerId,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("limit for a single payment");
  });

  /** Individually-allowed payments must not add up to an unallowed day. */
  it("refuses an approval that takes the day over its limit", async () => {
    process.env.PAYMENT_DAILY_LIMIT_CENTS = "150000"; // $1,500
    const first = await raiseAndSubmit(100_000);
    const second = await raiseAndSubmit(100_000);

    expect((await approveAs(first.paymentId, checkerId)).ok).toBe(true);

    const over = await approveAs(second.paymentId, checkerId, later() + 30_000);
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error).toContain("daily limit");
  });
});

describe("sending", () => {
  it("moves the money, pays the bill, and records the transfer", async () => {
    const { paymentId, billId } = await raiseAndSubmit();
    expect((await approveAs(paymentId, checkerId)).ok).toBe(true);

    const sent = await sendPayment({ companyId, paymentId, actor: actor(), postingDate: DAY });
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;

    expect(await balanceOf(apId)).toBe(0);
    expect(await balanceOf(bankLedgerId)).toBe(-125_000);
    expect((await trialBalance(companyId)).balanced).toBe(true);

    const bill = await db.bill.findFirstOrThrow({ where: { id: billId } });
    expect(bill.status).toBe("paid");

    const row = await db.payment.findFirstOrThrow({ where: { id: paymentId } });
    expect(row.status).toBe("sent");
    expect(row.providerTransferId).toMatch(/^fix_/);
    expect(row.journalEntryId).toBe(sent.entryId);
  });

  it("refuses to send a payment nobody approved", async () => {
    const { paymentId } = await raiseAndSubmit();
    const res = await sendPayment({ companyId, paymentId, actor: actor(), postingDate: DAY });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("approved");
    expect(await balanceOf(bankLedgerId)).toBe(0);
  });

  /**
   * COOLING-OFF IS CHECKED AT SEND, not at approval. Details changed in between
   * would otherwise go out on an approval given against the old ones.
   */
  it("refuses to send when the bank details changed after approval", async () => {
    const { paymentId } = await raiseAndSubmit();
    expect((await approveAs(paymentId, checkerId)).ok).toBe(true);

    await db.payee.update({ where: { id: payeeId }, data: { bankDetailsUpdatedAt: new Date() } });

    const res = await sendPayment({ companyId, paymentId, actor: actor(), postingDate: DAY });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("cannot be paid");
    expect(await balanceOf(bankLedgerId)).toBe(0);
  });

  it("records a provider refusal without touching the ledger", async () => {
    await db.payee.update({
      where: { id: payeeId },
      data: {
        accountNumberEnc: (await createPayee({
          companyId, name: `Bad ${rand()}`,
          bank: { routingNumber: "021000021", accountNumber: "000000000", accountType: "checking" },
          actorUserId: makerId,
        }).then(async (r) => {
          if (!r.ok) throw new Error(r.error);
          const bad = await db.payee.findFirstOrThrow({ where: { id: r.payeeId } });
          return bad.accountNumberEnc!;
        })),
      },
    });

    const { paymentId } = await raiseAndSubmit();
    expect((await approveAs(paymentId, checkerId)).ok).toBe(true);

    const res = await sendPayment({ companyId, paymentId, actor: actor(), postingDate: DAY });
    expect(res.ok).toBe(false);

    const row = await db.payment.findFirstOrThrow({ where: { id: paymentId } });
    expect(row.status).toBe("failed");
    expect(row.journalEntryId).toBeNull();
    expect(await balanceOf(bankLedgerId)).toBe(0);
  });
});

describe("what a payment refuses to be", () => {
  it("must settle the bill in full", async () => {
    const billId = await aBill(125_000);
    const res = await createPayment({
      companyId, payeeId, billId, bankAccountId, amountCents: 100_000, actorUserId: makerId,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("settles it in full");
  });

  /** Two drafts against one bill both pass every later check, and the vendor is
   * paid twice. */
  it("refuses a second payment against the same bill", async () => {
    const { billId } = await raise();
    const again = await createPayment({
      companyId, payeeId, billId, bankAccountId, amountCents: 125_000, actorUserId: makerId,
    });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toContain("already a payment against that bill");
  });

  it("refuses a bill that is not in the books yet", async () => {
    const draft = await createBill({
      companyId, vendorId, billNumber: `B-${rand()}`, amountCents: 50_000,
      billedAt: DAY, expenseAccountId: materialsId, status: "draft", actor: actor(),
    });
    if (!draft.ok) throw new Error(draft.error);

    const res = await createPayment({
      companyId, payeeId, billId: draft.billId, bankAccountId, amountCents: 50_000, actorUserId: makerId,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("Post that bill");
  });

  it("can be cancelled before it is sent, but never after", async () => {
    const { paymentId } = await raiseAndSubmit();
    expect((await cancelPayment({ companyId, paymentId })).ok).toBe(true);

    const other = await raiseAndSubmit(60_000);
    expect((await approveAs(other.paymentId, checkerId)).ok).toBe(true);
    expect((await sendPayment({ companyId, paymentId: other.paymentId, actor: actor(), postingDate: DAY })).ok).toBe(true);
    expect((await cancelPayment({ companyId, paymentId: other.paymentId })).ok).toBe(false);
  });
});

describe("what the bank says afterwards", () => {
  const sendOne = async () => {
    const { paymentId, billId } = await raiseAndSubmit();
    expect((await approveAs(paymentId, checkerId)).ok).toBe(true);
    const sent = await sendPayment({ companyId, paymentId, actor: actor(), postingDate: DAY });
    if (!sent.ok) throw new Error(sent.error);
    const row = await db.payment.findFirstOrThrow({ where: { id: paymentId } });
    return { paymentId, billId, transferId: row.providerTransferId! };
  };

  it("settles", async () => {
    const { paymentId, transferId } = await sendOne();
    const res = await applyPaymentEvent({
      providerId: "fixture", eventId: `e-${rand()}`, kind: "transfer.settled",
      providerTransferId: transferId, status: "settled", payload: {}, actor: actor(),
    });
    expect(res.ok).toBe(true);
    expect((await db.payment.findFirstOrThrow({ where: { id: paymentId } })).status).toBe("settled");
  });

  /**
   * ACH bounces DAYS later. Both facts are true — the money left, and it came
   * back — so the entry is REVERSED, never unposted, and the bill is owed again
   * because it is.
   */
  it("reverses a return and makes the bill owed again", async () => {
    const { paymentId, billId, transferId } = await sendOne();

    const res = await applyPaymentEvent({
      providerId: "fixture", eventId: `e-${rand()}`, kind: "transfer.returned",
      providerTransferId: transferId, status: "returned",
      returnCode: "R01", returnReason: "Insufficient funds", payload: {}, actor: actor(),
    });
    expect(res.ok).toBe(true);

    const row = await db.payment.findFirstOrThrow({ where: { id: paymentId } });
    expect(row.status).toBe("returned");
    expect(row.returnCode).toBe("R01");
    expect(row.reversalEntryId).not.toBeNull();

    // The ledger is back where it was, by reversal rather than by deletion.
    expect(await balanceOf(bankLedgerId)).toBe(0);
    expect(await balanceOf(apId)).toBe(125_000);
    expect((await trialBalance(companyId)).balanced).toBe(true);

    const bill = await db.bill.findFirstOrThrow({ where: { id: billId } });
    expect(bill.status).toBe("open");
    expect(bill.paidAt).toBeNull();
  });

  /** Providers redeliver. An event applied twice would reverse a reversal. */
  it("applies an event only once, however many times it arrives", async () => {
    const { transferId } = await sendOne();
    const eventId = `e-${rand()}`;

    const first = await applyPaymentEvent({
      providerId: "fixture", eventId, kind: "transfer.returned",
      providerTransferId: transferId, status: "returned", payload: {}, actor: actor(),
    });
    const second = await applyPaymentEvent({
      providerId: "fixture", eventId, kind: "transfer.returned",
      providerTransferId: transferId, status: "returned", payload: {}, actor: actor(),
    });

    expect(first.ok && first.applied).toBe(true);
    // Success, not an error: the endpoint must still answer 2xx or the provider
    // keeps trying forever.
    expect(second.ok && second.applied).toBe(false);

    expect(await db.journalEntry.count({ where: { companyId, status: "void" } })).toBe(1);
    expect(await balanceOf(apId)).toBe(125_000);
  });

  /** Events arrive out of order. A settlement after a return is stale. */
  it("does not let a late settlement overwrite a return", async () => {
    const { paymentId, transferId } = await sendOne();

    await applyPaymentEvent({
      providerId: "fixture", eventId: `e-${rand()}`, kind: "transfer.returned",
      providerTransferId: transferId, status: "returned", payload: {}, actor: actor(),
    });
    await applyPaymentEvent({
      providerId: "fixture", eventId: `e-${rand()}`, kind: "transfer.settled",
      providerTransferId: transferId, status: "settled", payload: {}, actor: actor(),
    });

    expect((await db.payment.findFirstOrThrow({ where: { id: paymentId } })).status).toBe("returned");
  });

  it("ignores an event about a transfer it has never heard of", async () => {
    const res = await applyPaymentEvent({
      providerId: "fixture", eventId: `e-${rand()}`, kind: "transfer.settled",
      providerTransferId: "fix_unknown", status: "settled", payload: {}, actor: actor(),
    });
    expect(res.ok).toBe(true);
  });
});
