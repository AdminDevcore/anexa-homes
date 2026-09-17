import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { ensureChartOfAccounts, systemAccountId } from "../chart";
import { trialBalance, accountBalances } from "../reports";
import { apAging, createBill, payBill, postBillAccrual, voidBill } from "../bills";

/**
 * VENDOR BILLS.
 *
 * The property that carries the rest: a bill is an EXPENSE on the day the
 * vendor billed and a movement of CASH on the day it was paid, and between
 * those two dates the company genuinely owes the money. A ledger that cannot
 * show that owes nothing is not a ledger.
 *
 * So these tests check the two events separately — what the P&L says in March,
 * what the bank says in May, and what Accounts Payable says in between.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let ownerId: string;
let vendorId: string;
let bankId: string;
let materialsId: string;
let apId: string;

const actor = () => ({ kind: "user" as const, userId: ownerId, role: "super_admin" as const });

const MAR = new Date("2026-03-10T12:00:00Z");
const MAY = new Date("2026-05-20T12:00:00Z");
const YEAR = { startMs: Date.UTC(2026, 0, 1), endMs: Date.UTC(2026, 11, 31, 23, 59, 59, 999) };

beforeEach(async () => {
  const company = await db.company.create({
    data: { name: "Bills Co", slug: `bill-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` },
  });
  companyId = company.id;
  ownerId = (
    await db.user.create({
      data: {
        companyId, email: `o-${Date.now()}-${Math.random()}@t.local`, passwordHash: "x",
        firstName: "Ola", lastName: "Owner", role: "super_admin", verticals: ["roofing", "solar"],
      },
    })
  ).id;
  await ensureChartOfAccounts(companyId);
  vendorId = (await db.bookkeepingVendor.create({ data: { companyId, name: "Ace Supply" } })).id;
  bankId = (await db.ledgerAccount.findFirstOrThrow({ where: { companyId, number: "1010" } })).id;
  materialsId = (await systemAccountId(companyId, "materials"))!;
  apId = (await systemAccountId(companyId, "accounts_payable"))!;
});

afterAll(async () => {
  await db.$disconnect();
});

const aBill = (over: Partial<Parameters<typeof createBill>[0]> = {}) =>
  createBill({
    companyId,
    vendorId,
    billNumber: `B-${Math.random().toString(36).slice(2, 8)}`,
    amountCents: 125_000,
    billedAt: MAR,
    dueAt: new Date("2026-04-09T12:00:00Z"),
    expenseAccountId: materialsId,
    actor: actor(),
    ...over,
  });

const balanceOf = async (accountId: string) =>
  (await accountBalances({ companyId, period: YEAR })).find((r) => r.accountId === accountId)?.balanceCents ?? 0;

describe("entering a bill", () => {
  it("expenses it and owes it, on the day the vendor billed", async () => {
    const res = await aBill();
    expect(res.ok).toBe(true);

    expect(await balanceOf(materialsId)).toBe(125_000);
    // A liability's normal balance is a credit, so a positive figure here is
    // money owed rather than money held.
    expect(await balanceOf(apId)).toBe(125_000);
    // Nothing has left the bank.
    expect(await balanceOf(bankId)).toBe(0);
  });

  it("keeps the ledger balanced", async () => {
    await aBill();
    const tb = await trialBalance(companyId);
    expect(tb.balanced).toBe(true);
  });

  /** An amount nobody has confirmed is not yet a debt. */
  it("does not post a draft", async () => {
    const res = await aBill({ status: "draft" });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.entryId).toBeNull();

    expect(await balanceOf(apId)).toBe(0);
    expect(await balanceOf(materialsId)).toBe(0);
  });

  it("posts a draft later without re-entering it", async () => {
    const res = await aBill({ status: "draft" });
    if (!res.ok) throw new Error(res.error);

    const posted = await postBillAccrual({ companyId, billId: res.billId, actor: actor() });
    expect(posted.ok).toBe(true);
    expect(await balanceOf(apId)).toBe(125_000);

    const bill = await db.bill.findUniqueOrThrow({ where: { id: res.billId } });
    expect(bill.status).toBe("open");
  });

  it("will not post the same bill into the books twice", async () => {
    const res = await aBill();
    if (!res.ok) throw new Error(res.error);
    const again = await postBillAccrual({ companyId, billId: res.billId, actor: actor() });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toContain("already in the books");
  });

  it("refuses a duplicate bill number, an empty one, and a zero amount", async () => {
    const first = await aBill({ billNumber: "DUP-1" });
    expect(first.ok).toBe(true);

    expect((await aBill({ billNumber: "DUP-1" })).ok).toBe(false);
    expect((await aBill({ billNumber: "   " })).ok).toBe(false);
    expect((await aBill({ amountCents: 0 })).ok).toBe(false);
    expect((await aBill({ amountCents: -500 })).ok).toBe(false);
  });

  it("refuses a vendor from another company", async () => {
    const other = await db.company.create({
      data: { name: "Other", slug: `oth-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` },
    });
    const foreign = await db.bookkeepingVendor.create({ data: { companyId: other.id, name: "Theirs" } });

    const res = await aBill({ vendorId: foreign.id });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("not on this company");
  });
});

