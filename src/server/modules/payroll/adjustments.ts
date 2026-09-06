import { prisma } from "@/server/db/client";

/**
 * Manual money on a payroll run, and the rule that a closed run never moves.
 *
 * NOT a `"use server"` module — every function takes a `companyId`. The actions
 * that expose these to a browser live in `actions.ts` and resolve it from the
 * session.
 *
 * ── WHAT AN ADJUSTMENT IS ──────────────────────────────────────────────────
 * A line on ONE payroll run that changes what somebody is PAID. It never touches
 * the deal: an approved commission records what was EARNED, and a $1,000
 * trenching deduction does not mean the rep sold a smaller system. The deal goes
 * on saying $10,000 while the cheque says $9,500, and both are true — see
 * `estimatedCommission` on the deal page.
 *
 * ── WHAT FINALISATION MEANS ────────────────────────────────────────────────
 * Before it, an authorised user adds and edits adjustments freely. After it, the
 * run is a historical record: no commission enters it, no amount changes, no
 * adjustment is added or edited. Anything found later goes to the next run, or
 * through an explicit reversal that leaves its own trail. A payroll you can
 * quietly rewrite is a payroll nobody can reconcile against a bank statement.
 */

export class PayrollLockedError extends Error {
  constructor(runLabel: string) {
    super(
      `Payroll run "${runLabel}" is finalised and cannot be changed. Put the correction on the ` +
        `next run, or raise an explicit reversal.`
    );
    this.name = "PayrollLockedError";
  }
}

/** Throws if the run is finalised. The single gate every mutation goes through. */
export async function assertRunOpen(companyId: string, payrollRunId: string): Promise<void> {
  const run = await prisma.payrollRun.findFirst({
    where: { id: payrollRunId, companyId },
    select: { label: true, finalizedAt: true },
  });
  if (!run) throw new Error("Payroll run not found.");
  if (run.finalizedAt) throw new PayrollLockedError(run.label);
}

/**
 * Add a manual line.
 *
 * `amountCents` is stored SIGNED — positive adds, negative deducts — so a report
 * sums the column without asking what kind each row is. The sign is derived from
 * `kind` rather than trusted from the caller, because a "deduction" of +$1,000
 * is a typo that pays somebody a bonus.
 */
export async function addPayrollAdjustment(args: {
  companyId: string;
  payrollRunId: string;
  userId: string;
  kind: "bonus" | "deduction" | "chargeback_recovery";
  /** Magnitude, always positive. The sign comes from `kind`. */
  amountCents: number;
  reason: string;
  createdById: string;
  leadId?: string | null;
  projectId?: string | null;
  chargebackId?: string | null;
}) {
  const reason = args.reason.trim();
  if (reason.length < 3) throw new Error("Give a reason for the adjustment.");
  const magnitude = Math.abs(Math.round(args.amountCents));
  if (magnitude === 0) throw new Error("An adjustment of nothing is not an adjustment.");

  await assertRunOpen(args.companyId, args.payrollRunId);

  const signed = args.kind === "bonus" ? magnitude : -magnitude;

  return prisma.payrollAdjustment.create({
    data: {
      companyId: args.companyId,
      payrollRunId: args.payrollRunId,
      userId: args.userId,
      kind: args.kind,
      amountCents: signed,
      reason,
      leadId: args.leadId ?? null,
      projectId: args.projectId ?? null,
      chargebackId: args.chargebackId ?? null,
      createdById: args.createdById,
    },
    select: { id: true, amountCents: true, kind: true },
  });
}

/** Edit a line — open runs only, and never its payee or its run. */
export async function updatePayrollAdjustment(args: {
  companyId: string;
  adjustmentId: string;
  amountCents?: number;
  reason?: string;
  updatedById: string;
}) {
  const adj = await prisma.payrollAdjustment.findFirst({
    where: { id: args.adjustmentId, companyId: args.companyId },
    select: { id: true, payrollRunId: true, kind: true },
  });
  if (!adj) throw new Error("Adjustment not found.");
  await assertRunOpen(args.companyId, adj.payrollRunId);

  const data: { amountCents?: number; reason?: string; updatedById: string } = {
    updatedById: args.updatedById,
  };
  if (args.amountCents != null) {
    const magnitude = Math.abs(Math.round(args.amountCents));
    data.amountCents = adj.kind === "bonus" ? magnitude : -magnitude;
  }
  if (args.reason != null) {
    const reason = args.reason.trim();
    if (reason.length < 3) throw new Error("Give a reason for the adjustment.");
    data.reason = reason;
  }
  return prisma.payrollAdjustment.update({ where: { id: adj.id }, data, select: { id: true } });
}

