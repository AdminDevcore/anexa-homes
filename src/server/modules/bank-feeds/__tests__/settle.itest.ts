import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { ensureChartOfAccounts, systemAccountId } from "@/server/modules/books/chart";
import { createBankAccount } from "@/server/modules/books/bank-accounts";
import { accountBalances } from "@/server/modules/books/reports";
import { createInvoice } from "@/server/modules/books/invoices";
import { createBill } from "@/server/modules/books/bills";
import { syncExpectedFundings, openFundings } from "@/server/modules/books/funding";
import { settleFromFeed, settlementCandidatesFor } from "../settle";

/**
 * SETTLING AN OPEN ITEM FROM A BANK ROW.
 *
 * The queue could categorise a row or link it to an entry we had already
 * posted. Neither fits the commonest case: the deposit IS an invoice being
 * collected, the withdrawal IS a bill being paid, and the books are already
 * carrying the open item. Categorising such a row books revenue twice and
 * leaves the receivable open; matching cannot help because the settling entry
 * does not exist yet.
 *
 * The properties that matter here all fail SILENTLY if they are wrong — the
 * entry balances either way:
 *
 *   • direction: a deposit cannot pay a bill, a withdrawal cannot collect;
 *   • the amount the bank reported is the amount that moves through the bank;
 *   • the row is LINKED, so money in the books never leaves the queue looking
 *     undecided — the one thing `recogniseFunding` does not do for itself;
 *   • the queue's own rules (pending, already decided) still apply.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let ownerId: string;
let checkingId: string;
let bankLedgerId: string;
let jobId: string;
let vendorId: string;
let arId: string;
let apId: string;
let materialsId: string;

const actor = () => ({ kind: "user" as const, userId: ownerId, role: "super_admin" as const });

const DAY = new Date("2026-06-15T12:00:00Z");
const YEAR = { startMs: Date.UTC(2026, 0, 1), endMs: Date.UTC(2026, 11, 31, 23, 59, 59, 999) };

const rand = () => Math.random().toString(36).slice(2, 8);

beforeEach(async () => {
  const company = await db.company.create({
    data: { name: "Settle Co", slug: `stl-${process.pid}-${Date.now()}-${rand()}` },
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

  const checking = await createBankAccount({
    companyId, name: "Operating", institution: "Truist", mask: "4321",
    kind: "checking", defaultVertical: null, openingBalanceCents: 0,
    openingBalanceDate: null, actor: actor(),
  });
  if (!checking.ok) throw new Error(checking.error);
  checkingId = checking.bankAccountId;
  bankLedgerId = (
    await db.bankAccount.findFirstOrThrow({ where: { id: checkingId }, select: { ledgerAccountId: true } })
  ).ledgerAccountId;

  const lead = await db.lead.create({
    data: { companyId, vertical: "roofing", firstName: "Rita", lastName: "Roofer" },
  });
  jobId = (
    await db.project.create({
      data: { companyId, leadId: lead.id, projectNumber: `R-${rand()}`, vertical: "roofing" },
    })
  ).id;
  vendorId = (await db.bookkeepingVendor.create({ data: { companyId, name: "Ace Supply" } })).id;

  arId = (await systemAccountId(companyId, "accounts_receivable"))!;
  apId = (await systemAccountId(companyId, "accounts_payable"))!;
  materialsId = (await systemAccountId(companyId, "materials"))!;
});

afterAll(async () => {
  await db.$disconnect();
});

let seq = 0;
async function feedRow(opts: { amountCents: number; pending?: boolean; postedAt?: Date }) {
  seq += 1;
  return db.bankFeedTransaction.create({
    data: {
      companyId,
      bankAccountId: checkingId,
      providerTransactionId: `st-${process.pid}-${Date.now()}-${seq}`,
      providerAccountId: "prov-acct",
      postedAt: opts.postedAt ?? DAY,
      amountCents: opts.amountCents,
      description: "TEST ROW",
      pending: opts.pending ?? false,
    },
    select: { id: true },
  });
}

const anInvoice = async (amountCents: number) => {
  const res = await createInvoice({
    companyId, projectId: jobId, invoiceNumber: `INV-${rand()}`,
    amountCents, issuedAt: DAY, actor: actor(),
  });
  if (!res.ok) throw new Error(res.error);
  return res.invoiceId;
};

const aBill = async (amountCents: number) => {
  const res = await createBill({
    companyId, vendorId, billNumber: `B-${rand()}`, amountCents,
    billedAt: DAY, expenseAccountId: materialsId, projectId: jobId, actor: actor(),
  });
  if (!res.ok) throw new Error(res.error);
  return res.billId;
};

const balanceOf = async (accountId: string) =>
  (await accountBalances({ companyId, period: YEAR })).find((r) => r.accountId === accountId)?.balanceCents ?? 0;

const rowState = (id: string) =>
  db.bankFeedTransaction.findFirstOrThrow({
    where: { id },
    select: { status: true, journalEntryId: true, decidedById: true },
  });

/** A financed deal funding 60/40, net of a 25% fee, on a $40,000 contract:
 * net 3,000,000 cents, so M1 expects 1,800,000. */
