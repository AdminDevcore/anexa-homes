import { prisma } from "@/server/db/client";
import type { Db } from "@/server/db/types";
import { assertPayrollReferences, PayrollRefusedError } from "./references";

/**
 * Manual money on a payroll run, and the rule that a closed run never moves.
 *
 * NOT a `"use server"` module — every function takes a `companyId`. The actions
 * that expose these to a browser live in `ledger-actions.ts` and resolve it from
 * the session.
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

/**
 * Throws if the run is finalised, or is not this company's. The single gate
 * every mutation goes through.
 *
 * ── AND HOLDS IT SHUT ──────────────────────────────────────────────────────
 * Reading `finalizedAt` and then writing is a race: finalisation can commit in
 * between, and the line lands on a run somebody has already been paid from. So
 * the check also takes the run's ROW LOCK, with an update that only matches
 * while the run is still open. Inside a transaction that lock is held until
 * commit: finalisation, which updates the same row, waits for the write to
 * finish, and a write arriving after finalisation matches nothing and is
 * refused. Pass the transaction client for that; outside one the lock is
 * released as soon as it is taken and only the check remains.
 *
 * An update rather than `SELECT … FOR UPDATE` because raw SQL is fenced out of
 * the app (src/lib/__tests__/no-raw-sql.test.ts); it locks the same row.
 */
export async function assertRunOpen(companyId: string, payrollRunId: string, db: Db = prisma): Promise<void> {
  const run = await db.payrollRun.findFirst({
    where: { id: payrollRunId, companyId },
    select: { label: true, finalizedAt: true },
  });
  if (!run) throw new PayrollRefusedError("Payroll run not found.");
  if (run.finalizedAt) throw new PayrollLockedError(run.label);

  const held = await db.payrollRun.updateMany({
    where: { id: payrollRunId, companyId, finalizedAt: null },
    data: { updatedAt: new Date() },
  });
  if (held.count !== 1) throw new PayrollLockedError(run.label);
}

/**
 * Add a manual line.
 *
 * `amountCents` is stored SIGNED — positive adds, negative deducts — so a report
 * sums the column without asking what kind each row is. The sign is derived from
 * `kind` rather than trusted from the caller, because a "deduction" of +$1,000
 * is a typo that pays somebody a bonus.
 *
 * The payee, deal, job and chargeback it names are checked against the company
 * before anything is written — see references.ts.
 *
 * Pass `db` to write inside a caller's transaction (a chargeback recovery);
 * otherwise the line gets its own, so the run stays locked until it is written.
 */
