import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { ensureChartOfAccounts, systemAccountId } from "@/server/modules/books/chart";
import { createBankAccount } from "@/server/modules/books/bank-accounts";
import { accountBalances } from "@/server/modules/books/reports";
import { createBill } from "@/server/modules/books/bills";
import { beginEnrollment, confirmEnrollment } from "@/server/auth/mfa";
import { totp } from "@/server/lib/totp";
import { createPayee } from "@/server/modules/payments/payees";
import { createPayment, submitPayment, approvePayment, sendPayment } from "@/server/modules/payments/payments";
import { FixtureAchProvider } from "@/server/modules/payments/providers/fixture";
import { POST } from "../route";

/**
 * THE WEBHOOK ROUTE — the only unauthenticated door in the payments module.
 *
 * The provider's signature checking has its own 19 unit tests. What is tested
 * HERE is the route around it, because that is where the mistakes are different
 * in kind:
 *
 *   • the raw body must be read and verified BEFORE parsing, and never
 *     re-serialised;
 *   • an unverified delivery must get 401 and reveal nothing about WHY;
 *   • a verified delivery must actually reach the books — a route that answers
 *     200 and applies nothing is indistinguishable from a working one until
 *     somebody reconciles;
 *   • a REDELIVERY must answer 2xx, because anything else makes the provider
 *     retry forever, and it must not apply twice;
 *   • an event about a transfer we have never heard of must not be reported as
 *     a duplicate — "I could not store this" and "I already had this" are
 *     different facts, and conflating them loses the event silently.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

const SECRET = "route-test-secret";
let savedSecret: string | undefined;

let companyId: string;
let makerId: string;
let checkerId: string;
let checkerSecret: string;
let bankLedgerId: string;
let payeeId: string;
let vendorId: string;
let materialsId: string;
let apId: string;
let bankAccountId: string;

const rand = () => Math.random().toString(36).slice(2, 8);
const HOUR = 3_600_000;
const DAY = new Date("2026-06-15T12:00:00Z");
const YEAR = { startMs: Date.UTC(2026, 0, 1), endMs: Date.UTC(2026, 11, 31, 23, 59, 59, 999) };

const actor = () => ({ kind: "user" as const, userId: makerId, role: "super_admin" as const });
const later = () => Date.now() + 60_000;

/** A real signed POST, exactly as the provider would send it. */
const post = (rawBody: string, signature?: string) =>
  POST(
    new Request("https://example.test/api/webhooks/ach", {
      method: "POST",
      body: rawBody,
      headers: signature ? { "x-ach-signature": signature } : {},
    })
  );

