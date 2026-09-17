import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { Role } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";

/**
 * THE A/R AND A/P ACTION SURFACE.
 *
 * What this file is for, and what it deliberately does not repeat. The ledger
 * behaviour of invoices, bills and funding is covered next door in
 * invoices.itest.ts, bills.itest.ts and funding.itest.ts. This tests the DOOR:
 * that the ten exports refuse the people they should refuse, that the tenant
 * comes from the session rather than the caller, that dollars become cents once,
 * and that a typed date lands in the period the typist meant.
 *
 * WHY IT IS NOT A BROWSER TEST. Every export of a `"use server"` module is a
 * public RPC endpoint, reachable whether or not any page will render for the
 * caller. Playwright cannot invoke one faithfully — Next derives action ids from
 * the build and the browser never names them. Calling the exported function
 * directly against a real database is the honest reproduction of what someone
 * with a session actually has.
 *
 * `can()` IS NOT MOCKED. The matrix decides, exactly as it does in production.
 * That matters most for `accountant_readonly`: the reviewed exception in
 * row-scope-boundary.test.ts for createInvoiceAction rests on the claim that
 * everyone holding `Bookkeeping:create` sees every job in the company, and that
 * claim is only true while the outside CPA holds read and export alone. If
 * someone grants that role `create`, these tests are what fails.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

/** Who `requireUser()` answers with on the next call. */
let current: { userId: string; companyId: string; role: Role; permissions: Record<string, unknown> };

