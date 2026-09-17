import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { accruePayrollRun, payPayrollRun } from "../payroll-posting";
import { ensureChartOfAccounts, systemAccountId, type SystemAccountKey } from "../chart";
import { createBankAccount } from "../bank-accounts";

/**
 * PAYROLL AS TWO EVENTS, IN A REAL DATABASE.
 *
 * The single-entry ledger this replaces wrote one negative row when a run was
 * marked paid, which made three things inexpressible, and all three are pinned
 * here:
 *
 *   • an APPROVED but unpaid run — money genuinely owed — existed nowhere in
 *     the books, so the balance sheet could not show a liability the company
 *     had already committed to;
 *   • a deduction booked the GROSS while the bank showed the net, overstating
 *     commission expense by exactly the deduction and leaving the
 *     reconciliation permanently unable to close;
 *   • paying was indistinguishable from incurring, so the payable never came
 *     back down.
 *
 * ── THE ONE THAT INVERTS SILENTLY ───────────────────────────────────────────
 * A rep's commission is an EXPENSE; a subcontractor's invoice is a JOB COST.
 * Both lines are tagged with the deal, so the tag is not the difference — the
 * ACCOUNT CLASS is. Swap them and every job looks worse the better it was sold,
 * gross margin moves for reasons nobody can trace, and each individual entry
 * still balances perfectly. Nothing but an assertion on the account's type
 * catches it, so that is asserted directly.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let projectId: string;
let repId: string;
let contractorId: string;
let ownerId: string;
let bankAccountId: string;

const owner = () => ({ kind: "user" as const, userId: ownerId, role: "super_admin" as const });

const COMMISSION = 1_000_000; // $10,000
const CONTRACTOR = 250_000; //   $2,500

/** A fresh company per test — the isolation, and no raw SQL. See journal-posting.itest.ts. */
beforeEach(async () => {
  const company = await db.company.create({
    data: { name: "Payroll Books Co", slug: `paybooks-${process.pid}-${Date.now()}`, overheadPct: 0, paFeePct: 0 },
  });
  companyId = company.id;

  const mkUser = async (first: string, role: "sales_rep" | "super_admin" | "installer") =>
    (
      await db.user.create({
        data: {
          companyId,
          email: `${first}-${process.pid}-${Date.now()}@t.local`,
          passwordHash: "x",
          firstName: first,
          lastName: "P",
          role,
          verticals: ["roofing", "solar"],
        },
        select: { id: true },
      })
    ).id;

  repId = await mkUser("Rhea", "sales_rep");
  // A contractor is not a role — it is whoever uploaded the invoice, which is
  // what makes the attribution un-fakeable. `installer` is the login they hold.
  contractorId = await mkUser("Cass", "installer");
  ownerId = await mkUser("Ola", "super_admin");

  const pipeline = await db.pipeline.create({ data: { companyId, name: "Solar", vertical: "solar" } });
  const stage = await db.pipelineStage.create({
    data: { pipelineId: pipeline.id, key: "m1", name: "M1 Funding", position: 10 },
  });
  const lead = await db.lead.create({
    data: { companyId, vertical: "solar", pipelineId: pipeline.id, stageId: stage.id, firstName: "Pay", lastName: "Roll" },
  });
  projectId = (
    await db.project.create({
      data: { companyId, vertical: "solar", leadId: lead.id, projectNumber: `PAY-${Date.now()}` },
    })
  ).id;

  await ensureChartOfAccounts(companyId);

  const bank = await createBankAccount({
    companyId,
    name: "Truist Operating",
    institution: "Truist",
    mask: "4321",
    kind: "checking",
    defaultVertical: null,
    openingBalanceCents: 0,
    openingBalanceDate: null,
    actor: owner(),
  });
  if (!bank.ok) throw new Error(`bank fixture failed: ${bank.error}`);
  bankAccountId = bank.bankAccountId;
});

afterAll(async () => {
  await db.$disconnect();
});

async function makeRun(status: "approved" | "paid" = "approved") {
  return db.payrollRun.create({
    data: {
      companyId,
      label: "Week 1",
      periodStart: new Date(Date.UTC(2026, 0, 5)),
      periodEnd: new Date(Date.UTC(2026, 0, 9, 23, 59, 59, 999)),
      status,
      paidAt: new Date(Date.UTC(2026, 0, 16)),
    },
    select: { id: true },
  });
}

