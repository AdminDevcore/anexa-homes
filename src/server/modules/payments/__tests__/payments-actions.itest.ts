import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { Role } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";

/**
 * CAN A PAYMENT ACTUALLY BE MADE?
 *
 * This file exists because of a gap that every other test missed. `payments.itest.ts`
 * proves the module's controls thoroughly — but it enrols the checker's second
 * factor by calling `beginEnrollment` and `confirmEnrollment` DIRECTLY. Nothing
 * in the product did. Every caller of those two functions was a test.
 *
 * So in production: `approvePayment` required a TOTP code, `verifyMfa` required
 * an enrolled factor, nothing could enrol one, and `sendPayment` required
 * approval. No payment could ever be approved, and none could ever be sent. A
 * module suite at 100% said nothing about it, because the suite supplied the
 * one thing the product could not.
 *
 * This test therefore only uses doors a real caller has: the `"use server"`
 * actions. If enrolment ever stops being reachable, THIS is what fails.
 *
 * WHY APPROVAL USES A RECOVERY CODE. Confirming an enrolment spends the current
 * TOTP step — that is the replay guard doing its job — and
 * `approvePaymentAction` deliberately exposes no clock seam, because a
 * back-dating parameter on a fraud control is exactly the bug that was found in
 * Phase 5. A fresh `totp()` in the same 30-second window would be refused as a
 * replay, so approval here spends a recovery code, which is a path a real user
 * has and which nothing else covered end to end. The TOTP path is covered at
 * module level in payments.itest.ts and mfa.itest.ts.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

type Current = {
  userId: string;
  companyId: string;
  role: Role;
  permissions: Record<string, unknown>;
  email: string | null;
  fullName: string;
  companySlug: string;
};

/** Who `requireUser()` answers with on the next call. */
let current: Current;

