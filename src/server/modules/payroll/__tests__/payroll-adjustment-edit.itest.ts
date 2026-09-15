import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";

/**
 * EDITING A LINE ON AN OPEN PAYROLL RUN — through the action the ledger's Edit
 * button calls.
 *
 * The edit path existed on the server with no way to reach it, so a typo in an
 * amount meant deleting the line and typing it again, losing who entered it.
 * These pin what the new button relies on:
 *
 *   - amount and reason change; the SIGN still comes from the kind;
 *   - the old values survive, in the activity log, beside who changed them;
 *   - a finalised run refuses, with the sentence the lock already uses;
 *   - a chargeback recovery's amount is not editable — it is drawn from a
 *     balance, and changing the line alone would leave the two disagreeing;
 *   - a bad reason comes back as a message, never as a crash in the browser.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

const session = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock("@/server/auth/session", () => session);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const ledger = await import("@/server/modules/payroll/ledger-actions");
const { recordChargebackRecovery } = await import("@/server/modules/payroll/chargebacks");

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let adminId: string;
let repId: string;
let runId: string;

function actAs(role: "admin" | "sales_rep") {
  session.requireUser.mockResolvedValue({
    userId: role === "admin" ? adminId : repId,
    companyId,
    role,
    permissions: {},
    fullName: role === "admin" ? "Edit Admin" : "Edit Rep",
  });
}

beforeAll(async () => {
  const tag = `${process.pid}-${Date.now()}`;
  const c = await db.company.create({ data: { name: "Adjustment Edit Co", slug: `adj-edit-${tag}` } });
  companyId = c.id;
  adminId = (
    await db.user.create({
      data: { companyId, role: "admin", email: `adm-edit-${tag}@test.local`, passwordHash: "x", firstName: "Edit", lastName: "Admin" },
    })
  ).id;
  repId = (
    await db.user.create({
      data: { companyId, role: "sales_rep", email: `rep-edit-${tag}@test.local`, passwordHash: "x", firstName: "Edit", lastName: "Rep" },
    })
  ).id;
});

afterAll(async () => {
  await db.company.delete({ where: { id: companyId } });
  await db.$disconnect();
});

beforeEach(async () => {
  await db.payrollAdjustment.deleteMany({ where: { companyId } });
  await db.chargebackRecovery.deleteMany({ where: { chargeback: { companyId } } });
  await db.chargeback.deleteMany({ where: { companyId } });
  await db.payrollRun.deleteMany({ where: { companyId } });
  await db.activityLog.deleteMany({ where: { companyId } });
  runId = (
    await db.payrollRun.create({
      data: { companyId, label: "Edit week", periodStart: new Date("2026-09-01"), periodEnd: new Date("2026-09-07") },
    })
  ).id;
  actAs("admin");
});

const line = (kind: "bonus" | "deduction", magnitude: number, reason: string) =>
  db.payrollAdjustment.create({
    data: {
      companyId, payrollRunId: runId, userId: repId, kind, reason, createdById: adminId,
      amountCents: kind === "bonus" ? magnitude : -magnitude,
    },
    select: { id: true },
  });

const row = (id: string) =>
  db.payrollAdjustment.findUniqueOrThrow({
    where: { id },
    select: { amountCents: true, reason: true, kind: true, createdById: true, updatedById: true },
  });

describe("editing a payroll adjustment", () => {
  it("changes a deduction's amount and reason, keeps it a deduction, and records who edited it", async () => {
    const a = await line("deduction", 500_00, "Trenching — 50 ft");
    const res = await ledger.updatePayrollAdjustmentAction({
      adjustmentId: a.id, payrollRunId: runId, amountCents: 750_00, reason: "Trenching — 75 ft",
    });
    expect(res).toEqual({ ok: true });
    expect(await row(a.id)).toEqual({
      amountCents: -750_00, reason: "Trenching — 75 ft", kind: "deduction", createdById: adminId, updatedById: adminId,
    });
  });

  it("keeps the old values — the edit is logged before and after, with who made it", async () => {
    const a = await line("bonus", 200_00, "Spiff");
    await ledger.updatePayrollAdjustmentAction({
      adjustmentId: a.id, payrollRunId: runId, amountCents: 350_00, reason: "Spiff — revised",
    });
    const logs = await db.activityLog.findMany({ where: { companyId }, select: { type: true, actorId: true, message: true } });
    expect(logs).toHaveLength(1);
    expect(logs[0].type).toBe("payment");
    expect(logs[0].actorId).toBe(adminId);
    expect(logs[0].message).toContain("$200.00 → $350.00");
    expect(logs[0].message).toContain('"Spiff" → "Spiff — revised"');
  });

  it("editing only the reason leaves the amount alone", async () => {
    const a = await line("bonus", 125_00, "Spiff");
    expect(await ledger.updatePayrollAdjustmentAction({ adjustmentId: a.id, payrollRunId: runId, reason: "Referral spiff" }))
      .toEqual({ ok: true });
    expect(await row(a.id)).toMatchObject({ amountCents: 125_00, reason: "Referral spiff" });
  });

  it("a finalised run refuses, says why, and nothing changes or is logged", async () => {
    const a = await line("bonus", 100_00, "before close");
    await db.payrollRun.update({ where: { id: runId }, data: { finalizedAt: new Date(), finalizedById: adminId } });
    const res = await ledger.updatePayrollAdjustmentAction({ adjustmentId: a.id, payrollRunId: runId, amountCents: 999_00 });
    expect(res.ok).toBe(false);
    expect("error" in res && res.error).toMatch(/finalised/);
    expect(await row(a.id)).toMatchObject({ amountCents: 100_00, updatedById: null });
    expect(await db.activityLog.count({ where: { companyId } })).toBe(0);
  });

  it("somebody without Payroll update cannot edit", async () => {
    const a = await line("bonus", 100_00, "Spiff");
    actAs("sales_rep");
    expect(await ledger.updatePayrollAdjustmentAction({ adjustmentId: a.id, payrollRunId: runId, amountCents: 1_000_00 }))
      .toEqual({ ok: false, error: "Not allowed." });
    expect(await row(a.id)).toMatchObject({ amountCents: 100_00, updatedById: null });
  });

  it("a chargeback recovery's amount cannot be edited — the balance and the pay line must agree", async () => {
    const cb = await db.chargeback.create({
      data: {
        companyId, userId: repId, amountCents: 1_000_00, reason: "fraud", status: "approved",
        requestedById: adminId, approvedById: adminId, approvedAt: new Date(),
      },
    });
    const taken = await recordChargebackRecovery({
      companyId, chargebackId: cb.id, payrollRunId: runId, amountCents: 400_00, createdById: adminId,
    });
    expect(taken.ok).toBe(true);
    const adj = await db.payrollAdjustment.findFirstOrThrow({ where: { chargebackId: cb.id }, select: { id: true } });

    const res = await ledger.updatePayrollAdjustmentAction({ adjustmentId: adj.id, payrollRunId: runId, amountCents: 100_00 });
    expect(res.ok).toBe(false);
    expect((await row(adj.id)).amountCents).toBe(-400_00);
    const recovered = await db.chargebackRecovery.aggregate({ where: { chargebackId: cb.id }, _sum: { amountCents: true } });
    expect(recovered._sum.amountCents).toBe(400_00);
  });

  it("a reason that is only padding comes back as a message, not a crash", async () => {
    const a = await line("bonus", 100_00, "Spiff");
    const res = await ledger.updatePayrollAdjustmentAction({ adjustmentId: a.id, payrollRunId: runId, reason: "   ab  " });
    expect(res.ok).toBe(false);
    expect("error" in res && res.error).toMatch(/reason/i);
    expect((await row(a.id)).reason).toBe("Spiff");
  });
});

// ---------------------------------------------------------------------------
// Races, and the recovery pair
// ---------------------------------------------------------------------------

const amountSteps = async () =>
  (await db.activityLog.findMany({ where: { companyId, message: { contains: "edited" } }, select: { message: true } })).map(
    ({ message }) => {
      const [, from, to] = message.match(/amount \$([\d,.]+) → \$([\d,.]+)/) ?? [];
      return { from: Math.round(Number(from.replace(/,/g, "")) * 100), to: Math.round(Number(to.replace(/,/g, "")) * 100) };
    }
  );

/** Do these logged steps, in SOME order, walk from `start` to `end` with no gaps? */
function chains(start: number, steps: { from: number; to: number }[], end: number): boolean {
  if (steps.length === 0) return start === end;
  return steps.some((s, i) => s.from === start && chains(s.to, steps.filter((_, j) => j !== i), end));
}