async function aFinancedDeal() {
  const lender = await db.solarLender.create({
    data: {
      companyId,
      // `solar_lenders` is unique on (companyId, lower(name)).
      name: `Acme Capital ${rand()}`,
      fundsNetOfDealerFee: true,
      fundingM1Pct: 0.6,
      fundingM2Pct: 0.4,
    },
  });
  const product = await db.solarLenderProduct.create({
    data: { companyId, lenderId: lender.id, product: "loan" },
  });
  const lead = await db.lead.create({
    data: { companyId, vertical: "solar", firstName: "Dana", lastName: "Homeowner" },
  });
  await db.solarFinance.create({
    data: {
      companyId, leadId: lead.id, vertical: "solar", product: "loan",
      contractPriceCents: 4_000_000, dealerFeePct: 25, lenderProductId: product.id,
    },
  });
  const synced = await syncExpectedFundings({ companyId, leadId: lead.id });
  if (!synced.ok) throw new Error(synced.error);

  const open = await openFundings(companyId);
  // Found by the figure rather than the milestone name, so this does not depend
  // on how the enum spells its members.
  const m1 = open.find((f) => f.expectedCents === 1_800_000);
  if (!m1) throw new Error(`no M1 expectation; got ${JSON.stringify(open.map((f) => f.expectedCents))}`);
  return m1.id;
}

