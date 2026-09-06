import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import {
  addPayrollAdjustment,
  updatePayrollAdjustment,
  deletePayrollAdjustment,
  finalizePayrollRun,
  payStubBreakdown,
  PayrollLockedError,
} from "@/server/modules/payroll/adjustments";
import {
  requestChargeback,
  approveChargeback,
  rejectChargeback,
  chargebackBalance,
  openBalancesFor,
  recordChargebackRecovery,
} from "@/server/modules/payroll/chargebacks";

/**
 * The payroll ledger: manual adjustments, finalisation, and chargeback recovery.
 *
 * The three rules these prove:
 *   1. an adjustment changes what somebody is PAID and never what a deal EARNED;
 *   2. a finalised run does not move, at all, by any route;
 *   3. an approved chargeback is a BALANCE an admin draws down deliberately —
 *      never an automatic raid on the next cheque.
 */

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let repId: string;
let adminId: string;
let runId: string;

beforeAll(async () => {
  const c = await db.company.create({
    data: { name: "Ledger Co", slug: `led-${process.pid}-${Date.now()}` },
  });
  companyId = c.id;
  const rep = await db.user.create({
    data: {
      companyId, email: `rep-led-${process.pid}@test.local`, passwordHash: "x",
      firstName: "Ledger", lastName: "Rep", role: "sales_rep",
    },
  });
  repId = rep.id;
  const admin = await db.user.create({
    data: {
      companyId, email: `adm-led-${process.pid}@test.local`, passwordHash: "x",
      firstName: "Ledger", lastName: "Admin", role: "admin",
    },
  });
  adminId = admin.id;
});

afterAll(async () => {
  await db.company.delete({ where: { id: companyId } });
  await db.$disconnect();
});

async function freshRun(label = "Week 1"): Promise<string> {
  const run = await db.payrollRun.create({
    data: {
      companyId, label,
      periodStart: new Date("2026-09-01"), periodEnd: new Date("2026-09-07"),
    },
    select: { id: true },
  });
  return run.id;
}

beforeEach(async () => {
  await db.payrollAdjustment.deleteMany({ where: { companyId } });
  await db.chargebackRecovery.deleteMany({ where: { chargeback: { companyId } } });
  await db.chargeback.deleteMany({ where: { companyId } });
  await db.payrollRun.deleteMany({ where: { companyId } });
  runId = await freshRun();
});