describe("edits and removals that race each other", () => {
  it("two simultaneous edits leave a gap-free trail — including an edit back to the original figure", async () => {
    for (let round = 0; round < 10; round++) {
      await db.activityLog.deleteMany({ where: { companyId } });
      const a = await line("bonus", 500_00, `Race ${round}`);
      const results = await Promise.all([
        ledger.updatePayrollAdjustmentAction({ adjustmentId: a.id, payrollRunId: runId, amountCents: 750_00 }),
        ledger.updatePayrollAdjustmentAction({ adjustmentId: a.id, payrollRunId: runId, amountCents: 500_00 }),
      ]);
      expect(results).toEqual([{ ok: true }, { ok: true }]);
      const final = (await row(a.id)).amountCents;
      const steps = await amountSteps();
      expect(chains(500_00, steps, final), `round ${round}: ${JSON.stringify({ steps, final })}`).toBe(true);
    }
  });

  it("an edit racing the removal of the same line ends in a message, never a crash", async () => {
    for (let round = 0; round < 10; round++) {
      const a = await line("deduction", 200_00, `Gone ${round}`);
      const [edit, removal] = await Promise.all([
        ledger.updatePayrollAdjustmentAction({ adjustmentId: a.id, payrollRunId: runId, amountCents: 300_00 }),
        ledger.deletePayrollAdjustmentAction(a.id, runId),
      ]);
      expect(removal).toEqual({ ok: true });
      expect([{ ok: true }, { ok: false, error: "Adjustment not found." }]).toContainEqual(edit);
      expect(await db.payrollAdjustment.count({ where: { id: a.id } })).toBe(0);
    }
  });
});