export async function deletePayrollAdjustment(args: {
  companyId: string;
  adjustmentId: string;
}) {
  const adj = await prisma.payrollAdjustment.findFirst({
    where: { id: args.adjustmentId, companyId: args.companyId },
    select: { id: true, payrollRunId: true },
  });
  if (!adj) throw new Error("Adjustment not found.");
  await assertRunOpen(args.companyId, adj.payrollRunId);
  await prisma.payrollAdjustment.delete({ where: { id: adj.id } });
}

/**
 * Close a run.
 *
 * One-way. Re-opening is deliberately not offered: the point of the lock is that
 * a statement already given to somebody cannot change afterwards, and an
 * "unlock" button is the same thing as no lock at all.
 */
export async function finalizePayrollRun(args: {
  companyId: string;
  payrollRunId: string;
  actorId: string;
}) {
  const run = await prisma.payrollRun.findFirst({
    where: { id: args.payrollRunId, companyId: args.companyId },
    select: { id: true, label: true, finalizedAt: true },
  });
  if (!run) throw new Error("Payroll run not found.");
  if (run.finalizedAt) return { ok: true as const, alreadyFinal: true };

  await prisma.payrollRun.update({
    where: { id: run.id },
    data: { finalizedAt: new Date(), finalizedById: args.actorId },
  });
  return { ok: true as const, alreadyFinal: false };
}

/**
 * What one person is actually paid on one run, itemised.
 *
 * The shape a pay stub prints. Commissions and overrides are separated because a
 * manager's override is not their own sale and reading them as one number hides
 * which is which.
 */
export type PayStubBreakdown = {
  baseCommissionCents: number;
  managerOverrideCents: number;
  bonusCents: number;
  deductionCents: number;
  chargebackRecoveryCents: number;
  finalCents: number;
  lines: {
    commissions: { label: string; amountCents: number; isOverride: boolean }[];
    adjustments: { kind: string; reason: string; amountCents: number }[];
  };
};

export async function payStubBreakdown(args: {
  companyId: string;
  payrollRunId: string;
  userId: string;
}): Promise<PayStubBreakdown> {
  const [items, adjustments] = await Promise.all([
    prisma.payrollItem.findMany({
      where: { payrollRunId: args.payrollRunId, userId: args.userId },
      select: {
        label: true,
        amount: true,
        commission: { select: { overrideId: true } },
      },
    }),
    prisma.payrollAdjustment.findMany({
      where: { companyId: args.companyId, payrollRunId: args.payrollRunId, userId: args.userId },
      select: { kind: true, reason: true, amountCents: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  let baseCommissionCents = 0;
  let managerOverride = 0;
  const commissionLines = items.map((i) => {
    const isOverride = !!i.commission?.overrideId;
    if (isOverride) managerOverride += i.amount;
    else baseCommissionCents += i.amount;
    return { label: i.label, amountCents: i.amount, isOverride };
  });

  let bonusCents = 0;
  let deductionCents = 0;
  let chargebackRecoveryCents = 0;
  for (const a of adjustments) {
    if (a.kind === "bonus") bonusCents += a.amountCents;
    else if (a.kind === "chargeback_recovery") chargebackRecoveryCents += a.amountCents;
    else deductionCents += a.amountCents;
  }

  return {
    baseCommissionCents,
    managerOverrideCents: managerOverride,
    bonusCents,
    // Both are stored negative, so the total is a plain sum.
    deductionCents,
    chargebackRecoveryCents,
    finalCents:
      baseCommissionCents + managerOverride + bonusCents + deductionCents + chargebackRecoveryCents,
    lines: {
      commissions: commissionLines,
      adjustments: adjustments.map((a) => ({
        kind: a.kind,
        reason: a.reason,
        amountCents: a.amountCents,
      })),
    },
  };
}