describe("collecting an invoice from a deposit", () => {
  it("collects it, and takes the row out of the queue pointing at the entry", async () => {
    const invoiceId = await anInvoice(125_000);
    const row = await feedRow({ amountCents: 125_000 });

    const res = await settleFromFeed({
      companyId, feedTransactionId: row.id, target: { kind: "invoice", invoiceId }, actor: actor(),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(await balanceOf(bankLedgerId)).toBe(125_000);
    expect(await balanceOf(arId)).toBe(0);

    const invoice = await db.invoice.findFirstOrThrow({ where: { id: invoiceId } });
    expect(invoice.status).toBe("paid");

    // The one thing that is easy to leave out: the money is in the books AND
    // the queue knows it.
    const after = await rowState(row.id);
    expect(after.status).toBe("posted");
    expect(after.journalEntryId).toBe(res.entryId);
    expect(after.decidedById).toBe(ownerId);
  });

  /** The entry would still balance — it would just move the bank the wrong way. */
  it("refuses to collect an invoice from money LEAVING", async () => {
    const invoiceId = await anInvoice(125_000);
    const row = await feedRow({ amountCents: -125_000 });

    const res = await settleFromFeed({
      companyId, feedTransactionId: row.id, target: { kind: "invoice", invoiceId }, actor: actor(),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("money arriving");

    expect((await rowState(row.id)).status).toBe("review");
    expect(await balanceOf(bankLedgerId)).toBe(0);
  });

  /** Settling in full at a different figure would never reconcile. */
  it("refuses when the bank and the invoice disagree", async () => {
    const invoiceId = await anInvoice(125_000);
    const row = await feedRow({ amountCents: 120_000 });

    const res = await settleFromFeed({
      companyId, feedTransactionId: row.id, target: { kind: "invoice", invoiceId }, actor: actor(),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("part payment");

    expect((await rowState(row.id)).status).toBe("review");
  });

  it("refuses an invoice belonging to another company", async () => {
    const other = await db.company.create({
      data: { name: "Other", slug: `oth-${process.pid}-${Date.now()}-${rand()}` },
    });
    const otherLead = await db.lead.create({
      data: { companyId: other.id, vertical: "roofing", firstName: "Ned", lastName: "Neighbour" },
    });
    const otherJob = await db.project.create({
      data: { companyId: other.id, leadId: otherLead.id, projectNumber: `X-${rand()}`, vertical: "roofing" },
    });
    await ensureChartOfAccounts(other.id);
    const foreign = await createInvoice({
      companyId: other.id, projectId: otherJob.id, invoiceNumber: `INV-${rand()}`,
      amountCents: 125_000, issuedAt: DAY,
      actor: { kind: "system", label: "test" },
    });
    if (!foreign.ok) throw new Error(foreign.error);

    const row = await feedRow({ amountCents: 125_000 });
    const res = await settleFromFeed({
      companyId, feedTransactionId: row.id,
      target: { kind: "invoice", invoiceId: foreign.invoiceId }, actor: actor(),
    });
    expect(res.ok).toBe(false);
    expect((await rowState(row.id)).status).toBe("review");
  });
});

describe("paying a bill from a withdrawal", () => {
  it("pays it, and links the row", async () => {
    const billId = await aBill(60_000);
    const row = await feedRow({ amountCents: -60_000 });

    const res = await settleFromFeed({
      companyId, feedTransactionId: row.id, target: { kind: "bill", billId }, actor: actor(),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(await balanceOf(bankLedgerId)).toBe(-60_000);
    expect(await balanceOf(apId)).toBe(0);

    const bill = await db.bill.findFirstOrThrow({ where: { id: billId } });
    expect(bill.status).toBe("paid");

    const after = await rowState(row.id);
    expect(after.status).toBe("posted");
    expect(after.journalEntryId).toBe(res.entryId);
  });

  it("refuses to pay a bill out of money ARRIVING", async () => {
    const billId = await aBill(60_000);
    const row = await feedRow({ amountCents: 60_000 });

    const res = await settleFromFeed({
      companyId, feedTransactionId: row.id, target: { kind: "bill", billId }, actor: actor(),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("money leaving");

    expect((await rowState(row.id)).status).toBe("review");
  });

  it("refuses when the bank and the bill disagree", async () => {
    const billId = await aBill(60_000);
    const row = await feedRow({ amountCents: -59_000 });

    const res = await settleFromFeed({
      companyId, feedTransactionId: row.id, target: { kind: "bill", billId }, actor: actor(),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("part payment");
  });
});

describe("recognising a lender funding from a deposit", () => {
  /** A deposit that differs from the expectation is the NORMAL case here, so
   * unlike an invoice it is passed through and the gap is posted. */
  it("recognises it at the bank's figure and posts the variance", async () => {
    const fundingId = await aFinancedDeal();
    const row = await feedRow({ amountCents: 1_750_000 });

    const res = await settleFromFeed({
      companyId, feedTransactionId: row.id, target: { kind: "funding", fundingId }, actor: actor(),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.varianceCents).toBe(-50_000);
    expect(await balanceOf(bankLedgerId)).toBe(1_750_000);

    const after = await rowState(row.id);
    expect(after.status).toBe("posted");
    expect(after.journalEntryId).toBe(res.entryId);

    // Both directions of the link, which is what `recogniseFunding` alone
    // could not do.
    const funding = await db.lenderFunding.findFirstOrThrow({ where: { id: fundingId } });
    expect(funding.bankFeedTransactionId).toBe(row.id);
    expect(funding.journalEntryId).toBe(res.entryId);
  });

  it("refuses a funding from money LEAVING", async () => {
    const fundingId = await aFinancedDeal();
    const row = await feedRow({ amountCents: -1_750_000 });

    const res = await settleFromFeed({
      companyId, feedTransactionId: row.id, target: { kind: "funding", fundingId }, actor: actor(),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("money arriving");
  });
});

describe("the queue's own rules still apply", () => {
  /** An authorisation may never settle; booking one puts money in the books
   * that never moved. */
  it("refuses a row still pending at the bank", async () => {
    const invoiceId = await anInvoice(125_000);
    const row = await feedRow({ amountCents: 125_000, pending: true });

    const res = await settleFromFeed({
      companyId, feedTransactionId: row.id, target: { kind: "invoice", invoiceId }, actor: actor(),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("pending");
  });

  it("refuses to settle the same row twice", async () => {
    const invoiceId = await anInvoice(125_000);
    const row = await feedRow({ amountCents: 125_000 });

    expect((await settleFromFeed({
      companyId, feedTransactionId: row.id, target: { kind: "invoice", invoiceId }, actor: actor(),
    })).ok).toBe(true);

    const again = await settleFromFeed({
      companyId, feedTransactionId: row.id, target: { kind: "invoice", invoiceId }, actor: actor(),
    });
    expect(again.ok).toBe(false);

    // And the bank moved once.
    expect(await balanceOf(bankLedgerId)).toBe(125_000);
  });
});

describe("what a row could be settling", () => {
  it("offers a receivable for money in, and never a payable", async () => {
    await anInvoice(125_000);
    await aBill(125_000);

    const found = await settlementCandidatesFor({ companyId, amountCents: 125_000 });
    expect(found.invoices).toHaveLength(1);
    expect(found.invoices[0]?.customerName).toBe("Rita Roofer");
    expect(found.bills).toHaveLength(0);
  });

  it("offers a payable for money out, and never a receivable", async () => {
    await anInvoice(60_000);
    await aBill(60_000);

    const found = await settlementCandidatesFor({ companyId, amountCents: -60_000 });
    expect(found.bills).toHaveLength(1);
    expect(found.bills[0]?.vendorName).toBe("Ace Supply");
    expect(found.invoices).toHaveLength(0);
  });

  it("does not offer an item of a different amount", async () => {
    await anInvoice(125_000);

    const found = await settlementCandidatesFor({ companyId, amountCents: 120_000 });
    expect(found.invoices).toHaveLength(0);
  });

  it("does not offer another company's open items", async () => {
    await anInvoice(125_000);

    const other = await db.company.create({
      data: { name: "Other", slug: `oth-${process.pid}-${Date.now()}-${rand()}` },
    });
    const found = await settlementCandidatesFor({ companyId: other.id, amountCents: 125_000 });
    expect(found.invoices).toHaveLength(0);
    expect(found.bills).toHaveLength(0);
  });
});