describe("paying a bill", () => {
  it("settles the payable and takes the money out, dated the day it left", async () => {
    const res = await aBill();
    if (!res.ok) throw new Error(res.error);

    const paid = await payBill({ companyId, billId: res.billId, bankLedgerAccountId: bankId, date: MAY, actor: actor() });
    expect(paid.ok).toBe(true);

    expect(await balanceOf(apId)).toBe(0);
    expect(await balanceOf(bankId)).toBe(-125_000);
    // The expense stays in March. Paying a bill is not an expense.
    expect(await balanceOf(materialsId)).toBe(125_000);

    const bill = await db.bill.findUniqueOrThrow({ where: { id: res.billId } });
    expect(bill.status).toBe("paid");
    expect(bill.paidAt?.toISOString()).toBe(MAY.toISOString());
  });

  it("is a SEPARATE entry from the accrual", async () => {
    const res = await aBill();
    if (!res.ok) throw new Error(res.error);
    await payBill({ companyId, billId: res.billId, bankLedgerAccountId: bankId, date: MAY, actor: actor() });

    const entries = await db.journalEntry.findMany({
      where: { companyId, sourceId: { startsWith: `bill:${res.billId}` } },
      select: { sourceType: true, sourceId: true, date: true },
      orderBy: { date: "asc" },
    });
    expect(entries).toHaveLength(2);
    expect(entries[0].sourceId).toBe(`bill:${res.billId}`);
    expect(entries[1].sourceId).toBe(`bill:${res.billId}:payment`);
    expect(entries[0].date.getTime()).toBeLessThan(entries[1].date.getTime());
  });

  it("will not pay a bill that is not in the books", async () => {
    const res = await aBill({ status: "draft" });
    if (!res.ok) throw new Error(res.error);
    const paid = await payBill({ companyId, billId: res.billId, bankLedgerAccountId: bankId, date: MAY, actor: actor() });
    expect(paid.ok).toBe(false);
    if (!paid.ok) expect(paid.error).toContain("before paying");
  });

  it("will not pay the same bill twice", async () => {
    const res = await aBill();
    if (!res.ok) throw new Error(res.error);
    await payBill({ companyId, billId: res.billId, bankLedgerAccountId: bankId, date: MAY, actor: actor() });
    const again = await payBill({ companyId, billId: res.billId, bankLedgerAccountId: bankId, date: MAY, actor: actor() });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toContain("already paid");
  });

  it("leaves the ledger balanced after both events", async () => {
    const res = await aBill();
    if (!res.ok) throw new Error(res.error);
    await payBill({ companyId, billId: res.billId, bankLedgerAccountId: bankId, date: MAY, actor: actor() });
    expect((await trialBalance(companyId)).balanced).toBe(true);
  });
});