export async function addPayrollAdjustment(
  args: {
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
  },
  db?: Db
) {
  const reason = args.reason.trim();
  if (reason.length < 3) throw new PayrollRefusedError("Give a reason for the adjustment.");
  const magnitude = Math.abs(Math.round(args.amountCents));
  if (magnitude === 0) throw new PayrollRefusedError("An adjustment of nothing is not an adjustment.");

  const signed = args.kind === "bonus" ? magnitude : -magnitude;

  const write = async (tx: Db) => {
    await assertRunOpen(args.companyId, args.payrollRunId, tx);
    await assertPayrollReferences(
      args.companyId,
      { userId: args.userId, leadId: args.leadId, projectId: args.projectId, chargebackId: args.chargebackId },
      tx
    );
    return tx.payrollAdjustment.create({
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
  };

  return db ? write(db) : prisma.$transaction((tx) => write(tx));
}

const usd = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

/**
 * The line, read AFTER its run is locked.
 *
 * Reading first and locking second lets an edit or removal that commits while
 * this one waits go unseen: the audit entry would record values that were
 * already gone, and an edit back to the original figure would log nothing at
 * all. Every edit and removal takes the same run lock, so what this returns is
 * exactly what the write replaces.
 */
async function lockedAdjustment(tx: Db, companyId: string, adjustmentId: string) {
  const found = await tx.payrollAdjustment.findFirst({
    where: { id: adjustmentId, companyId },
    select: { payrollRunId: true },
  });
  if (!found) throw new PayrollRefusedError("Adjustment not found.");
  await assertRunOpen(companyId, found.payrollRunId, tx);

  const adj = await tx.payrollAdjustment.findFirst({
    where: { id: adjustmentId, companyId },
    select: {
      id: true, payrollRunId: true, kind: true, amountCents: true, reason: true, leadId: true, chargebackId: true,
    },
  });
  if (!adj) throw new PayrollRefusedError("Adjustment not found.");
  return adj;
}

/**
 * Edit a line — open runs only, amount and reason only, never its payee, its
 * kind or its run.
 *
 * `updatedById` says who touched it last; the activity log keeps what it said
 * BEFORE, beside who changed it. Without that, correcting $500 to $750 would
 * leave no trace that the stub anybody printed earlier ever read $500.
 *
 * A chargeback recovery's AMOUNT is refused. That line is one half of a pair —
 * the same figure is recorded against the chargeback's balance — and changing
 * the line alone would leave the balance saying one thing and the pay stub
 * another.
 */
export async function updatePayrollAdjustment(args: {
  companyId: string;
  adjustmentId: string;
  amountCents?: number;
  reason?: string;
  updatedById: string;
}) {
  return prisma.$transaction(async (tx) => {
    const adj = await lockedAdjustment(tx, args.companyId, args.adjustmentId);

    const data: { amountCents?: number; reason?: string; updatedById: string } = {
      updatedById: args.updatedById,
    };
    if (args.amountCents != null) {
      if (adj.kind === "chargeback_recovery") {
        throw new PayrollRefusedError(
          "A chargeback recovery's amount can't be edited — it is drawn from the chargeback's balance."
        );
      }
      const magnitude = Math.abs(Math.round(args.amountCents));
      if (magnitude === 0) throw new PayrollRefusedError("An adjustment of nothing is not an adjustment.");
      data.amountCents = adj.kind === "bonus" ? magnitude : -magnitude;
    }
    if (args.reason != null) {
      const reason = args.reason.trim();
      if (reason.length < 3) throw new PayrollRefusedError("Give a reason for the adjustment.");
      data.reason = reason;
    }

    const changes: string[] = [];
    if (data.amountCents !== undefined && data.amountCents !== adj.amountCents) {
      changes.push(`amount ${usd(Math.abs(adj.amountCents))} → ${usd(Math.abs(data.amountCents))}`);
    }
    if (data.reason !== undefined && data.reason !== adj.reason) {
      changes.push(`reason "${adj.reason}" → "${data.reason}"`);
    }

    await tx.payrollAdjustment.update({ where: { id: adj.id }, data });
    if (changes.length > 0) {
      await tx.activityLog.create({
        data: {
          companyId: args.companyId,
          type: "payment",
          message: `Payroll ${adj.kind.replace(/_/g, " ")} edited — ${changes.join("; ")}`,
          actorId: args.updatedById,
          leadId: adj.leadId,
        },
      });
    }
    return { id: adj.id };
  });
}

/**
 * Remove a line — open runs only — and log what it said.
 *
 * A CHARGEBACK RECOVERY is one half of a pair: the same instalment is recorded
 * against the chargeback's balance. Removing only the pay-stub line used to
 * leave that instalment standing, so the debt read as recovered — even settled —
 * while nobody's pay ever gave the money up. Removing the line now takes the
 * instalment back with it, and a settled chargeback that is owed money again is
 * reopened. Locks are taken run first, then chargeback, exactly as recovery
 * takes them, so the two cannot deadlock.
 */
export async function deletePayrollAdjustment(args: {
  companyId: string;
  adjustmentId: string;
  /** Who removed it, for the activity log. */
  deletedById?: string | null;
}) {
  await prisma.$transaction(async (tx) => {
    const adj = await lockedAdjustment(tx, args.companyId, args.adjustmentId);
    let owedAgain = false;

    if (adj.kind === "chargeback_recovery" && adj.chargebackId) {
      await tx.chargeback.updateMany({
        where: { id: adj.chargebackId, companyId: args.companyId },
        data: { updatedAt: new Date() },
      });
      const instalment = await tx.chargebackRecovery.findFirst({
        where: {
          chargebackId: adj.chargebackId,
          payrollRunId: adj.payrollRunId,
          amountCents: Math.abs(adj.amountCents),
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (instalment) {
        await tx.chargebackRecovery.delete({ where: { id: instalment.id } });
        owedAgain = true;
        const cb = await tx.chargeback.findFirst({
          where: { id: adj.chargebackId, companyId: args.companyId },
          select: { status: true, amountCents: true },
        });
        if (cb?.status === "settled") {
          const recovered = await tx.chargebackRecovery.aggregate({
            where: { chargebackId: adj.chargebackId },
            _sum: { amountCents: true },
          });
          if (cb.amountCents - (recovered._sum.amountCents ?? 0) > 0) {
            await tx.chargeback.update({ where: { id: adj.chargebackId }, data: { status: "approved" } });
          }
        }
      }
    }

    await tx.payrollAdjustment.delete({ where: { id: adj.id } });
    await tx.activityLog.create({
      data: {
        companyId: args.companyId,
        type: "payment",
        message:
          `Payroll ${adj.kind.replace(/_/g, " ")} removed — ${usd(Math.abs(adj.amountCents))}, "${adj.reason}"` +
          (owedAgain ? "; the amount is owed on the chargeback again" : ""),
        actorId: args.deletedById ?? null,
        leadId: adj.leadId,
      },
    });
  });
}

/**
 * Close a run.
 *
 * One-way. Re-opening is deliberately not offered: the point of the lock is that
 * a statement already given to somebody cannot change afterwards, and an
 * "unlock" button is the same thing as no lock at all.
 *
 * The close is conditional on the run still being open, so two people finalising
 * at once record ONE finaliser, and it waits for any ledger write holding the
 * run's lock to commit first — see assertRunOpen.
 */
export async function finalizePayrollRun(args: {
  companyId: string;
  payrollRunId: string;
  actorId: string;
}) {
  const run = await prisma.payrollRun.findFirst({
    where: { id: args.payrollRunId, companyId: args.companyId },
    select: { id: true, finalizedAt: true },
  });
  if (!run) throw new PayrollRefusedError("Payroll run not found.");
  if (run.finalizedAt) return { ok: true as const, alreadyFinal: true };

  const closed = await prisma.payrollRun.updateMany({
    where: { id: run.id, companyId: args.companyId, finalizedAt: null },
    data: { finalizedAt: new Date(), finalizedById: args.actorId },
  });
  return { ok: true as const, alreadyFinal: closed.count === 0 };
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