describe("removing a chargeback recovery line", () => {
  const approvedChargeback = (amountCents: number) =>
    db.chargeback.create({
      data: {
        companyId, userId: repId, amountCents, reason: "fraud", status: "approved",
        requestedById: adminId, approvedById: adminId, approvedAt: new Date(),
      },
      select: { id: true },
    });
  const recoveryLines = (chargebackId: string) =>
    db.payrollAdjustment.findMany({ where: { chargebackId }, select: { id: true, amountCents: true } });
  const balance = async (chargebackId: string) => {
    const [cb, sum] = await Promise.all([
      db.chargeback.findUniqueOrThrow({ where: { id: chargebackId }, select: { status: true, amountCents: true } }),
      db.chargebackRecovery.aggregate({ where: { chargebackId }, _sum: { amountCents: true } }),
    ]);
    return { status: cb.status, owedCents: cb.amountCents - (sum._sum.amountCents ?? 0) };
  };

  it("takes the instalment back: the debt is owed again, a settled chargeback reopens, and it is logged", async () => {
    const cb = await approvedChargeback(1_000_00);
    const taken = await recordChargebackRecovery({
      companyId, chargebackId: cb.id, payrollRunId: runId, amountCents: 1_000_00, createdById: adminId,
    });
    expect(taken.ok).toBe(true);
    expect(await balance(cb.id)).toEqual({ status: "settled", owedCents: 0 });

    const [recoveryLine] = await recoveryLines(cb.id);
    expect(await ledger.deletePayrollAdjustmentAction(recoveryLine.id, runId)).toEqual({ ok: true });

    expect(await balance(cb.id)).toEqual({ status: "approved", owedCents: 1_000_00 });
    expect(await recoveryLines(cb.id)).toHaveLength(0);
    const logs = await db.activityLog.findMany({
      where: { companyId, message: { contains: "removed" } },
      select: { message: true, actorId: true },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].actorId).toBe(adminId);
    expect(logs[0].message).toContain("$1,000.00");
    expect(logs[0].message).toContain("owed on the chargeback again");
  });

  it("removing one of two instalments on the run takes back only that one", async () => {
    const cb = await approvedChargeback(1_000_00);
    for (const amountCents of [400_00, 400_00]) {
      await recordChargebackRecovery({ companyId, chargebackId: cb.id, payrollRunId: runId, amountCents, createdById: adminId });
    }
    const [first] = await recoveryLines(cb.id);
    expect(await ledger.deletePayrollAdjustmentAction(first.id, runId)).toEqual({ ok: true });
    expect(await balance(cb.id)).toEqual({ status: "approved", owedCents: 600_00 });
    expect(await recoveryLines(cb.id)).toHaveLength(1);
    expect(await db.chargebackRecovery.count({ where: { chargebackId: cb.id } })).toBe(1);
  });

  it("a removal racing a new recovery on the same debt leaves the balance and the pay lines agreeing", async () => {
    for (let round = 0; round < 10; round++) {
      const cb = await approvedChargeback(1_000_00);
      await recordChargebackRecovery({ companyId, chargebackId: cb.id, payrollRunId: runId, amountCents: 600_00, createdById: adminId });
      const [existing] = await recoveryLines(cb.id);
      await Promise.all([
        ledger.deletePayrollAdjustmentAction(existing.id, runId),
        ledger.recordChargebackRecoveryAction({ chargebackId: cb.id, payrollRunId: runId, amountCents: 700_00 }),
      ]);
      const lines = await recoveryLines(cb.id);
      const recovered = (await db.chargebackRecovery.aggregate({ where: { chargebackId: cb.id }, _sum: { amountCents: true } }))
        ._sum.amountCents ?? 0;
      expect(-lines.reduce((n, l) => n + l.amountCents, 0), `round ${round}`).toBe(recovered);
      expect(recovered).toBeLessThanOrEqual(1_000_00);
    }
  });
});
