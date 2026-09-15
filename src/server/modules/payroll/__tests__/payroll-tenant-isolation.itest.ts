import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { Role } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";

/**
 * NO PAYROLL WRITE MAY NAME ANOTHER COMPANY'S RECORDS.
 *
 * Every function in the ledger takes the company from the session, and every
 * lookup of the ROW BEING CHANGED was already scoped to it. What was not scoped
 * was everything else the caller hands in: the payee, the deal, the job, the
 * commission a chargeback claws back. A payroll admin at Company A could raise a
 * chargeback against Company B's rep, or tag an adjustment to B's deal, and the
 * write went through with a foreign key into another tenant.
 *
 * Proved two ways — the ledger functions directly, and the server actions a
 * browser reaches — for an admin AND a super admin, because an elevated role is
 * more power inside a company, never a way out of it. Each refusal also checks
 * that nothing was written.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

const session = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock("@/server/auth/session", () => session);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const {
  addPayrollAdjustment,
  updatePayrollAdjustment,
  deletePayrollAdjustment,
  finalizePayrollRun,
} = await import("@/server/modules/payroll/adjustments");
const { requestChargeback, approveChargeback, rejectChargeback, recordChargebackRecovery } = await import(
  "@/server/modules/payroll/chargebacks"
);
const { getPayStubData } = await import("@/server/modules/payroll/paystub");
const ledger = await import("@/server/modules/payroll/ledger-actions");

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

type Tenant = {
  companyId: string;
  adminId: string;
  superAdminId: string;
  repId: string;
  leadId: string;
  otherLeadId: string;
  projectId: string;
  commissionId: string;
  runId: string;
  chargebackId: string;
  adjustmentId: string;
};

let A: Tenant;
let B: Tenant;

const tag = `${process.pid}-${Date.now()}`;

async function makeTenant(name: string): Promise<Tenant> {
  const company = await db.company.create({ data: { name, slug: `iso-${name}-${tag}`.toLowerCase() } });
  const companyId = company.id;
  const user = (role: Role, who: string) =>
    db.user.create({
      data: {
        companyId, role, passwordHash: "x", firstName: who, lastName: name,
        email: `${who}-${name}-${tag}@test.local`.toLowerCase(),
      },
      select: { id: true },
    });
  const [admin, superAdmin, rep] = [await user("admin", "admin"), await user("super_admin", "super"), await user("sales_rep", "rep")];

  const lead = await db.lead.create({
    data: { companyId, vertical: "solar", firstName: "Deal", lastName: name, assignedRepId: rep.id },
  });
  const otherLead = await db.lead.create({
    data: { companyId, vertical: "solar", firstName: "Other", lastName: name, assignedRepId: rep.id },
  });
  const project = await db.project.create({
    data: { companyId, vertical: "solar", leadId: lead.id, projectNumber: `ISO-${name}-${tag}` },
  });
  const commission = await db.commission.create({
    data: { companyId, projectId: project.id, userId: rep.id, label: "Solar redline", amount: 10_000_00, status: "approved" },
  });
  const run = await db.payrollRun.create({
    data: { companyId, label: `${name} week`, periodStart: new Date("2026-09-01"), periodEnd: new Date("2026-09-07") },
  });
  const chargeback = await db.chargeback.create({
    data: {
      companyId, userId: rep.id, amountCents: 5_000_00, reason: "fraud", status: "approved",
      requestedById: admin.id, approvedById: admin.id, approvedAt: new Date(),
    },
  });
  const adjustment = await db.payrollAdjustment.create({
    data: { companyId, payrollRunId: run.id, userId: rep.id, kind: "bonus", amountCents: 250_00, reason: "Spiff", createdById: admin.id },
  });

  return {
    companyId, adminId: admin.id, superAdminId: superAdmin.id, repId: rep.id,
    leadId: lead.id, otherLeadId: otherLead.id, projectId: project.id, commissionId: commission.id,
    runId: run.id, chargebackId: chargeback.id, adjustmentId: adjustment.id,
  };
}

/** Act as A's admin (or super admin) in the server actions. */
function actAs(role: "admin" | "super_admin") {
  session.requireUser.mockResolvedValue({
    userId: role === "admin" ? A.adminId : A.superAdminId,
    companyId: A.companyId,
    role,
    permissions: {},
    fullName: `A ${role}`,
  });
}

