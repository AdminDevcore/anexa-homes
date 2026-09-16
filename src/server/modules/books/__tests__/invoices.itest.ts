import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { ensureChartOfAccounts, systemAccountId } from "../chart";
import { trialBalance, accountBalances } from "../reports";
import {
  arAging,
  createInvoice,
  postInvoiceAccrual,
  receiveInvoicePayment,
  voidInvoice,
} from "../invoices";

/**
 * CUSTOMER INVOICES — the debit side of Accounts Receivable.
 *
 * `chart.ts` has always described A/R as "posted by invoices" while nothing
 * posted it. The visible symptom was in the funding tests: recognising a lender
 * deposit CREDITS A/R, and with no debit anywhere, A/R ran NEGATIVE — a balance
 * sheet asserting that customers owed us less than nothing.
 *
 * The two properties that carry the rest:
 *
 *   1. An invoice is revenue on the day it was ISSUED, not the day somebody
 *      typed it in. This is why `issuedAt` exists as its own column.
 *   2. Revenue follows the JOB's department, not the reader's workspace.
 *      Booking solar revenue into roofing produces a P&L that splits wrongly
 *      and still balances perfectly, so nothing downstream would catch it.
 *
 * Note that this whole file runs with NO ambient vertical. Every read in
 * `invoices.ts` touches vertical-scoped Project rows, so a missing
 * `runUnscoped` fails here rather than in production.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let ownerId: string;
let roofJobId: string;
let solarJobId: string;
let bankId: string;
let arId: string;
let roofRevenueId: string;
let solarRevenueId: string;

const actor = () => ({ kind: "user" as const, userId: ownerId, role: "super_admin" as const });

const MAR = new Date("2026-03-10T12:00:00Z");
const APR = new Date("2026-04-09T12:00:00Z");
const MAY = new Date("2026-05-20T12:00:00Z");

const YEAR = { startMs: Date.UTC(2026, 0, 1), endMs: Date.UTC(2026, 11, 31, 23, 59, 59, 999) };
const MARCH = { startMs: Date.UTC(2026, 2, 1), endMs: Date.UTC(2026, 2, 31, 23, 59, 59, 999) };
const MAY_ONLY = { startMs: Date.UTC(2026, 4, 1), endMs: Date.UTC(2026, 4, 31, 23, 59, 59, 999) };

const rand = () => Math.random().toString(36).slice(2, 8);

beforeEach(async () => {
  const company = await db.company.create({
    data: { name: "Invoice Co", slug: `inv-${process.pid}-${Date.now()}-${rand()}` },
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

  const roofLead = await db.lead.create({
    data: { companyId, vertical: "roofing", firstName: "Rita", lastName: "Roofer" },
  });
  const solarLead = await db.lead.create({
    data: { companyId, vertical: "solar", firstName: "Dana", lastName: "Homeowner" },
  });
  roofJobId = (
    await db.project.create({
      data: { companyId, leadId: roofLead.id, projectNumber: `R-${rand()}`, vertical: "roofing" },
    })
  ).id;
  solarJobId = (
    await db.project.create({
      data: { companyId, leadId: solarLead.id, projectNumber: `S-${rand()}`, vertical: "solar" },
    })
  ).id;

  bankId = (await db.ledgerAccount.findFirstOrThrow({ where: { companyId, number: "1010" } })).id;
  arId = (await systemAccountId(companyId, "accounts_receivable"))!;
  roofRevenueId = (await systemAccountId(companyId, "roofing_revenue"))!;
  solarRevenueId = (await systemAccountId(companyId, "solar_revenue"))!;
});

afterAll(async () => {
  await db.$disconnect();
});

const anInvoice = (over: Partial<Parameters<typeof createInvoice>[0]> = {}) =>
  createInvoice({
    companyId,
    projectId: roofJobId,
    invoiceNumber: `INV-${rand()}`,
    amountCents: 1_250_00,
    issuedAt: MAR,
    dueAt: APR,
    actor: actor(),
    ...over,
  });

const balanceOf = async (accountId: string, period = YEAR) =>
  (await accountBalances({ companyId, period })).find((r) => r.accountId === accountId)?.balanceCents ?? 0;

describe("issuing an invoice", () => {
  it("debits Accounts Receivable and credits revenue", async () => {
    const res = await anInvoice();
    expect(res.ok).toBe(true);

    // The debit that was missing. A/R is an asset, so a positive figure here is
    // money owed TO us.
    expect(await balanceOf(arId)).toBe(1_250_00);
    expect(await balanceOf(roofRevenueId)).toBe(1_250_00);
    // Nothing has arrived in the bank.
    expect(await balanceOf(bankId)).toBe(0);
  });

  it("keeps the ledger balanced", async () => {
    await anInvoice();
    expect((await trialBalance(companyId)).balanced).toBe(true);
  });

  /**
   * The reason `issuedAt` is its own column rather than `createdAt`. This row
   * is being written right now, in whatever month the suite runs, and it must
   * still be March revenue.
   */
  it("books revenue in the month it was ISSUED, not the month it was entered", async () => {
    await anInvoice({ issuedAt: MAR });

    expect(await balanceOf(roofRevenueId, MARCH)).toBe(1_250_00);
    expect(await balanceOf(roofRevenueId, MAY_ONLY)).toBe(0);
  });

  /**
   * A P&L that splits wrongly still balances, so nothing downstream would ever
   * notice. Pinned from both sides.
   */
  it("credits the department the JOB belongs to", async () => {
    await anInvoice({ projectId: solarJobId, amountCents: 900_00 });

    expect(await balanceOf(solarRevenueId)).toBe(900_00);
    expect(await balanceOf(roofRevenueId)).toBe(0);
  });

  it("tags the invoice and its ledger lines with the job's department", async () => {
    const res = await anInvoice({ projectId: solarJobId });
    if (!res.ok) throw new Error(res.error);

    const row = await db.invoice.findFirstOrThrow({ where: { id: res.invoiceId } });
    expect(row.vertical).toBe("solar");

    const lines = await db.journalLine.findMany({ where: { entryId: res.entryId! } });
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line.vertical).toBe("solar");
  });

  it("lets the caller override the revenue account", async () => {
    await anInvoice({ revenueAccountId: solarRevenueId });

    expect(await balanceOf(solarRevenueId)).toBe(1_250_00);
    expect(await balanceOf(roofRevenueId)).toBe(0);
  });
});