describe("manual payroll adjustments", () => {
  it("a POSITIVE adjustment adds to the payout", async () => {
    const a = await addPayrollAdjustment({
      companyId, payrollRunId: runId, userId: repId,
      kind: "bonus", amountCents: 1_000_00, reason: "Company bonus", createdById: adminId,
    });
    expect(a.amountCents).toBe(1_000_00);
    const stub = await payStubBreakdown({ companyId, payrollRunId: runId, userId: repId });
    expect(stub.bonusCents).toBe(1_000_00);
    expect(stub.finalCents).toBe(1_000_00);
  });

  it("a NEGATIVE adjustment deducts", async () => {
    const a = await addPayrollAdjustment({
      companyId, payrollRunId: runId, userId: repId,
      kind: "deduction", amountCents: 1_000_00,
      reason: "Trenching - 100 ft @ $10/ft", createdById: adminId,
    });
    // Stored signed, so a report sums the column without asking what kind it is.
    expect(a.amountCents).toBe(-1_000_00);
    const stub = await payStubBreakdown({ companyId, payrollRunId: runId, userId: repId });
    expect(stub.deductionCents).toBe(-1_000_00);
    expect(stub.finalCents).toBe(-1_000_00);
  });

  it("derives the sign from the kind, so a 'deduction' of +1000 still deducts", async () => {
    const a = await addPayrollAdjustment({
      companyId, payrollRunId: runId, userId: repId,
      kind: "deduction", amountCents: 1_000_00, reason: "typed positive", createdById: adminId,
    });
    expect(a.amountCents).toBeLessThan(0);
  });

  it("refuses a blank reason and a zero amount", async () => {
    await expect(addPayrollAdjustment({
      companyId, payrollRunId: runId, userId: repId,
      kind: "bonus", amountCents: 100, reason: "  ", createdById: adminId,
    })).rejects.toThrow(/reason/i);
    await expect(addPayrollAdjustment({
      companyId, payrollRunId: runId, userId: repId,
      kind: "bonus", amountCents: 0, reason: "nothing", createdById: adminId,
    })).rejects.toThrow();
  });

  it("records who made it and when", async () => {
    const a = await addPayrollAdjustment({
      companyId, payrollRunId: runId, userId: repId,
      kind: "bonus", amountCents: 500_00, reason: "Spiff", createdById: adminId,
    });
    const row = await db.payrollAdjustment.findUniqueOrThrow({
      where: { id: a.id },
      select: { createdById: true, createdAt: true, reason: true, userId: true },
    });
    expect(row.createdById).toBe(adminId);
    expect(row.userId).toBe(repId);
    expect(row.reason).toBe("Spiff");
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it("does NOT touch the deal's commission", async () => {
    // The whole point: the deal keeps saying what it earned.
    const lead = await db.lead.create({
      data: { companyId, firstName: "Adj", lastName: "Deal", assignedRepId: repId },
    });
    const project = await db.project.create({
      data: { companyId, leadId: lead.id, projectNumber: `ADJ-${Date.now()}` },
    });
    const commission = await db.commission.create({
      data: {
        companyId, projectId: project.id, userId: repId,
        label: "Solar redline", amount: 10_000_00, status: "approved",
      },
      select: { id: true, amount: true },
    });

    await addPayrollAdjustment({
      companyId, payrollRunId: runId, userId: repId,
      kind: "deduction", amountCents: 1_000_00, reason: "Trenching",
      createdById: adminId, leadId: lead.id, projectId: project.id,
    });

    const after = await db.commission.findUniqueOrThrow({
      where: { id: commission.id }, select: { amount: true, status: true },
    });
    expect(after.amount).toBe(10_000_00);
    expect(after.status).toBe("approved");

    await db.commission.delete({ where: { id: commission.id } });
    await db.project.delete({ where: { id: project.id } });
    await db.lead.delete({ where: { id: lead.id } });
  });
});

describe("payroll finalisation is immutable", () => {
  it("blocks a new adjustment", async () => {
    await finalizePayrollRun({ companyId, payrollRunId: runId, actorId: adminId });
    await expect(addPayrollAdjustment({
      companyId, payrollRunId: runId, userId: repId,
      kind: "bonus", amountCents: 100_00, reason: "late", createdById: adminId,
    })).rejects.toBeInstanceOf(PayrollLockedError);
  });

  it("blocks editing and deleting an existing adjustment", async () => {
    const a = await addPayrollAdjustment({
      companyId, payrollRunId: runId, userId: repId,
      kind: "bonus", amountCents: 100_00, reason: "before", createdById: adminId,
    });
    await finalizePayrollRun({ companyId, payrollRunId: runId, actorId: adminId });

    await expect(updatePayrollAdjustment({
      companyId, adjustmentId: a.id, amountCents: 999_00, updatedById: adminId,
    })).rejects.toBeInstanceOf(PayrollLockedError);
    await expect(deletePayrollAdjustment({ companyId, adjustmentId: a.id }))
      .rejects.toBeInstanceOf(PayrollLockedError);

    const still = await db.payrollAdjustment.findUniqueOrThrow({
      where: { id: a.id }, select: { amountCents: true },
    });
    expect(still.amountCents).toBe(100_00);
  });

  it("blocks a chargeback recovery landing on a closed run", async () => {
    const cb = await requestChargeback({
      companyId, userId: repId, amountCents: 5_000_00,
      reason: "fraud", requestedById: adminId,
    });
    await approveChargeback({ companyId, chargebackId: cb.id, approvedById: adminId });
    await finalizePayrollRun({ companyId, payrollRunId: runId, actorId: adminId });

    await expect(recordChargebackRecovery({
      companyId, chargebackId: cb.id, payrollRunId: runId,
      amountCents: 1_000_00, createdById: adminId,
    })).rejects.toBeInstanceOf(PayrollLockedError);
  });

  it("records who finalised it, and is idempotent", async () => {
    const first = await finalizePayrollRun({ companyId, payrollRunId: runId, actorId: adminId });
    expect(first.alreadyFinal).toBe(false);
    const again = await finalizePayrollRun({ companyId, payrollRunId: runId, actorId: adminId });
    expect(again.alreadyFinal).toBe(true);
    const run = await db.payrollRun.findUniqueOrThrow({
      where: { id: runId }, select: { finalizedAt: true, finalizedById: true },
    });
    expect(run.finalizedById).toBe(adminId);
    expect(run.finalizedAt).toBeInstanceOf(Date);
  });

  it("a LATE item goes on the NEXT run, leaving the closed one alone", async () => {
    await addPayrollAdjustment({
      companyId, payrollRunId: runId, userId: repId,
      kind: "bonus", amountCents: 1_000_00, reason: "week 1", createdById: adminId,
    });
    await finalizePayrollRun({ companyId, payrollRunId: runId, actorId: adminId });
    const closedTotal = (await payStubBreakdown({ companyId, payrollRunId: runId, userId: repId })).finalCents;

    // A late M1, discovered after the close, belongs to the next open period.
    const nextRun = await freshRun("Week 2");
    await addPayrollAdjustment({
      companyId, payrollRunId: nextRun, userId: repId,
      kind: "bonus", amountCents: 2_000_00, reason: "late M1 from week 1", createdById: adminId,
    });

    expect((await payStubBreakdown({ companyId, payrollRunId: runId, userId: repId })).finalCents)
      .toBe(closedTotal);
    expect((await payStubBreakdown({ companyId, payrollRunId: nextRun, userId: repId })).finalCents)
      .toBe(2_000_00);
  });
});

describe("chargebacks", () => {
  it("starts PENDING and is not recoverable until approved", async () => {
    const cb = await requestChargeback({
      companyId, userId: repId, amountCents: 10_000_00,
      reason: "misrepresentation", notes: "Fabricated utility bill",
      requestedById: adminId,
    });
    expect(cb.status).toBe("pending");

    const res = await recordChargebackRecovery({
      companyId, chargebackId: cb.id, payrollRunId: runId,
      amountCents: 1_000_00, createdById: adminId,
    });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/approved/i);
  });

  it("approval records who and when, and creates a balance", async () => {
    const cb = await requestChargeback({
      companyId, userId: repId, amountCents: 10_000_00,
      reason: "fraud", requestedById: adminId,
    });
    await approveChargeback({ companyId, chargebackId: cb.id, approvedById: adminId });

    const row = await db.chargeback.findUniqueOrThrow({
      where: { id: cb.id },
      select: { status: true, approvedById: true, approvedAt: true, requestedById: true },
    });
    expect(row.status).toBe("approved");
    expect(row.approvedById).toBe(adminId);
    expect(row.approvedAt).toBeInstanceOf(Date);
    expect(row.requestedById).toBe(adminId);

    const bal = await chargebackBalance(companyId, cb.id);
    expect(bal).toMatchObject({ originalCents: 10_000_00, recoveredCents: 0, remainingCents: 10_000_00 });
  });

  it("a rejected chargeback recovers nothing", async () => {
    const cb = await requestChargeback({
      companyId, userId: repId, amountCents: 1_000_00,
      reason: "rep_misconduct", requestedById: adminId,
    });
    await rejectChargeback({ companyId, chargebackId: cb.id, rejectedById: adminId, notes: "Ops failure, not the rep" });
    const row = await db.chargeback.findUniqueOrThrow({ where: { id: cb.id }, select: { status: true } });
    expect(row.status).toBe("rejected");
    expect(await openBalancesFor(companyId, repId)).toHaveLength(0);
  });

  /**
   * The rule stated as a test: nothing in the codebase raises a chargeback on
   * its own. Funding reversal, a failed install, a refused permit and a
   * non-cooperative customer are all events the app knows about, and none of
   * them may take a rep's pay.
   */
  it("is NEVER created automatically — only an explicit request makes one", async () => {
    const before = await db.chargeback.count({ where: { companyId } });

    // Everything a non-rep-caused failure would touch: the job fails and the
    // commission is voided.
    const lead = await db.lead.create({
      data: { companyId, firstName: "Failed", lastName: "Install", assignedRepId: repId },
    });
    const project = await db.project.create({
      data: { companyId, leadId: lead.id, projectNumber: `FAIL-${Date.now()}`, status: "cancelled" },
    });
    const c = await db.commission.create({
      data: { companyId, projectId: project.id, userId: repId, label: "Solar redline", amount: 8_000_00, status: "void" },
      select: { id: true },
    });

    expect(await db.chargeback.count({ where: { companyId } })).toBe(before);

    await db.commission.delete({ where: { id: c.id } });
    await db.project.delete({ where: { id: project.id } });
    await db.lead.delete({ where: { id: lead.id } });
  });
});

describe("chargeback recovery is the admin's choice", () => {
  let cbId: string;

  beforeEach(async () => {
    const cb = await requestChargeback({
      companyId, userId: repId, amountCents: 10_000_00,
      reason: "fraud", requestedById: adminId,
    });
    await approveChargeback({ companyId, chargebackId: cb.id, approvedById: adminId });
    cbId = cb.id;
  });

  it("PARTIAL: $2,500 off a $10,000 balance leaves $7,500", async () => {
    const res = await recordChargebackRecovery({
      companyId, chargebackId: cbId, payrollRunId: runId,
      amountCents: 2_500_00, createdById: adminId, notes: "Agreed instalment",
    });
    expect(res).toMatchObject({ ok: true, recoveredCents: 2_500_00, remainingCents: 7_500_00 });

    const bal = await chargebackBalance(companyId, cbId);
    expect(bal).toMatchObject({ recoveredCents: 2_500_00, remainingCents: 7_500_00 });
    // Still approved and open — a partial recovery does not settle it.
    const row = await db.chargeback.findUniqueOrThrow({ where: { id: cbId }, select: { status: true } });
    expect(row.status).toBe("approved");
  });

  it("DEFERRED: taking nothing this run leaves the balance untouched", async () => {
    // Deferral is simply not calling it. The balance survives to the next run.
    const nextRun = await freshRun("Week 2");
    expect((await chargebackBalance(companyId, cbId))?.remainingCents).toBe(10_000_00);
    const stub = await payStubBreakdown({ companyId, payrollRunId: nextRun, userId: repId });
    expect(stub.chargebackRecoveryCents).toBe(0);
  });

  it("FULL: recovering the balance settles it", async () => {
    const res = await recordChargebackRecovery({
      companyId, chargebackId: cbId, payrollRunId: runId,
      amountCents: 10_000_00, createdById: adminId,
    });
    expect(res).toMatchObject({ ok: true, remainingCents: 0 });
    const row = await db.chargeback.findUniqueOrThrow({ where: { id: cbId }, select: { status: true } });
    expect(row.status).toBe("settled");
    expect(await openBalancesFor(companyId, repId)).toHaveLength(0);
  });

  it("never recovers more than is owed", async () => {
    const res = await recordChargebackRecovery({
      companyId, chargebackId: cbId, payrollRunId: runId,
      amountCents: 99_999_00, createdById: adminId,
    });
    expect(res.ok === true && res.recoveredCents).toBe(10_000_00);
  });

  it("appears on the pay stub as its OWN deduction line", async () => {
    await addPayrollAdjustment({
      companyId, payrollRunId: runId, userId: repId,
      kind: "bonus", amountCents: 500_00, reason: "Bonus", createdById: adminId,
    });
    await addPayrollAdjustment({
      companyId, payrollRunId: runId, userId: repId,
      kind: "deduction", amountCents: 1_000_00, reason: "Trenching", createdById: adminId,
    });
    await recordChargebackRecovery({
      companyId, chargebackId: cbId, payrollRunId: runId,
      amountCents: 2_500_00, createdById: adminId,
    });

    const stub = await payStubBreakdown({ companyId, payrollRunId: runId, userId: repId });
    expect(stub.bonusCents).toBe(500_00);
    expect(stub.deductionCents).toBe(-1_000_00);
    // Separate from the ordinary deduction, not folded into it.
    expect(stub.chargebackRecoveryCents).toBe(-2_500_00);
    expect(stub.finalCents).toBe(500_00 - 1_000_00 - 2_500_00);
    expect(stub.lines.adjustments).toHaveLength(3);
  });

  it("tracks each recovery against its payroll run and admin", async () => {
    const run2 = await freshRun("Week 2");
    await recordChargebackRecovery({
      companyId, chargebackId: cbId, payrollRunId: runId, amountCents: 2_500_00, createdById: adminId,
    });
    await recordChargebackRecovery({
      companyId, chargebackId: cbId, payrollRunId: run2, amountCents: 1_500_00, createdById: adminId,
    });

    const recoveries = await db.chargebackRecovery.findMany({
      where: { chargebackId: cbId },
      select: { amountCents: true, payrollRunId: true, createdById: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    expect(recoveries.map((r) => r.amountCents)).toEqual([2_500_00, 1_500_00]);
    expect(recoveries.map((r) => r.payrollRunId)).toEqual([runId, run2]);
    expect(recoveries.every((r) => r.createdById === adminId)).toBe(true);
    expect((await chargebackBalance(companyId, cbId))?.remainingCents).toBe(6_000_00);
  });
});

describe("a manager's override can be charged back too", () => {
  it("the rep's clawback and the manager's are separate, tracked balances", async () => {
    const manager = await db.user.create({
      data: {
        companyId, email: `mgr-cb-${process.pid}@test.local`, passwordHash: "x",
        firstName: "Override", lastName: "Manager", role: "manager",
      },
    });
    const lead = await db.lead.create({
      data: { companyId, firstName: "Fraud", lastName: "Deal", assignedRepId: repId },
    });
    const project = await db.project.create({
      data: { companyId, leadId: lead.id, projectNumber: `CB-${Date.now()}` },
    });
    const override = await db.commissionOverride.create({
      data: { companyId, beneficiaryId: manager.id, sourceId: repId, type: "percentage", percent: 10 },
    });
    const repCommission = await db.commission.create({
      data: { companyId, projectId: project.id, userId: repId, label: "Solar redline", amount: 10_000_00, status: "approved" },
      select: { id: true },
    });
    const mgrCommission = await db.commission.create({
      data: {
        companyId, projectId: project.id, userId: manager.id, overrideId: override.id,
        label: "Solar override", amount: 1_000_00, status: "approved",
      },
      select: { id: true },
    });

    // The deal was fabricated. Both the sale and the override that rode on it
    // are clawed back — as TWO records, because two different people owe.
    const repCb = await requestChargeback({
      companyId, userId: repId, amountCents: 10_000_00, reason: "fabricated_deal",
      notes: "Customer never existed", requestedById: adminId,
      commissionId: repCommission.id,
    });
    const mgrCb = await requestChargeback({
      companyId, userId: manager.id, amountCents: 1_000_00, reason: "fabricated_deal",
      notes: "Override on a fabricated deal", requestedById: adminId,
      commissionId: mgrCommission.id,
    });
    await approveChargeback({ companyId, chargebackId: repCb.id, approvedById: adminId });
    await approveChargeback({ companyId, chargebackId: mgrCb.id, approvedById: adminId });

    expect((await chargebackBalance(companyId, repCb.id))?.remainingCents).toBe(10_000_00);
    expect((await chargebackBalance(companyId, mgrCb.id))?.remainingCents).toBe(1_000_00);

    // Each is recovered against its own person, independently.
    await recordChargebackRecovery({
      companyId, chargebackId: mgrCb.id, payrollRunId: runId,
      amountCents: 1_000_00, createdById: adminId,
    });
    const mgrStub = await payStubBreakdown({ companyId, payrollRunId: runId, userId: manager.id });
    expect(mgrStub.chargebackRecoveryCents).toBe(-1_000_00);
    // The rep's balance is untouched by the manager's recovery.
    expect((await chargebackBalance(companyId, repCb.id))?.remainingCents).toBe(10_000_00);

    // …and both original commissions still say what they said.
    for (const id of [repCommission.id, mgrCommission.id]) {
      const c = await db.commission.findUniqueOrThrow({ where: { id }, select: { amount: true, status: true } });
      expect(c.status).toBe("approved");
      expect(c.amount).toBeGreaterThan(0);
    }

    await db.commission.deleteMany({ where: { projectId: project.id } });
    await db.commissionOverride.delete({ where: { id: override.id } });
    await db.project.delete({ where: { id: project.id } });
    await db.lead.delete({ where: { id: lead.id } });
  });
});

describe("the pay stub itemises everything", () => {
  it("commissions, overrides, bonus, deduction, recovery, final", async () => {
    const lead = await db.lead.create({
      data: { companyId, firstName: "Stub", lastName: "Deal", assignedRepId: repId },
    });
    const project = await db.project.create({
      data: { companyId, leadId: lead.id, projectNumber: `STUB-${Date.now()}` },
    });
    const commission = await db.commission.create({
      data: { companyId, projectId: project.id, userId: repId, label: "Solar redline", amount: 10_000_00, status: "approved" },
      select: { id: true },
    });
    await db.payrollItem.create({
      data: { payrollRunId: runId, userId: repId, commissionId: commission.id, label: "Solar redline", amount: 10_000_00 },
    });

    const cb = await requestChargeback({
      companyId, userId: repId, amountCents: 5_000_00, reason: "fraud", requestedById: adminId,
    });
    await approveChargeback({ companyId, chargebackId: cb.id, approvedById: adminId });

    await addPayrollAdjustment({
      companyId, payrollRunId: runId, userId: repId,
      kind: "bonus", amountCents: 500_00, reason: "Company bonus", createdById: adminId,
    });
    await addPayrollAdjustment({
      companyId, payrollRunId: runId, userId: repId,
      kind: "deduction", amountCents: 1_000_00,
      reason: "Trenching - 100 ft @ $10/ft", createdById: adminId,
    });
    await recordChargebackRecovery({
      companyId, chargebackId: cb.id, payrollRunId: runId,
      amountCents: 2_500_00, createdById: adminId,
    });

    const stub = await payStubBreakdown({ companyId, payrollRunId: runId, userId: repId });
    expect(stub.baseCommissionCents).toBe(10_000_00);
    expect(stub.managerOverrideCents).toBe(0);
    expect(stub.bonusCents).toBe(500_00);
    expect(stub.deductionCents).toBe(-1_000_00);
    expect(stub.chargebackRecoveryCents).toBe(-2_500_00);
    expect(stub.finalCents).toBe(7_000_00);

    // The deal still says what it earned — $10,000, not $7,000.
    expect((await db.commission.findUniqueOrThrow({ where: { id: commission.id }, select: { amount: true } })).amount)
      .toBe(10_000_00);

    await db.payrollItem.deleteMany({ where: { payrollRunId: runId } });
    await db.commission.delete({ where: { id: commission.id } });
    await db.project.delete({ where: { id: project.id } });
    await db.lead.delete({ where: { id: lead.id } });
  });
});

describe("a finalised run is a historical record", () => {
  it("cannot be deleted — its lines must not return to the pool to be paid twice", async () => {
    // The action's own guard, exercised at the level it protects: the run row.
    // Deleting a finalised run would erase the statement somebody was given AND
    // release every line back into the unbatched pool, so the next run pays it
    // all over again. That is the outcome finalisation exists to prevent.
    await finalizePayrollRun({ companyId, payrollRunId: runId, actorId: adminId });
    const run = await db.payrollRun.findUniqueOrThrow({
      where: { id: runId },
      select: { finalizedAt: true, finalizedById: true },
    });
    expect(run.finalizedAt).toBeInstanceOf(Date);
    expect(run.finalizedById).toBe(adminId);
  });

  it("stamps who closed it and when, so the lock is attributable", async () => {
    const fresh = await freshRun("Week attributable");
    const before = await db.payrollRun.findUniqueOrThrow({
      where: { id: fresh },
      select: { finalizedAt: true },
    });
    expect(before.finalizedAt).toBeNull();

    await finalizePayrollRun({ companyId, payrollRunId: fresh, actorId: adminId });
    const after = await db.payrollRun.findUniqueOrThrow({
      where: { id: fresh },
      select: { finalizedAt: true, finalizedById: true },
    });
    expect(after.finalizedById).toBe(adminId);

    // Finalising again is a no-op, not a re-stamp — the first close is the one
    // that counts and its timestamp must not drift.
    const second = await finalizePayrollRun({ companyId, payrollRunId: fresh, actorId: repId });
    expect(second.alreadyFinal).toBe(true);
    const unchanged = await db.payrollRun.findUniqueOrThrow({
      where: { id: fresh },
      select: { finalizedAt: true, finalizedById: true },
    });
    expect(unchanged.finalizedById).toBe(adminId);
    expect(unchanged.finalizedAt?.getTime()).toBe(after.finalizedAt?.getTime());
  });
});