/** A refusal, whether the layer throws or returns `{ ok: false }`. */
async function refused(p: Promise<unknown>): Promise<boolean> {
  try {
    const res = await p;
    return !!res && typeof res === "object" && "ok" in res && (res as { ok: boolean }).ok === false;
  } catch {
    return true;
  }
}

/** Everything a refused write might have left behind, per company. */
async function ledgerCounts(companyId: string) {
  const [adjustments, chargebacks, recoveries] = await Promise.all([
    db.payrollAdjustment.count({ where: { companyId } }),
    db.chargeback.count({ where: { companyId } }),
    db.chargebackRecovery.count({ where: { chargeback: { companyId } } }),
  ]);
  return { adjustments, chargebacks, recoveries };
}

beforeAll(async () => {
  A = await makeTenant("Alpha");
  B = await makeTenant("Bravo");
});

afterAll(async () => {
  await db.company.deleteMany({ where: { id: { in: [A.companyId, B.companyId] } } });
  await db.$disconnect();
});

describe("the ledger still works inside one company (so the refusals below mean something)", () => {
  it("an adjustment tagged to A's own deal and job is accepted", async () => {
    const a = await addPayrollAdjustment({
      companyId: A.companyId, payrollRunId: A.runId, userId: A.repId, kind: "deduction",
      amountCents: 100_00, reason: "Same-company control", createdById: A.adminId,
      leadId: A.leadId, projectId: A.projectId,
    });
    expect(a.amountCents).toBe(-100_00);
    await db.payrollAdjustment.delete({ where: { id: a.id } });
  });

  it("a chargeback on A's own commission is accepted", async () => {
    const cb = await requestChargeback({
      companyId: A.companyId, userId: A.repId, amountCents: 1_00, reason: "fraud",
      requestedById: A.adminId, commissionId: A.commissionId,
    });
    expect(cb.status).toBe("pending");
    await db.chargeback.delete({ where: { id: cb.id } });
  });
});

describe("addPayrollAdjustment refuses another company's references", () => {
  const base = () => ({
    companyId: A.companyId, payrollRunId: A.runId, userId: A.repId, kind: "bonus" as const,
    amountCents: 500_00, reason: "Cross-tenant attempt", createdById: A.adminId,
  });

  it.each([
    ["B's user as the payee", () => ({ userId: B.repId })],
    ["B's deal", () => ({ leadId: B.leadId })],
    ["B's job", () => ({ projectId: B.projectId })],
    ["B's payroll run", () => ({ payrollRunId: B.runId })],
    ["B's chargeback", () => ({ chargebackId: B.chargebackId })],
    ["A's deal with B's job", () => ({ leadId: A.leadId, projectId: B.projectId })],
  ])("%s", async (_label, over) => {
    const before = [await ledgerCounts(A.companyId), await ledgerCounts(B.companyId)];
    expect(await refused(addPayrollAdjustment({ ...base(), ...over() }))).toBe(true);
    expect([await ledgerCounts(A.companyId), await ledgerCounts(B.companyId)]).toEqual(before);
  });

  it("a job from a DIFFERENT deal in the same company is refused too", async () => {
    const before = await ledgerCounts(A.companyId);
    expect(await refused(addPayrollAdjustment({ ...base(), leadId: A.otherLeadId, projectId: A.projectId }))).toBe(true);
    expect(await ledgerCounts(A.companyId)).toEqual(before);
  });
});