describe("what an invoice refuses to be", () => {
  it("refuses a non-positive amount", async () => {
    expect((await anInvoice({ amountCents: 0 })).ok).toBe(false);
    expect((await anInvoice({ amountCents: -100 })).ok).toBe(false);
  });

  /** Money is integer cents everywhere in this module. */
  it("refuses fractional cents", async () => {
    expect((await anInvoice({ amountCents: 100.5 })).ok).toBe(false);
  });

  it("refuses a blank invoice number", async () => {
    expect((await anInvoice({ invoiceNumber: "   " })).ok).toBe(false);
  });

  it("refuses a duplicate invoice number on the same company", async () => {
    const num = `INV-${rand()}`;
    expect((await anInvoice({ invoiceNumber: num })).ok).toBe(true);

    const second = await anInvoice({ invoiceNumber: num });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toContain("already exists");
  });

  it("refuses a job that belongs to another company", async () => {
    const other = await db.company.create({
      data: { name: "Other", slug: `oth-${process.pid}-${Date.now()}-${rand()}` },
    });
    const otherLead = await db.lead.create({
      data: { companyId: other.id, vertical: "roofing", firstName: "Ned", lastName: "Neighbour" },
    });
    const otherJob = await db.project.create({
      data: { companyId: other.id, leadId: otherLead.id, projectNumber: `X-${rand()}`, vertical: "roofing" },
    });

    const res = await anInvoice({ projectId: otherJob.id });
    expect(res.ok).toBe(false);
  });

  /** Nothing is written when the job is rejected. */
  it("writes no invoice row when it refuses", async () => {
    const num = `INV-${rand()}`;
    await anInvoice({ invoiceNumber: num, amountCents: 0 });
    expect(await db.invoice.count({ where: { companyId, invoiceNumber: num } })).toBe(0);
  });
});