async function addCommissionLine(runId: string, amount = COMMISSION) {
  const commission = await db.commission.create({
    data: { companyId, projectId, userId: repId, amount, baseAmount: amount, status: "approved", label: "Solar redline" },
    select: { id: true },
  });
  return db.payrollItem.create({
    data: { payrollRunId: runId, userId: repId, commissionId: commission.id, label: "Solar redline", amount },
    select: { id: true },
  });
}

/** A contractor line needs the invoice it pays: the bill IS the record. */
async function addContractorLine(runId: string, amount = CONTRACTOR) {
  const invoice = await db.fileAsset.create({
    data: { companyId, name: "invoice-4821.pdf", storageKey: `k/${Date.now()}`, projectId },
    select: { id: true },
  });
  const pay = await db.contractorPay.create({
    data: { companyId, invoiceId: invoice.id, userId: contractorId, projectId, amount, status: "approved" },
    select: { id: true },
  });
  return db.payrollItem.create({
    data: { payrollRunId: runId, userId: contractorId, contractorPayId: pay.id, label: "Contractor invoice", amount },
    select: { id: true },
  });
}

async function addAdjustment(
  runId: string,
  kind: "bonus" | "deduction" | "chargeback_recovery",
  magnitude: number,
  reason = "Trenching"
) {
  return db.payrollAdjustment.create({
    data: {
      companyId,
      payrollRunId: runId,
      userId: repId,
      kind,
      // Signed exactly as `addPayrollAdjustment` writes it.
      amountCents: kind === "bonus" ? magnitude : -magnitude,
      reason,
      projectId,
      createdById: ownerId,
    },
    select: { id: true },
  });
}

/**
 * The id of a system account, or a loud failure.
 *
 * `systemAccountId` returns null when the chart is missing the key, and a null
 * dropped into a `where` does not narrow the query — it widens it. These totals
 * would then be summed over accounts they were never meant to touch, and the
 * assertions would keep passing while measuring the wrong number.
 */
async function accountIdFor(key: SystemAccountKey): Promise<string> {
  const id = await systemAccountId(companyId, key);
  if (!id) throw new Error(`system account "${key}" is missing from the chart`);
  return id;
}

/** Debits and credits landing on one system account, all time. */
async function totals(key: SystemAccountKey) {
  const agg = await db.journalLine.aggregate({
    where: { companyId, accountId: await accountIdFor(key) },
    _sum: { debitCents: true, creditCents: true },
  });
  return { debit: agg._sum?.debitCents ?? 0, credit: agg._sum?.creditCents ?? 0 };
}

/** What a payable still owes: credits minus debits. */
async function owing(key: SystemAccountKey) {
  const t = await totals(key);
  return t.credit - t.debit;
}

const entriesFor = (runId: string) =>
  db.journalEntry.findMany({
    where: { companyId, sourceId: { startsWith: `payroll:${runId}` } },
    select: { id: true, sourceType: true, sourceId: true, memo: true },
    orderBy: { sourceId: "asc" },
  });