describe("editing and removing refuse another company's adjustment", () => {
  it("updatePayrollAdjustment cannot touch B's line", async () => {
    expect(
      await refused(updatePayrollAdjustment({
        companyId: A.companyId, adjustmentId: B.adjustmentId, amountCents: 9_999_00, reason: "hijack", updatedById: A.adminId,
      }))
    ).toBe(true);
    const row = await db.payrollAdjustment.findUniqueOrThrow({ where: { id: B.adjustmentId } });
    expect(row.amountCents).toBe(250_00);
    expect(row.reason).toBe("Spiff");
    expect(row.updatedById).toBeNull();
  });

  it("deletePayrollAdjustment cannot remove B's line", async () => {
    expect(await refused(deletePayrollAdjustment({ companyId: A.companyId, adjustmentId: B.adjustmentId }))).toBe(true);
    expect(await db.payrollAdjustment.count({ where: { id: B.adjustmentId } })).toBe(1);
  });
});

describe("requestChargeback refuses another company's references", () => {
  const base = () => ({
    companyId: A.companyId, userId: A.repId, amountCents: 1_000_00, reason: "fraud" as const, requestedById: A.adminId,
  });

  it.each([
    ["B's rep as the person who owes it", () => ({ userId: B.repId })],
    ["B's commission", () => ({ commissionId: B.commissionId })],
    ["B's deal", () => ({ leadId: B.leadId })],
    ["B's job", () => ({ projectId: B.projectId })],
  ])("%s", async (_label, over) => {
    const before = [await ledgerCounts(A.companyId), await ledgerCounts(B.companyId)];
    expect(await refused(requestChargeback({ ...base(), ...over() }))).toBe(true);
    expect([await ledgerCounts(A.companyId), await ledgerCounts(B.companyId)]).toEqual(before);
  });

  it("approving or rejecting B's chargeback does nothing to it", async () => {
    const pending = await db.chargeback.create({
      data: { companyId: B.companyId, userId: B.repId, amountCents: 700_00, reason: "fraud", status: "pending", requestedById: B.adminId },
    });
    expect(await refused(approveChargeback({ companyId: A.companyId, chargebackId: pending.id, approvedById: A.adminId }))).toBe(true);
    expect(await refused(rejectChargeback({ companyId: A.companyId, chargebackId: pending.id, rejectedById: A.adminId }))).toBe(true);
    const row = await db.chargeback.findUniqueOrThrow({ where: { id: pending.id } });
    expect(row.status).toBe("pending");
    expect(row.approvedById).toBeNull();
    expect(row.rejectedById).toBeNull();
    await db.chargeback.delete({ where: { id: pending.id } });
  });
});

describe("recovery and finalisation refuse another company's records", () => {
  it("A cannot recover against B's chargeback", async () => {
    const before = [await ledgerCounts(A.companyId), await ledgerCounts(B.companyId)];
    expect(
      await refused(recordChargebackRecovery({
        companyId: A.companyId, chargebackId: B.chargebackId, payrollRunId: A.runId, amountCents: 100_00, createdById: A.adminId,
      }))
    ).toBe(true);
    expect([await ledgerCounts(A.companyId), await ledgerCounts(B.companyId)]).toEqual(before);
  });

  it("A cannot land a recovery on B's payroll run", async () => {
    const before = [await ledgerCounts(A.companyId), await ledgerCounts(B.companyId)];
    expect(
      await refused(recordChargebackRecovery({
        companyId: A.companyId, chargebackId: A.chargebackId, payrollRunId: B.runId, amountCents: 100_00, createdById: A.adminId,
      }))
    ).toBe(true);
    expect([await ledgerCounts(A.companyId), await ledgerCounts(B.companyId)]).toEqual(before);
  });

  it("A cannot finalise B's run", async () => {
    expect(await refused(finalizePayrollRun({ companyId: A.companyId, payrollRunId: B.runId, actorId: A.adminId }))).toBe(true);
    const run = await db.payrollRun.findUniqueOrThrow({ where: { id: B.runId } });
    expect(run.finalizedAt).toBeNull();
  });

  it("A cannot read B's pay stub, by B's run or by B's payee", async () => {
    expect(await getPayStubData(A.companyId, B.runId, B.repId)).toBeNull();
    expect(await getPayStubData(A.companyId, A.runId, B.repId)).toBeNull();
  });
});