beforeEach(async () => {
  savedSecret = process.env.ACH_WEBHOOK_SECRET;
  process.env.ACH_WEBHOOK_SECRET = SECRET;

  const company = await db.company.create({
    data: { name: "Hook Co", slug: `hook-${process.pid}-${Date.now()}-${rand()}` },
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
  materialsId = (await systemAccountId(companyId, "materials"))!;
  apId = (await systemAccountId(companyId, "accounts_payable"))!;

  const payee = await createPayee({
    companyId, name: `Ace ${rand()}`, vendorId,
    bank: { routingNumber: "021000021", accountNumber: "123456789", accountType: "checking" },
    actorUserId: makerId,
  });
  if (!payee.ok) throw new Error(payee.error);
  payeeId = payee.payeeId;
  await db.payee.update({
    where: { id: payeeId },
    data: { bankDetailsUpdatedAt: new Date(Date.now() - 2 * 24 * HOUR) },
  });
});

afterEach(() => {
  if (savedSecret === undefined) delete process.env.ACH_WEBHOOK_SECRET;
  else process.env.ACH_WEBHOOK_SECRET = savedSecret;
});

afterAll(async () => {
  await db.$disconnect();
});

/** A bill, paid, so there is a real transfer for the bank to talk about. */
async function aSentPayment(amountCents = 125_000) {
  const bill = await createBill({
    companyId, vendorId, billNumber: `B-${rand()}`, amountCents,
    billedAt: DAY, expenseAccountId: materialsId, actor: actor(),
  });
  if (!bill.ok) throw new Error(bill.error);

  const created = await createPayment({
    companyId, payeeId, billId: bill.billId, bankAccountId, amountCents, actorUserId: makerId,
  });
  if (!created.ok) throw new Error(created.error);
  const submitted = await submitPayment({
    companyId, paymentId: created.paymentId, actorUserId: makerId,
  });
  if (!submitted.ok) throw new Error(submitted.error);

  const at = later();
  const approved = await approvePayment({
    companyId, paymentId: created.paymentId, actorUserId: checkerId,
    mfaCode: totp(checkerSecret, { at }), at,
  });
  if (!approved.ok) throw new Error(approved.error);

  const sent = await sendPayment({
    companyId, paymentId: created.paymentId, actor: actor(), postingDate: DAY,
  });
  if (!sent.ok) throw new Error(sent.error);

  const row = await db.payment.findFirstOrThrow({ where: { id: created.paymentId } });
  return { paymentId: created.paymentId, billId: bill.billId, transferId: row.providerTransferId! };
}

const balanceOf = async (accountId: string) =>
  (await accountBalances({ companyId, period: YEAR })).find((r) => r.accountId === accountId)?.balanceCents ?? 0;

describe("an unverified delivery", () => {
  const body = () => JSON.stringify({ eventId: `evt_${rand()}`, kind: "transfer.settled", status: "settled" });

  it("refuses one with no signature at all", async () => {
    const res = await post(body());
    expect(res.status).toBe(401);
  });

  it("refuses a signature from the wrong secret", async () => {
    const raw = body();
    const res = await post(raw, FixtureAchProvider.sign(raw, "not-the-secret"));
    expect(res.status).toBe(401);
  });

  /** The timestamp is signed WITH the body so a captured delivery cannot be
   * replayed later. That only works if the route rejects a stale one. */
  it("refuses a correctly signed but STALE delivery", async () => {
    const raw = body();
    const res = await post(raw, FixtureAchProvider.sign(raw, SECRET, Date.now() - 10 * 60 * 1000));
    expect(res.status).toBe(401);
  });

  /** An unset secret must never mean "accept everything" on a route that can
   * move a payment's status and reverse a ledger entry. */
  it("fails closed when the secret is not configured", async () => {
    delete process.env.ACH_WEBHOOK_SECRET;
    const raw = body();
    const res = await post(raw, FixtureAchProvider.sign(raw, SECRET));
    expect(res.status).toBe(401);
  });

  /**
   * A route that explains WHICH half of the check failed is an oracle for
   * guessing the other.
   */
  it("says nothing about why", async () => {
    const raw = body();
    const stale = await post(raw, FixtureAchProvider.sign(raw, SECRET, Date.now() - 10 * 60 * 1000));
    const wrong = await post(raw, FixtureAchProvider.sign(raw, "not-the-secret"));

    const a = await stale.json();
    const b = await wrong.json();
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).not.toMatch(/stale|old|timestamp|signature|secret/i);
  });

  it("verifies the RAW bytes, not the object they parse to", async () => {
    const payload = { eventId: `evt_${rand()}`, kind: "transfer.settled", status: "settled" };
    const raw = JSON.stringify(payload);
    const signature = FixtureAchProvider.sign(raw, SECRET);

    // Identical content, different bytes.
    const reserialised = JSON.stringify(payload, null, 2);
    expect((await post(reserialised, signature)).status).toBe(401);
    expect((await post(raw, signature)).status).toBe(200);
  });
});

describe("a verified delivery reaches the books", () => {
  /** A route that answers 200 and applies nothing looks exactly like a working
   * one, until somebody reconciles. */
  it("settles the payment", async () => {
    const { paymentId, transferId } = await aSentPayment();
    const raw = JSON.stringify({
      eventId: `evt_${rand()}`, kind: "transfer.settled", transferId, status: "settled",
    });

    const res = await post(raw, FixtureAchProvider.sign(raw, SECRET));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, applied: true });

    expect((await db.payment.findFirstOrThrow({ where: { id: paymentId } })).status).toBe("settled");
  });

  it("reverses a return, and makes the bill owed again", async () => {
    const { paymentId, billId, transferId } = await aSentPayment();
    const raw = JSON.stringify({
      eventId: `evt_${rand()}`, kind: "transfer.returned", transferId,
      status: "returned", returnCode: "R01", returnReason: "Insufficient funds",
    });

    const res = await post(raw, FixtureAchProvider.sign(raw, SECRET));
    expect(res.status).toBe(200);

    const payment = await db.payment.findFirstOrThrow({ where: { id: paymentId } });
    expect(payment.status).toBe("returned");
    expect(payment.reversalEntryId).not.toBeNull();

    expect(await balanceOf(bankLedgerId)).toBe(0);
    expect(await balanceOf(apId)).toBe(125_000);
    expect((await db.bill.findFirstOrThrow({ where: { id: billId } })).status).toBe("open");
  });

  /**
   * Providers redeliver. Anything other than 2xx makes them retry forever, and
   * applying twice here would reverse a reversal.
   */
  it("answers 2xx to a redelivery without applying it twice", async () => {
    const { transferId } = await aSentPayment();
    const raw = JSON.stringify({
      eventId: `evt_${rand()}`, kind: "transfer.returned", transferId, status: "returned",
    });
    const signature = FixtureAchProvider.sign(raw, SECRET);

    const first = await post(raw, signature);
    const second = await post(raw, signature);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await first.json()).toMatchObject({ applied: true });
    expect(await second.json()).toMatchObject({ applied: false });

    // Reversed once, not twice.
    expect(await db.journalEntry.count({ where: { companyId, status: "void" } })).toBe(1);
    expect(await balanceOf(apId)).toBe(125_000);
  });

  it("records the event, so there is evidence either way", async () => {
    const { transferId } = await aSentPayment();
    const eventId = `evt_${rand()}`;
    const raw = JSON.stringify({ eventId, kind: "transfer.settled", transferId, status: "settled" });

    await post(raw, FixtureAchProvider.sign(raw, SECRET));

    const stored = await db.paymentEvent.findFirstOrThrow({ where: { providerEventId: eventId } });
    expect(stored.kind).toBe("transfer.settled");
    expect(stored.companyId).toBe(companyId);
  });
});

describe("an event we cannot place", () => {
  /**
   * "I could not store this" and "I already had this" are DIFFERENT facts.
   * Reporting the first as the second loses the event with no trace — and an
   * unknown transfer id is exactly how a misrouted or spoofed-but-signed
   * delivery would arrive.
   */
  it("does not report an unknown transfer as a duplicate", async () => {
    const raw = JSON.stringify({
      eventId: `evt_${rand()}`, kind: "transfer.settled",
      transferId: "fix_never_seen", status: "settled",
    });

    const res = await post(raw, FixtureAchProvider.sign(raw, SECRET));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.received).toBe(true);
    // It genuinely is not applied — but it must not be because we pretended we
    // had seen it before.
    expect(body.applied).toBe(false);
    expect(body.error).toBeUndefined();
  });

  it("still answers 2xx for an event about no transfer at all", async () => {
    const raw = JSON.stringify({ eventId: `evt_${rand()}`, kind: "account.updated" });
    const res = await post(raw, FixtureAchProvider.sign(raw, SECRET));
    expect(res.status).toBe(200);
  });
});