describe("drafts", () => {
  /** An invoice nobody has sent is not yet a receivable. */
  it("does not post a draft", async () => {
    const res = await anInvoice({ status: "draft" });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.entryId).toBeNull();

    expect(await balanceOf(arId)).toBe(0);
    expect(await balanceOf(roofRevenueId)).toBe(0);
  });

  it("issues a draft later without re-entering it", async () => {
    const res = await anInvoice({ status: "draft" });
    if (!res.ok) throw new Error(res.error);

    const posted = await postInvoiceAccrual({ companyId, invoiceId: res.invoiceId, actor: actor() });
    expect(posted.ok).toBe(true);

    expect(await balanceOf(arId)).toBe(1_250_00);
    expect(await db.invoice.findFirstOrThrow({ where: { id: res.invoiceId } })).toMatchObject({
      status: "sent",
    });
  });

  /** The source key is uniquely constrained; this is the readable half. */
  it("refuses to post the same invoice twice", async () => {
    const res = await anInvoice();
    if (!res.ok) throw new Error(res.error);

    const again = await postInvoiceAccrual({ companyId, invoiceId: res.invoiceId, actor: actor() });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toContain("already in the books");

    // And the ledger is untouched by the attempt.
    expect(await balanceOf(arId)).toBe(1_250_00);
  });
});

describe("collecting an invoice", () => {
  it("moves the money into the bank and clears the receivable", async () => {
    const res = await anInvoice();
    if (!res.ok) throw new Error(res.error);

    const paid = await receiveInvoicePayment({
      companyId, invoiceId: res.invoiceId, bankLedgerAccountId: bankId, date: MAY, actor: actor(),
    });
    expect(paid.ok).toBe(true);

    expect(await balanceOf(bankId)).toBe(1_250_00);
    // Debited in March, credited in May — it nets to nothing owed.
    expect(await balanceOf(arId)).toBe(0);
    expect((await trialBalance(companyId)).balanced).toBe(true);
  });

  /** Collecting is not earning. The revenue was recognised in March and must
   * not be counted a second time when the cheque clears. */
  it("does not recognise revenue twice", async () => {
    const res = await anInvoice();
    if (!res.ok) throw new Error(res.error);
    await receiveInvoicePayment({
      companyId, invoiceId: res.invoiceId, bankLedgerAccountId: bankId, date: MAY, actor: actor(),
    });

    expect(await balanceOf(roofRevenueId)).toBe(1_250_00);
    expect(await balanceOf(roofRevenueId, MAY_ONLY)).toBe(0);
  });

  /** Dating the receipt back to the invoice would make the bank balance
   * disagree with the bank statement. */
  it("dates the receipt the day the money arrived", async () => {
    const res = await anInvoice();
    if (!res.ok) throw new Error(res.error);
    await receiveInvoicePayment({
      companyId, invoiceId: res.invoiceId, bankLedgerAccountId: bankId, date: MAY, actor: actor(),
    });

    expect(await balanceOf(bankId, MARCH)).toBe(0);
    expect(await balanceOf(bankId, MAY_ONLY)).toBe(1_250_00);
  });

  it("marks it paid, once", async () => {
    const res = await anInvoice();
    if (!res.ok) throw new Error(res.error);
    await receiveInvoicePayment({
      companyId, invoiceId: res.invoiceId, bankLedgerAccountId: bankId, date: MAY, actor: actor(),
    });

    const again = await receiveInvoicePayment({
      companyId, invoiceId: res.invoiceId, bankLedgerAccountId: bankId, date: MAY, actor: actor(),
    });
    expect(again.ok).toBe(false);
    expect(await balanceOf(bankId)).toBe(1_250_00);
  });

  it("refuses to collect an invoice that was never posted", async () => {
    const res = await anInvoice({ status: "draft" });
    if (!res.ok) throw new Error(res.error);

    const paid = await receiveInvoicePayment({
      companyId, invoiceId: res.invoiceId, bankLedgerAccountId: bankId, date: MAY, actor: actor(),
    });
    expect(paid.ok).toBe(false);
  });
});