describe("accruePayrollRun", () => {
  it("books a commission to expense and a payable, not to the bank", async () => {
    const run = await makeRun();
    await addCommissionLine(run.id);

    const res = await accruePayrollRun(companyId, run.id, owner());
    expect(res.posted).toBe(1);
    expect(res.errors).toEqual([]);

    expect(await totals("commissions_expense")).toEqual({ debit: COMMISSION, credit: 0 });
    expect(await owing("commissions_payable")).toBe(COMMISSION);

    // Nothing has left the bank yet — that is the entire point of accruing.
    const bank = await db.bankAccount.findUniqueOrThrow({
      where: { id: bankAccountId },
      select: { ledgerAccountId: true },
    });
    const bankLines = await db.journalLine.count({ where: { companyId, accountId: bank.ledgerAccountId } });
    expect(bankLines).toBe(0);
  });

  it("costs subcontractor labour to the JOB but commission to overhead", async () => {
    const run = await makeRun();
    await addCommissionLine(run.id);
    await addContractorLine(run.id);
    await accruePayrollRun(companyId, run.id, owner());

    const [commissionAccount, labourAccount] = await Promise.all([
      db.ledgerAccount.findUniqueOrThrow({
        where: { id: await accountIdFor("commissions_expense") },
        select: { type: true },
      }),
      db.ledgerAccount.findUniqueOrThrow({
        where: { id: await accountIdFor("subcontractor_labor") },
        select: { type: true },
      }),
    ]);

    // THE INVERSION THIS FILE EXISTS TO CATCH. Both lines are deal-tagged, both
    // balance; only the class distinguishes them.
    expect(labourAccount.type).toBe("cogs");
    expect(commissionAccount.type).toBe("expense");

    expect(await totals("subcontractor_labor")).toEqual({ debit: CONTRACTOR, credit: 0 });
    expect(await owing("payroll_payable")).toBe(CONTRACTOR);
    expect(await owing("commissions_payable")).toBe(COMMISSION);
  });

  it("tags both expense lines with the deal", async () => {
    const run = await makeRun();
    await addCommissionLine(run.id);
    await addContractorLine(run.id);
    await accruePayrollRun(companyId, run.id, owner());

    const expenseLines = await db.journalLine.findMany({
      where: { companyId, debitCents: { gt: 0 }, account: { systemKey: { in: ["commissions_expense", "subcontractor_labor"] } } },
      select: { projectId: true },
    });
    expect(expenseLines).toHaveLength(2);
    expect(expenseLines.every((l) => l.projectId === projectId)).toBe(true);
  });

  it("brings the expense AND the liability back down for a deduction", async () => {
    const run = await makeRun();
    await addCommissionLine(run.id);
    await addAdjustment(run.id, "deduction", 100_000); // $1,000 trenching

    await accruePayrollRun(companyId, run.id, owner());

    // The books must agree with what the bank will actually pay: net, not gross.
    expect(await owing("commissions_payable")).toBe(COMMISSION - 100_000);
    const expense = await totals("commissions_expense");
    expect(expense.debit - expense.credit).toBe(COMMISSION - 100_000);
  });

  it("adds a bonus on the normal sides", async () => {
    const run = await makeRun();
    await addAdjustment(run.id, "bonus", 50_000);
    await accruePayrollRun(companyId, run.id, owner());

    expect(await totals("commissions_expense")).toEqual({ debit: 50_000, credit: 0 });
    expect(await owing("commissions_payable")).toBe(50_000);
  });

  it("books a chargeback recovery against Chargebacks, not Commissions", async () => {
    const run = await makeRun();
    await addAdjustment(run.id, "chargeback_recovery", 75_000, "Cancelled deal");
    await accruePayrollRun(companyId, run.id, owner());

    // A recovery is money coming BACK, so the expense account is credited.
    const chargebacks = await totals("commission_chargebacks");
    expect(chargebacks.credit).toBe(75_000);
    expect(await owing("commissions_payable")).toBe(-75_000);
    expect(await totals("commissions_expense")).toEqual({ debit: 0, credit: 0 });
  });

  it("keys entries verbatim and posts nothing twice", async () => {
    const run = await makeRun();
    const item = await addCommissionLine(run.id);
    const adj = await addAdjustment(run.id, "bonus", 25_000);

    const first = await accruePayrollRun(companyId, run.id, owner());
    expect(first.posted).toBe(2);

    const keys = (await entriesFor(run.id)).map((e) => e.sourceId);
    // The spelling `payroll/post-bookkeeping.ts` already used. Changing it would
    // re-post every run that had posted under the old ledger.
    expect(keys).toContain(`payroll:${run.id}:item:${item.id}`);
    expect(keys).toContain(`payroll:${run.id}:adj:${adj.id}`);

    const second = await accruePayrollRun(companyId, run.id, owner());
    expect(second.posted).toBe(0);
    expect(second.skipped).toBe(2);
    expect(await entriesFor(run.id)).toHaveLength(2);
    expect(await owing("commissions_payable")).toBe(COMMISSION + 25_000);
  });

  it("resumes a post that died half way rather than refusing the whole run", async () => {
    const run = await makeRun();
    await addCommissionLine(run.id);
    await accruePayrollRun(companyId, run.id, owner());

    // A second line arrives after the first post — the case the old
    // "has this run posted anything? then stop" guard got wrong.
    await addCommissionLine(run.id, 400_000);
    const res = await accruePayrollRun(companyId, run.id, owner());

    expect(res.posted).toBe(1);
    expect(res.skipped).toBe(1);
    expect(await owing("commissions_payable")).toBe(COMMISSION + 400_000);
  });

  it("skips a zero line instead of writing an empty entry", async () => {
    const run = await makeRun();
    await addCommissionLine(run.id, 0);
    const res = await accruePayrollRun(companyId, run.id, owner());

    expect(res.posted).toBe(0);
    expect(res.skipped).toBe(1);
    expect(await entriesFor(run.id)).toHaveLength(0);
  });
});