vi.mock("@/server/auth/session", () => ({
  requireUser: async () => current,
  getSessionUser: async () => current,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const { ensureChartOfAccounts, systemAccountId } = await import("@/server/modules/books/chart");
const { createBankAccount } = await import("@/server/modules/books/bank-accounts");
const { createBill } = await import("@/server/modules/books/bills");
const { totp } = await import("@/server/lib/totp");
const { createPayee } = await import("../payees");
const P = await import("../actions");
const M = await import("@/server/auth/mfa-actions");

const rand = () => Math.random().toString(36).slice(2, 8);
const HOUR = 3_600_000;

let companyId: string;
let makerId: string;
let checkerId: string;
let strangerId: string;
let repId: string;
let bankAccountId: string;
let payeeId: string;
let vendorId: string;
let materialsId: string;

const actAs = (userId: string, role: Role, slug = "pay-co") => {
  current = {
    userId,
    companyId,
    role,
    permissions: {},
    email: `${userId}@t.local`,
    fullName: "Test Person",
    companySlug: slug,
  };
};

const asMaker = () => actAs(makerId, "accounting");
/** super_admin holds `Payment: ALL`, so the checker's verb is never in doubt. */
const asChecker = () => actAs(checkerId, "super_admin");
const asStranger = () => actAs(strangerId, "super_admin");
const asRep = () => actAs(repId, "sales_rep");

beforeEach(async () => {
  const company = await db.company.create({
    data: { name: "Pay Co", slug: `payact-${process.pid}-${Date.now()}-${rand()}` },
  });
  companyId = company.id;

  const mk = async (first: string, role: Role) =>
    (
      await db.user.create({
        data: {
          companyId,
          email: `${first}-${Date.now()}-${Math.random()}@t.local`,
          passwordHash: "x",
          firstName: first,
          lastName: "Person",
          role,
          verticals: ["roofing"],
        },
        select: { id: true },
      })
    ).id;

  makerId = await mk("Mo", "accounting");
  checkerId = await mk("Cass", "super_admin");
  strangerId = await mk("Sam", "super_admin");
  repId = await mk("Rae", "sales_rep");

  await ensureChartOfAccounts(companyId);

  asMaker();
  const acct = await createBankAccount({
    companyId,
    name: "Operating",
    institution: "Truist",
    mask: "4321",
    kind: "checking",
    defaultVertical: null,
    openingBalanceCents: 0,
    openingBalanceDate: null,
    actor: { kind: "user", userId: makerId, role: "accounting" },
  });
  if (!acct.ok) throw new Error(acct.error);
  bankAccountId = acct.bankAccountId;

  vendorId = (await db.bookkeepingVendor.create({ data: { companyId, name: "Ace Supply" } })).id;
  materialsId = (await systemAccountId(companyId, "materials"))!;

  const payee = await createPayee({
    companyId,
    name: `Ace ${rand()}`,
    vendorId,
    bank: { routingNumber: "021000021", accountNumber: "123456789", accountType: "checking" },
    actorUserId: makerId,
  });
  if (!payee.ok) throw new Error(payee.error);
  payeeId = payee.payeeId;
  // Established, so the cooling-off period is not what is under test here.
  await db.payee.update({
    where: { id: payeeId },
    data: { bankDetailsUpdatedAt: new Date(Date.now() - 2 * 24 * HOUR) },
  });
});

afterAll(async () => {
  await db.$disconnect();
});

/** A posted bill and a payment against it, submitted and waiting for a checker. */
async function aSubmittedPayment(amountCents = 125_000) {
  const bill = await createBill({
    companyId,
    vendorId,
    billNumber: `B-${rand()}`,
    amountCents,
    billedAt: new Date("2026-06-15T12:00:00Z"),
    expenseAccountId: materialsId,
    actor: { kind: "user", userId: makerId, role: "accounting" },
  });
  if (!bill.ok) throw new Error(bill.error);

  asMaker();
  const created = await P.createPaymentAction({
    payeeId,
    billId: bill.billId,
    bankAccountId,
    amount: amountCents / 100,
    memo: "materials",
  });
  expect(created.ok, "the maker could not raise a payment").toBe(true);
  if (!created.ok) throw new Error(created.error);

  const submitted = await P.submitPaymentAction({ paymentId: created.paymentId });
  expect(submitted.ok, "the maker could not submit").toBe(true);
  return created.paymentId;
}

/** Enrol the CHECKER through the action surface, and return the recovery codes. */
async function enrolChecker(): Promise<string[]> {
  asChecker();
  const begun = await M.beginMfaEnrollmentAction();
  expect(begun.ok, "enrolment could not be started").toBe(true);
  if (!begun.ok) throw new Error(begun.error);

  const confirmed = await M.confirmMfaEnrollmentAction({ code: totp(begun.secret) });
  expect(confirmed.ok, "enrolment could not be confirmed").toBe(true);
  if (!confirmed.ok) throw new Error(confirmed.error);
  return confirmed.recoveryCodes;
}

describe("the gap: nothing could enrol a second factor", () => {
  /**
   * The regression test for the whole problem. Before enrolment exists, a
   * checker who holds every payment verb still cannot approve — which is the
   * state production was in.
   */
  it("cannot approve without an enrolled factor, however senior the approver", async () => {
    const paymentId = await aSubmittedPayment();

    asChecker();
    const res = await P.approvePaymentAction({ paymentId, mfaCode: "123456" });
    expect(res.ok).toBe(false);

    const after = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(after.status, "an unapproved payment moved anyway").toBe("submitted");
    expect(after.approvedById).toBeNull();
  });

  it("enrols through the action surface, and hands back ten recovery codes once", async () => {
    const codes = await enrolChecker();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size, "the codes are not distinct").toBe(10);

    const row = await db.userMfa.findUniqueOrThrow({ where: { userId: checkerId } });
    expect(row.enrolledAt).not.toBeNull();
  });

  /**
   * The actions take NO userId — it comes from the session. So enrolling can
   * only ever affect the caller's own account, which is what stops a public RPC
   * endpoint from resetting a colleague's second factor.
   */
  it("enrols the session's own user and nobody else", async () => {
    await enrolChecker();

    expect(await db.userMfa.count({ where: { userId: checkerId } })).toBe(1);
    expect(await db.userMfa.count({ where: { userId: makerId } })).toBe(0);
    expect(await db.userMfa.count({ where: { userId: strangerId } })).toBe(0);

    // A different session enrolling does not disturb the first.
    asStranger();
    const begun = await M.beginMfaEnrollmentAction();
    expect(begun.ok).toBe(true);
    expect((await db.userMfa.findUniqueOrThrow({ where: { userId: checkerId } })).enrolledAt).not.toBeNull();
  });

  it("refuses to start a second factor when one is already set up", async () => {
    await enrolChecker();
    asChecker();
    const again = await M.beginMfaEnrollmentAction();
    expect(again.ok).toBe(false);
  });
});

describe("a payment can now be made, end to end, through the actions only", () => {
  it("maker raises, checker approves with a recovery code, then sends", async () => {
    const codes = await enrolChecker();
    const paymentId = await aSubmittedPayment();

    asChecker();
    const approved = await P.approvePaymentAction({ paymentId, mfaCode: codes[0] });
    expect(approved.ok, "approval failed").toBe(true);

    const afterApproval = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(afterApproval.status).toBe("approved");
    expect(afterApproval.approvedById).toBe(checkerId);
    // Approving does not move money.
    expect(afterApproval.sentAt).toBeNull();

    const sent = await P.sendPaymentAction({ paymentId });
    expect(sent.ok, "sending failed").toBe(true);

    const afterSend = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(["sent", "settled"]).toContain(afterSend.status);
    expect(afterSend.sentAt).not.toBeNull();
    // The money leaving is a ledger event, not just a status.
    expect(afterSend.journalEntryId).not.toBeNull();
  });

  /** Maker-checker. The rule no permission can express. */
  it("will not let the person who raised it approve it", async () => {
    const codes = await enrolChecker();
    const paymentId = await aSubmittedPayment();

    // The maker enrols too, so the refusal cannot be blamed on a missing factor.
    asMaker();
    const begun = await M.beginMfaEnrollmentAction();
    if (!begun.ok) throw new Error(begun.error);
    const mine = await M.confirmMfaEnrollmentAction({ code: totp(begun.secret) });
    if (!mine.ok) throw new Error(mine.error);

    asMaker();
    const res = await P.approvePaymentAction({ paymentId, mfaCode: mine.recoveryCodes[0] });
    expect(res.ok, "the maker approved their own payment").toBe(false);

    expect((await db.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe("submitted");

    // And the checker still can, so the refusal was about WHO, not about state.
    asChecker();
    expect((await P.approvePaymentAction({ paymentId, mfaCode: codes[0] })).ok).toBe(true);
  });

  /** A code is spent when used, so one code cannot release two payments. */
  it("cannot reuse a recovery code on a second payment", async () => {
    const codes = await enrolChecker();

    const first = await aSubmittedPayment(100_000);
    asChecker();
    expect((await P.approvePaymentAction({ paymentId: first, mfaCode: codes[0] })).ok).toBe(true);

    const second = await aSubmittedPayment(110_000);
    asChecker();
    const replay = await P.approvePaymentAction({ paymentId: second, mfaCode: codes[0] });
    expect(replay.ok, "a spent recovery code worked twice").toBe(false);

    expect((await db.payment.findUniqueOrThrow({ where: { id: second } })).status).toBe("submitted");

    // A different, unspent code still works.
    const ok = await P.approvePaymentAction({ paymentId: second, mfaCode: codes[1] });
    expect(ok.ok).toBe(true);
  });
});

describe("who may reach the payment actions at all", () => {
  it("refuses a sales rep every payment action", async () => {
    const paymentId = await aSubmittedPayment();
    asRep();

    const calls: [string, () => Promise<{ ok: boolean; error?: string }>][] = [
      ["createPaymentAction", () =>
        P.createPaymentAction({ payeeId, billId: "whatever", bankAccountId, amount: 10, memo: null })],
      ["submitPaymentAction", () => P.submitPaymentAction({ paymentId })],
      ["approvePaymentAction", () => P.approvePaymentAction({ paymentId, mfaCode: "123456" })],
      ["sendPaymentAction", () => P.sendPaymentAction({ paymentId })],
      ["cancelPaymentAction", () => P.cancelPaymentAction({ paymentId })],
      ["createPayeeAction", () => P.createPayeeAction({ name: "Nope", email: null, vendorId: null, bank: null })],
      ["setPayeeActiveAction", () => P.setPayeeActiveAction({ payeeId, active: false })],
    ];

    for (const [name, call] of calls) {
      const res = await call();
      expect(res.ok, `${name} let a sales_rep through`).toBe(false);
      expect(res.error, name).toBe("Not allowed.");
    }

    // Nothing moved.
    expect((await db.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe("submitted");
    expect((await db.payee.findUniqueOrThrow({ where: { id: payeeId } })).active).toBe(true);
  });

  /**
   * Enrolment is NOT resource-gated, deliberately: a second factor protects the
   * account that owns it, so anyone with a session may set one up for
   * themselves. The check that matters is that it only ever touches their own.
   */
  it("lets any signed-in user enrol their own factor", async () => {
    asRep();
    const begun = await M.beginMfaEnrollmentAction();
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;

    const confirmed = await M.confirmMfaEnrollmentAction({ code: totp(begun.secret) });
    expect(confirmed.ok).toBe(true);
    expect(await db.userMfa.count({ where: { userId: repId } })).toBe(1);
    // …which still does not let them approve anything.
    const paymentId = await aSubmittedPayment();
    asRep();
    if (confirmed.ok) {
      const res = await P.approvePaymentAction({ paymentId, mfaCode: confirmed.recoveryCodes[0] });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe("Not allowed.");
    }
  });
});