describe("voiding an invoice", () => {
  it("reverses it rather than deleting it", async () => {
    const res = await anInvoice();
    if (!res.ok) throw new Error(res.error);

    const voided = await voidInvoice({
      companyId, invoiceId: res.invoiceId, reason: "Billed the wrong job", actor: actor(),
    });
    expect(voided.ok).toBe(true);

    // The row is still there, and so is the original entry.
    expect(await db.invoice.count({ where: { id: res.invoiceId } })).toBe(1);
    const original = await db.journalEntry.findFirstOrThrow({ where: { id: res.entryId! } });
    expect(original.status).toBe("void");

    // A reversing entry exists, pointing at what it reverses.
    const reversal = await db.journalEntry.findFirstOrThrow({ where: { reversesId: res.entryId! } });
    expect(reversal.id).toBe(voided.ok ? voided.reversalId : null);

    expect(await balanceOf(arId)).toBe(0);
    expect(await balanceOf(roofRevenueId)).toBe(0);
    expect((await trialBalance(companyId)).balanced).toBe(true);
  });

  it("insists on a reason", async () => {
    const res = await anInvoice();
    if (!res.ok) throw new Error(res.error);

    expect((await voidInvoice({ companyId, invoiceId: res.invoiceId, reason: "  ", actor: actor() })).ok).toBe(false);
  });

  /** The money arrived. Erasing it would contradict the bank statement. */
  it("refuses to void an invoice that was paid", async () => {
    const res = await anInvoice();
    if (!res.ok) throw new Error(res.error);
    await receiveInvoicePayment({
      companyId, invoiceId: res.invoiceId, bankLedgerAccountId: bankId, date: MAY, actor: actor(),
    });

    const voided = await voidInvoice({
      companyId, invoiceId: res.invoiceId, reason: "Changed my mind", actor: actor(),
    });
    expect(voided.ok).toBe(false);
    if (!voided.ok) expect(voided.error).toContain("refund or a credit note");
  });

  it("voids a draft that was never posted", async () => {
    const res = await anInvoice({ status: "draft" });
    if (!res.ok) throw new Error(res.error);

    const voided = await voidInvoice({
      companyId, invoiceId: res.invoiceId, reason: "Entered twice", actor: actor(),
    });
    expect(voided.ok).toBe(true);
    if (voided.ok) expect(voided.reversalId).toBeNull();
  });
});

describe("the receivables schedule", () => {
  it("buckets by how far past due each invoice is", async () => {
    const asOf = new Date("2026-05-20T12:00:00Z");
    // Due 9 Apr — 41 days over.
    await anInvoice({ amountCents: 100_00, dueAt: APR });
    // Due 15 May — 5 days over.
    await anInvoice({ amountCents: 200_00, dueAt: new Date("2026-05-15T12:00:00Z") });
    // Due next month — not yet due.
    await anInvoice({ amountCents: 300_00, dueAt: new Date("2026-06-30T12:00:00Z") });

    const aging = await arAging(companyId, asOf);
    expect(aging.totals["31–60"]).toBe(100_00);
    expect(aging.totals["1–30"]).toBe(200_00);
    expect(aging.totals.Current).toBe(300_00);
    expect(aging.totalCents).toBe(600_00);
  });

  /** No due date means no terms were recorded — not that it was due on day one. */
  it("treats an invoice with no due date as current", async () => {
    await anInvoice({ amountCents: 400_00, dueAt: null });

    const aging = await arAging(companyId, MAY);
    expect(aging.totals.Current).toBe(400_00);
    expect(aging.rows[0]?.daysOver).toBe(0);
    expect(aging.rows[0]?.dueAt).toBeNull();
  });

  it("counts only what is actually outstanding", async () => {
    const draft = await anInvoice({ amountCents: 100_00, status: "draft" });
    const collected = await anInvoice({ amountCents: 200_00 });
    await anInvoice({ amountCents: 300_00 });

    if (!collected.ok) throw new Error(collected.error);
    await receiveInvoicePayment({
      companyId, invoiceId: collected.invoiceId, bankLedgerAccountId: bankId, date: MAY, actor: actor(),
    });
    expect(draft.ok).toBe(true);

    const aging = await arAging(companyId, MAY);
    // The draft is not a receivable; the paid one is no longer outstanding.
    expect(aging.totalCents).toBe(300_00);
    expect(aging.rows).toHaveLength(1);
  });

  it("names the customer and the job", async () => {
    await anInvoice({ projectId: solarJobId });

    const aging = await arAging(companyId, MAY);
    expect(aging.rows[0]?.customerName).toBe("Dana Homeowner");
    expect(aging.rows[0]?.projectNumber).toMatch(/^S-/);
  });

  /** Every bucket prints, so an empty one reads as $0.00 rather than vanishing. */
  it("returns every bucket even when nothing is owed", async () => {
    const aging = await arAging(companyId, MAY);
    expect(aging.totalCents).toBe(0);
    expect(Object.keys(aging.totals)).toEqual(["Current", "1–30", "31–60", "61–90", "90+"]);
  });

  it("does not leak another company's receivables", async () => {
    await anInvoice({ amountCents: 500_00 });

    const other = await db.company.create({
      data: { name: "Other", slug: `oth-${process.pid}-${Date.now()}-${rand()}` },
    });
    const aging = await arAging(other.id, MAY);
    expect(aging.totalCents).toBe(0);
  });
});