describe("payPayrollRun", () => {
  it("clears the payables and reduces the bank in ONE entry", async () => {
    const run = await makeRun("paid");
    await addCommissionLine(run.id);
    await addContractorLine(run.id);
    await accruePayrollRun(companyId, run.id, owner());

    const res = await payPayrollRun({
      companyId,
      runId: run.id,
      bankAccountId,
      date: new Date(Date.UTC(2026, 0, 16)),
      actor: owner(),
    });
    expect(res.ok).toBe(true);

    // Both payables settled…
    expect(await owing("commissions_payable")).toBe(0);
    expect(await owing("payroll_payable")).toBe(0);

    // …and the money left the bank once, as one statement line.
    const bank = await db.bankAccount.findUniqueOrThrow({
      where: { id: bankAccountId },
      select: { ledgerAccountId: true },
    });
    const bankLines = await db.journalLine.findMany({
      where: { companyId, accountId: bank.ledgerAccountId },
      select: { creditCents: true, debitCents: true },
    });
    expect(bankLines).toHaveLength(1);
    expect(bankLines[0]).toEqual({ creditCents: COMMISSION + CONTRACTOR, debitCents: 0 });
  });

  it("pays the NET when the run carries a deduction", async () => {
    const run = await makeRun("paid");
    await addCommissionLine(run.id);
    await addAdjustment(run.id, "deduction", 100_000);
    await accruePayrollRun(companyId, run.id, owner());

    await payPayrollRun({
      companyId, runId: run.id, bankAccountId,
      date: new Date(Date.UTC(2026, 0, 16)), actor: owner(),
    });

    const bank = await db.bankAccount.findUniqueOrThrow({
      where: { id: bankAccountId },
      select: { ledgerAccountId: true },
    });
    const paid = await db.journalLine.aggregate({
      where: { companyId, accountId: bank.ledgerAccountId },
      _sum: { creditCents: true },
    });
    expect(paid._sum.creditCents).toBe(COMMISSION - 100_000);
    expect(await owing("commissions_payable")).toBe(0);
  });

  it("refuses to pay a run that was never accrued", async () => {
    const run = await makeRun("paid");
    await addCommissionLine(run.id);

    const res = await payPayrollRun({
      companyId, runId: run.id, bankAccountId,
      date: new Date(), actor: owner(),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/accrue it first/i);
  });

  it("does not pay the same run twice", async () => {
    const run = await makeRun("paid");
    await addCommissionLine(run.id);
    await accruePayrollRun(companyId, run.id, owner());

    const args = {
      companyId, runId: run.id, bankAccountId,
      date: new Date(Date.UTC(2026, 0, 16)), actor: owner(),
    };
    const first = await payPayrollRun(args);
    const second = await payPayrollRun(args);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.duplicate).toBe(true);

    const payments = await db.journalEntry.count({
      where: { companyId, sourceType: "payroll_payment" },
    });
    expect(payments).toBe(1);
    expect(await owing("commissions_payable")).toBe(0);
  });

  it("refuses an unknown bank account", async () => {
    const run = await makeRun("paid");
    await addCommissionLine(run.id);
    await accruePayrollRun(companyId, run.id, owner());

    const res = await payPayrollRun({
      companyId, runId: run.id, bankAccountId: "no-such-account",
      date: new Date(), actor: owner(),
    });
    expect(res.ok).toBe(false);
  });
});