describe("voiding a bill", () => {
  it("reverses the accrual rather than deleting it", async () => {
    const res = await aBill();
    if (!res.ok) throw new Error(res.error);

    const voided = await voidBill({ companyId, billId: res.billId, reason: "keyed twice", actor: actor() });
    expect(voided.ok).toBe(true);

    expect(await balanceOf(apId)).toBe(0);
    expect(await balanceOf(materialsId)).toBe(0);

    // Both halves survive, so an auditor sees the mistake and the correction.
    const entries = await db.journalEntry.count({
      where: { companyId, sourceType: { startsWith: "bill" } },
    });
    expect(entries).toBe(2);

    const bill = await db.bill.findUniqueOrThrow({ where: { id: res.billId } });
    expect(bill.status).toBe("void");
  });

  it("wants a reason", async () => {
    const res = await aBill();
    if (!res.ok) throw new Error(res.error);
    expect((await voidBill({ companyId, billId: res.billId, reason: "  ", actor: actor() })).ok).toBe(false);
  });

  /** The money moved. Erasing it would make the books disagree with the bank. */
  it("refuses to void a bill that has been paid", async () => {
    const res = await aBill();
    if (!res.ok) throw new Error(res.error);
    await payBill({ companyId, billId: res.billId, bankLedgerAccountId: bankId, date: MAY, actor: actor() });

    const voided = await voidBill({ companyId, billId: res.billId, reason: "changed my mind", actor: actor() });
    expect(voided.ok).toBe(false);
    if (!voided.ok) expect(voided.error).toContain("refund or a credit note");
  });
});

describe("A/P aging", () => {
  const asOf = new Date("2026-06-15T12:00:00Z");

  it("buckets by how far past due, and totals each bucket", async () => {
    await aBill({ billNumber: "AP-1", amountCents: 10_000, dueAt: new Date("2026-06-20T12:00:00Z") }); // current
    await aBill({ billNumber: "AP-2", amountCents: 20_000, dueAt: new Date("2026-06-01T12:00:00Z") }); // 14 over
    await aBill({ billNumber: "AP-3", amountCents: 30_000, dueAt: new Date("2026-01-01T12:00:00Z") }); // 90+

    const ap = await apAging(companyId, asOf);
    expect(ap.totalCents).toBe(60_000);
    expect(ap.totals["Current"]).toBe(10_000);
    expect(ap.totals["1–30"]).toBe(20_000);
    expect(ap.totals["90+"]).toBe(30_000);
  });

  /** No due date means no terms were recorded, not that it was due on arrival. */
  it("treats a bill with no due date as current", async () => {
    await aBill({ billNumber: "AP-ND", dueAt: null });
    const ap = await apAging(companyId, asOf);
    expect(ap.rows).toHaveLength(1);
    expect(ap.rows[0].bucket).toBe("Current");
    expect(ap.rows[0].daysOver).toBe(0);
  });

  it("counts only open bills — not drafts, not paid, not void", async () => {
    await aBill({ billNumber: "AP-OPEN", amountCents: 11_000 });
    await aBill({ billNumber: "AP-DRAFT", amountCents: 22_000, status: "draft" });

    const paid = await aBill({ billNumber: "AP-PAID", amountCents: 33_000 });
    if (paid.ok) await payBill({ companyId, billId: paid.billId, bankLedgerAccountId: bankId, date: MAY, actor: actor() });

    const voided = await aBill({ billNumber: "AP-VOID", amountCents: 44_000 });
    if (voided.ok) await voidBill({ companyId, billId: voided.billId, reason: "duplicate", actor: actor() });

    const ap = await apAging(companyId, asOf);
    expect(ap.totalCents).toBe(11_000);
    expect(ap.rows.map((r) => r.billNumber)).toEqual(["AP-OPEN"]);
  });

  it("agrees with the Accounts Payable balance", async () => {
    await aBill({ billNumber: "AP-X", amountCents: 75_000 });
    await aBill({ billNumber: "AP-Y", amountCents: 25_000 });

    const ap = await apAging(companyId, asOf);
    expect(ap.totalCents).toBe(await balanceOf(apId));
  });
});