vi.mock("@/server/auth/session", () => ({
  requireUser: async () => current,
  getSessionUser: async () => current,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const { ensureChartOfAccounts, systemAccountId } = await import("../chart");
const { accountBalances } = await import("../reports");
const A = await import("../ar-ap-actions");

const rand = () => Math.random().toString(36).slice(2, 8);

let companyId: string;
let jobId: string;
let vendorId: string;
let bankId: string;
let arId: string;
let apId: string;
let revenueId: string;
let materialsId: string;
const users: Partial<Record<Role, string>> = {};

const YEAR = { startMs: Date.UTC(2026, 0, 1), endMs: Date.UTC(2026, 11, 31, 23, 59, 59, 999) };
const MARCH = { startMs: Date.UTC(2026, 2, 1), endMs: Date.UTC(2026, 2, 31, 23, 59, 59, 999) };
const FEBRUARY = { startMs: Date.UTC(2026, 1, 1), endMs: Date.UTC(2026, 1, 28, 23, 59, 59, 999) };

const actAs = (role: Role) => {
  current = { userId: users[role]!, companyId, role, permissions: {} };
};

const balanceOf = async (accountId: string, period = YEAR) =>
  (await accountBalances({ companyId, period })).find((r) => r.accountId === accountId)?.balanceCents ?? 0;

beforeEach(async () => {
  const company = await db.company.create({
    data: { name: "Door Co", slug: `door-${process.pid}-${Date.now()}-${rand()}` },
  });
  companyId = company.id;

  for (const role of ["super_admin", "accounting", "accountant_readonly", "sales_rep"] as Role[]) {
    users[role] = (
      await db.user.create({
        data: {
          companyId,
          email: `${role}-${process.pid}-${rand()}@door.test`,
          passwordHash: "x",
          firstName: role,
          lastName: "User",
          role,
          verticals: ["roofing", "solar"],
        },
      })
    ).id;
  }

  await ensureChartOfAccounts(companyId);

  const lead = await db.lead.create({
    data: { companyId, vertical: "solar", firstName: "Dana", lastName: "Homeowner" },
  });
  jobId = (
    await db.project.create({
      data: { companyId, leadId: lead.id, projectNumber: `S-${rand()}`, vertical: "solar" },
    })
  ).id;

  vendorId = (await db.bookkeepingVendor.create({ data: { companyId, name: "Ace Supply" } })).id;
  bankId = (await db.ledgerAccount.findFirstOrThrow({ where: { companyId, number: "1010" } })).id;
  arId = (await systemAccountId(companyId, "accounts_receivable"))!;
  apId = (await systemAccountId(companyId, "accounts_payable"))!;
  revenueId = (await systemAccountId(companyId, "solar_revenue"))!;
  materialsId = (await systemAccountId(companyId, "materials"))!;

  actAs("accounting");
});

afterAll(async () => {
  await db.$disconnect();
});

/**
 * Every write on the surface, with arguments good enough to get past the schema
 * if the caller were allowed. `gate()` runs BEFORE the zod parse in every
 * action, which is what makes this table meaningful: a refusal here is the
 * permission refusing, never a validation error standing in for one.
 */
const everyWrite = () => [
  ["createInvoiceAction", () =>
    A.createInvoiceAction({ projectId: jobId, invoiceNumber: `I-${rand()}`, amount: 100, issuedAt: "2026-03-10" })],
  ["postInvoiceAccrualAction", () => A.postInvoiceAccrualAction({ invoiceId: "whatever" })],
  ["receiveInvoicePaymentAction", () =>
    A.receiveInvoicePaymentAction({ invoiceId: "whatever", bankLedgerAccountId: bankId, date: "2026-05-20" })],
  ["voidInvoiceAction", () => A.voidInvoiceAction({ invoiceId: "whatever", reason: "test" })],
  ["createBillAction", () =>
    A.createBillAction({
      vendorId, billNumber: `B-${rand()}`, amount: 100, billedAt: "2026-03-10", expenseSystemKey: "materials",
    })],
  ["postBillAccrualAction", () => A.postBillAccrualAction({ billId: "whatever" })],
  ["payBillAction", () =>
    A.payBillAction({ billId: "whatever", bankLedgerAccountId: bankId, date: "2026-05-20" })],
  ["voidBillAction", () => A.voidBillAction({ billId: "whatever", reason: "test" })],
  ["syncExpectedFundingsAction", () => A.syncExpectedFundingsAction({ leadId: "whatever" })],
  ["recogniseFundingAction", () =>
    A.recogniseFundingAction({
      fundingId: "whatever", bankLedgerAccountId: bankId, received: 100, date: "2026-05-20",
    })],
] as const;

describe("who may open the door", () => {
  it("has a case for every export on the surface", () => {
    // A write added to the module without a line in the table above would be
    // untested by the two suites below, and would read as covered.
    const exported = Object.keys(A).filter((k) => k.endsWith("Action")).sort();
    expect(everyWrite().map(([n]) => n).sort()).toEqual(exported);
  });

  it("refuses a sales rep every write", async () => {
    actAs("sales_rep");
    for (const [name, call] of everyWrite()) {
      const res = await call();
      expect(res.ok, `${name} let a sales_rep through`).toBe(false);
      if (!res.ok) expect(res.error, name).toBe("Not allowed.");
    }
  });

  /**
   * The outside CPA reads and exports and does NOTHING else. This is the test
   * the reviewed row-scope exception depends on.
   */
  it("refuses the read-only accountant every write", async () => {
    actAs("accountant_readonly");
    for (const [name, call] of everyWrite()) {
      const res = await call();
      expect(res.ok, `${name} let accountant_readonly through`).toBe(false);
      if (!res.ok) expect(res.error, name).toBe("Not allowed.");
    }
  });

  it("writes nothing at all when it refuses", async () => {
    actAs("sales_rep");
    for (const [, call] of everyWrite()) await call();
    expect(await db.invoice.count({ where: { companyId } })).toBe(0);
    expect(await db.bill.count({ where: { companyId } })).toBe(0);
    expect(await db.journalEntry.count({ where: { companyId } })).toBe(0);
  });

  it("lets accounting and the owner in", async () => {
    for (const role of ["accounting", "super_admin"] as Role[]) {
      actAs(role);
      const res = await A.createInvoiceAction({
        projectId: jobId, invoiceNumber: `I-${rand()}`, amount: 10, issuedAt: "2026-03-10",
      });
      expect(res.ok, `${role} was refused`).toBe(true);
    }
  });
});

describe("raising an invoice through the door", () => {
  it("converts dollars to cents exactly once", async () => {
    const res = await A.createInvoiceAction({
      projectId: jobId, invoiceNumber: `I-${rand()}`, amount: 1234.56, issuedAt: "2026-03-10",
    });
    expect(res.ok).toBe(true);

    // Asserted on the LEDGER rather than on the invoice row: the ledger is
    // unambiguously integer cents, so this cannot pass by reading a column that
    // happens to hold dollars.
    expect(await balanceOf(arId)).toBe(123_456);
    expect(await balanceOf(revenueId)).toBe(123_456);
  });

  /** A rounding case that a naive `* 100` gets wrong. */
  it("does not lose a cent to floating point", async () => {
    const res = await A.createInvoiceAction({
      projectId: jobId, invoiceNumber: `I-${rand()}`, amount: 0.07, issuedAt: "2026-03-10",
    });
    expect(res.ok).toBe(true);
    expect(await balanceOf(arId)).toBe(7);
  });

  /**
   * A typed date is a CALENDAR DAY. Parsed at midnight it lands on the previous
   * day for anyone behind UTC, filing the invoice in the wrong month. Checked by
   * period rather than by UTC day number, which would depend on the machine's
   * timezone and so would pass or fail by accident.
   */
  it("files the invoice in the month that was typed", async () => {
    await A.createInvoiceAction({
      projectId: jobId, invoiceNumber: `I-${rand()}`, amount: 500, issuedAt: "2026-03-01",
    });
    expect(await balanceOf(revenueId, MARCH)).toBe(50_000);
    expect(await balanceOf(revenueId, FEBRUARY)).toBe(0);
  });

  it("sends revenue to the job's department, not the reader's workspace", async () => {
    await A.createInvoiceAction({
      projectId: jobId, invoiceNumber: `I-${rand()}`, amount: 200, issuedAt: "2026-03-10",
    });
    const roofing = (await systemAccountId(companyId, "roofing_revenue"))!;
    expect(await balanceOf(revenueId)).toBe(20_000);
    expect(await balanceOf(roofing)).toBe(0);
  });

  it("records a draft without posting it", async () => {
    const res = await A.createInvoiceAction({
      projectId: jobId, invoiceNumber: `I-${rand()}`, amount: 300, issuedAt: "2026-03-10", status: "draft",
    });
    expect(res.ok).toBe(true);
    expect(await balanceOf(arId)).toBe(0);

    if (res.ok) {
      const posted = await A.postInvoiceAccrualAction({ invoiceId: res.invoiceId });
      expect(posted.ok).toBe(true);
      expect(await balanceOf(arId)).toBe(30_000);
    }
  });

  it("refuses an amount that is not money, and writes nothing", async () => {
    const num = `I-${rand()}`;
    const res = await A.createInvoiceAction({
      projectId: jobId, invoiceNumber: num, amount: 0, issuedAt: "2026-03-10",
    });
    expect(res.ok).toBe(false);
    expect(await db.invoice.count({ where: { companyId, invoiceNumber: num } })).toBe(0);
  });
});

describe("clearing and voiding", () => {
  it("clears the receivable into the bank when the customer pays", async () => {
    const raised = await A.createInvoiceAction({
      projectId: jobId, invoiceNumber: `I-${rand()}`, amount: 400, issuedAt: "2026-03-10",
    });
    expect(raised.ok).toBe(true);
    if (!raised.ok) return;

    const paid = await A.receiveInvoicePaymentAction({
      invoiceId: raised.invoiceId, bankLedgerAccountId: bankId, date: "2026-05-20",
    });
    expect(paid.ok).toBe(true);
    expect(await balanceOf(arId)).toBe(0);
    expect(await balanceOf(bankId)).toBe(40_000);
  });

  /** Void is a reversing entry. The row stays, and so does the history. */
  it("voids by reversal and never by deletion", async () => {
    const raised = await A.createInvoiceAction({
      projectId: jobId, invoiceNumber: `I-${rand()}`, amount: 400, issuedAt: "2026-03-10",
    });
    expect(raised.ok).toBe(true);
    if (!raised.ok) return;

    const voided = await A.voidInvoiceAction({ invoiceId: raised.invoiceId, reason: "raised in error" });
    expect(voided.ok).toBe(true);

    const row = await db.invoice.findUnique({ where: { id: raised.invoiceId } });
    expect(row, "the invoice row was deleted").not.toBeNull();
    expect(row!.status).toBe("void");
    expect(await balanceOf(arId)).toBe(0);
    expect(await balanceOf(revenueId)).toBe(0);
    // Two entries, not zero: the original and its reversal both remain.
    expect(await db.journalEntry.count({ where: { companyId } })).toBe(2);
  });

  it("insists on a reason", async () => {
    const raised = await A.createInvoiceAction({
      projectId: jobId, invoiceNumber: `I-${rand()}`, amount: 400, issuedAt: "2026-03-10",
    });
    expect(raised.ok, "the invoice could not be raised, so the empty reason was never exercised").toBe(true);
    if (!raised.ok) return;
    const res = await A.voidInvoiceAction({ invoiceId: raised.invoiceId, reason: "" });
    expect(res.ok).toBe(false);
  });
});

describe("bills through the door", () => {
  it("accrues the cost and owes it, then settles it from the bank", async () => {
    const entered = await A.createBillAction({
      vendorId, billNumber: `B-${rand()}`, amount: 1250, billedAt: "2026-03-10", expenseSystemKey: "materials",
    });
    expect(entered.ok).toBe(true);
    if (!entered.ok) return;

    expect(await balanceOf(materialsId)).toBe(125_000);
    expect(await balanceOf(apId)).toBe(125_000);
    expect(await balanceOf(bankId)).toBe(0);

    const paid = await A.payBillAction({
      billId: entered.billId, bankLedgerAccountId: bankId, date: "2026-05-20",
    });
    expect(paid.ok).toBe(true);
    expect(await balanceOf(apId)).toBe(0);
    expect(await balanceOf(bankId)).toBe(-125_000);
  });

  it("accrues a draft bill only when asked", async () => {
    const entered = await A.createBillAction({
      vendorId, billNumber: `B-${rand()}`, amount: 90, billedAt: "2026-03-10",
      expenseSystemKey: "materials", status: "draft",
    });
    expect(entered.ok).toBe(true);
    if (!entered.ok) return;
    expect(await balanceOf(apId)).toBe(0);

    const accrued = await A.postBillAccrualAction({ billId: entered.billId });
    expect(accrued.ok).toBe(true);
    expect(await balanceOf(apId)).toBe(9_000);
  });

  /** Guessing an account would file a cost somewhere nobody would look again. */
  it("refuses a bill with nowhere to put the cost", async () => {
    const res = await A.createBillAction({
      vendorId, billNumber: `B-${rand()}`, amount: 90, billedAt: "2026-03-10",
    });
    expect(res.ok).toBe(false);
  });

  it("voids a bill by reversal", async () => {
    const entered = await A.createBillAction({
      vendorId, billNumber: `B-${rand()}`, amount: 90, billedAt: "2026-03-10", expenseSystemKey: "materials",
    });
    expect(entered.ok, "the bill could not be entered, so the void was never exercised").toBe(true);
    if (!entered.ok) return;
    const res = await A.voidBillAction({ billId: entered.billId, reason: "duplicate" });
    expect(res.ok).toBe(true);
    expect(await balanceOf(apId)).toBe(0);
    const row = await db.bill.findUnique({ where: { id: entered.billId } });
    expect(row!.status).toBe("void");
  });
});

describe("the tenant comes from the session", () => {
  /**
   * The point of the whole gate. No export takes a companyId — it is read from
   * the session every time — so an id belonging to another company must be
   * unreachable even for a caller who legitimately holds Bookkeeping here.
   */
  it("cannot touch another company's invoice", async () => {
    const other = await db.company.create({
      data: { name: "Other Co", slug: `other-${process.pid}-${Date.now()}-${rand()}` },
    });
    await ensureChartOfAccounts(other.id);
    const otherLead = await db.lead.create({
      data: { companyId: other.id, vertical: "solar", firstName: "Not", lastName: "Ours" },
    });
    const otherJob = await db.project.create({
      data: { companyId: other.id, leadId: otherLead.id, projectNumber: `X-${rand()}`, vertical: "solar" },
    });
    const theirs = await db.invoice.create({
      data: {
        companyId: other.id,
        projectId: otherJob.id,
        invoiceNumber: `O-${rand()}`,
        amount: 50_000,
        issuedAt: new Date("2026-03-10T12:00:00Z"),
        status: "sent",
      },
    });

    actAs("accounting");
    const voided = await A.voidInvoiceAction({ invoiceId: theirs.id, reason: "not mine" });
    expect(voided.ok).toBe(false);

    const paid = await A.receiveInvoicePaymentAction({
      invoiceId: theirs.id, bankLedgerAccountId: bankId, date: "2026-05-20",
    });
    expect(paid.ok).toBe(false);

    // Untouched, and no entry landed in either company.
    const after = await db.invoice.findUnique({ where: { id: theirs.id } });
    expect(after!.status).toBe("sent");
    expect(await db.journalEntry.count({ where: { companyId: other.id } })).toBe(0);
  });

  it("cannot pay another company's bill", async () => {
    const other = await db.company.create({
      data: { name: "Other Co 2", slug: `other2-${process.pid}-${Date.now()}-${rand()}` },
    });
    const otherVendor = await db.bookkeepingVendor.create({ data: { companyId: other.id, name: "Their Supply" } });
    const theirs = await db.bill.create({
      data: {
        companyId: other.id,
        vendorId: otherVendor.id,
        billNumber: `OB-${rand()}`,
        amountCents: 50_000,
        billedAt: new Date("2026-03-10T12:00:00Z"),
        status: "open",
      },
    });

    actAs("accounting");
    const res = await A.payBillAction({
      billId: theirs.id, bankLedgerAccountId: bankId, date: "2026-05-20",
    });
    expect(res.ok).toBe(false);
    expect((await db.bill.findUnique({ where: { id: theirs.id } }))!.status).toBe("open");
  });
});

describe("lender funding through the door", () => {
  /**
   * A deal with no financing has no funding expectation. The action must hand
   * back the module's refusal rather than throwing — the caller is a form.
   */
  it("refuses a deal that has no financing, without throwing", async () => {
    const lead = await db.lead.create({
      data: { companyId, vertical: "solar", firstName: "No", lastName: "Finance" },
    });
    const res = await A.syncExpectedFundingsAction({ leadId: lead.id });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(typeof res.error).toBe("string");
  });

  it("refuses a deposit against a milestone that is not ours", async () => {
    const res = await A.recogniseFundingAction({
      fundingId: "nope", bankLedgerAccountId: bankId, received: 100, date: "2026-05-20",
    });
    expect(res.ok).toBe(false);
  });
});