describe.each(["admin", "super_admin"] as const)("the server actions, as A's %s", (role) => {
  it("addPayrollAdjustmentAction refuses B's payee, deal and job — and writes nothing", async () => {
    actAs(role);
    const before = [await ledgerCounts(A.companyId), await ledgerCounts(B.companyId)];
    const input = { payrollRunId: A.runId, userId: A.repId, kind: "bonus" as const, amountCents: 100_00, reason: "Cross-tenant" };
    expect(await refused(ledger.addPayrollAdjustmentAction({ ...input, userId: B.repId }))).toBe(true);
    expect(await refused(ledger.addPayrollAdjustmentAction({ ...input, leadId: B.leadId }))).toBe(true);
    expect(await refused(ledger.addPayrollAdjustmentAction({ ...input, projectId: B.projectId }))).toBe(true);
    expect(await refused(ledger.addPayrollAdjustmentAction({ ...input, payrollRunId: B.runId }))).toBe(true);
    expect([await ledgerCounts(A.companyId), await ledgerCounts(B.companyId)]).toEqual(before);
  });

  it("updatePayrollAdjustmentAction and deletePayrollAdjustmentAction refuse B's line", async () => {
    actAs(role);
    expect(await refused(ledger.updatePayrollAdjustmentAction({ adjustmentId: B.adjustmentId, payrollRunId: A.runId, amountCents: 1_00 }))).toBe(true);
    expect(await refused(ledger.deletePayrollAdjustmentAction(B.adjustmentId, A.runId))).toBe(true);
    const row = await db.payrollAdjustment.findUniqueOrThrow({ where: { id: B.adjustmentId } });
    expect(row.amountCents).toBe(250_00);
  });

  it("requestChargebackAction refuses B's rep, commission, deal and job", async () => {
    actAs(role);
    const before = [await ledgerCounts(A.companyId), await ledgerCounts(B.companyId)];
    const input = { userId: A.repId, amountCents: 100_00, reason: "fraud" };
    expect(await refused(ledger.requestChargebackAction({ ...input, userId: B.repId }))).toBe(true);
    expect(await refused(ledger.requestChargebackAction({ ...input, commissionId: B.commissionId }))).toBe(true);
    expect(await refused(ledger.requestChargebackAction({ ...input, leadId: B.leadId }))).toBe(true);
    expect(await refused(ledger.requestChargebackAction({ ...input, projectId: B.projectId }))).toBe(true);
    expect([await ledgerCounts(A.companyId), await ledgerCounts(B.companyId)]).toEqual(before);
  });

  it("approve / reject / recover / finalise actions refuse B's records", async () => {
    actAs(role);
    const before = [await ledgerCounts(A.companyId), await ledgerCounts(B.companyId)];
    expect(await refused(ledger.approveChargebackAction(B.chargebackId))).toBe(true);
    expect(await refused(ledger.rejectChargebackAction(B.chargebackId))).toBe(true);
    expect(
      await refused(ledger.recordChargebackRecoveryAction({ chargebackId: B.chargebackId, payrollRunId: A.runId, amountCents: 100_00 }))
    ).toBe(true);
    expect(
      await refused(ledger.recordChargebackRecoveryAction({ chargebackId: A.chargebackId, payrollRunId: B.runId, amountCents: 100_00 }))
    ).toBe(true);
    expect(await refused(ledger.finalizePayrollRunAction(B.runId))).toBe(true);
    expect([await ledgerCounts(A.companyId), await ledgerCounts(B.companyId)]).toEqual(before);
    const [runB, cbB] = await Promise.all([
      db.payrollRun.findUniqueOrThrow({ where: { id: B.runId } }),
      db.chargeback.findUniqueOrThrow({ where: { id: B.chargebackId } }),
    ]);
    expect(runB.finalizedAt).toBeNull();
    expect(cbB.status).toBe("approved");
  });
});
