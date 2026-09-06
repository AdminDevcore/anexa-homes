import type { ChargebackReason } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { addPayrollAdjustment, assertRunOpen } from "./adjustments";

/**
 * Clawing back commission, and recovering it a piece at a time.
 *
 * NOT a `"use server"` module — every function takes a `companyId`.
 *
 * ── A CHARGEBACK IS NEVER AUTOMATIC ────────────────────────────────────────
 * Funding being reversed is not, on its own, anybody's fault. An install that
 * failed, a permit refused, a utility that would not interconnect, a lender
 * problem, a customer who stopped answering — none of those are the rep's
 * conduct, and none of them may take a rep's pay. Nothing in this module is
 * called by the funding path, by the pipeline, or by any cron. A human raises
 * one, names a documented rep-caused reason, and an admin approves it before a
 * cent moves.
 *
 * ── THE ORIGINAL COMMISSION IS NEVER TOUCHED ───────────────────────────────
 * An approved commission is a record of what was earned. A chargeback is a
 * SEPARATE financial record that says some of it is owed back. Editing the
 * original amount would destroy the evidence of both the sale and the clawback,
 * and would silently change every report that has already been run.
 *
 * ── AN APPROVED CHARGEBACK IS A BALANCE, NOT A DEDUCTION ───────────────────
 * How much comes off any given payroll is an admin's decision every time: full,
 * partial, or nothing at all. Consuming somebody's whole cheque because a
 * balance exists turns one debt into a second, unintended punishment.
 */

/** Reasons that are the rep's conduct. The enum is the whitelist. */
export const REP_CAUSED_REASONS: ChargebackReason[] = [
  "fraud",
  "fabricated_deal",
  "misrepresentation",
  "rep_misconduct",
  "other_rep_caused",
];

export type ChargebackBalance = {
  chargebackId: string;
  userId: string;
  originalCents: number;
  recoveredCents: number;
  remainingCents: number;
};

/**
 * Raise a chargeback. PENDING — nothing is recoverable until an admin approves.
 *
 * `commissionId` is optional because the commission may have been paid on a run
 * that has since closed, or the deal may have been reassigned; the money is owed
 * by a PERSON either way. When it is supplied the link is kept so the two
 * records can be read together.
 */
export async function requestChargeback(args: {
  companyId: string;
  userId: string;
  amountCents: number;
  reason: ChargebackReason;
  notes?: string | null;
  requestedById: string;
  commissionId?: string | null;
  projectId?: string | null;
  leadId?: string | null;
}) {
  const amount = Math.abs(Math.round(args.amountCents));
  if (amount === 0) throw new Error("A chargeback of nothing is not a chargeback.");
  if (!REP_CAUSED_REASONS.includes(args.reason)) {
    // Unreachable through the enum, kept as the statement of the rule for the
    // day somebody widens it.
    throw new Error("A chargeback needs a documented rep-caused reason.");
  }

  // Denormalise the deal so the record still reads correctly if the commission
  // is ever removed — the FK is SetNull for exactly that case.
  let projectId = args.projectId ?? null;
  let leadId = args.leadId ?? null;
  if (args.commissionId && (!projectId || !leadId)) {
    const c = await prisma.commission.findFirst({
      where: { id: args.commissionId, companyId: args.companyId },
      select: { projectId: true, project: { select: { leadId: true } } },
    });
    projectId ??= c?.projectId ?? null;
    leadId ??= c?.project?.leadId ?? null;
  }

  return prisma.chargeback.create({
    data: {
      companyId: args.companyId,
      userId: args.userId,
      amountCents: amount,
      reason: args.reason,
      notes: args.notes?.trim() || null,
      status: "pending",
      requestedById: args.requestedById,
      commissionId: args.commissionId ?? null,
      projectId,
      leadId,
    },
    select: { id: true, status: true, amountCents: true },
  });
}

export async function approveChargeback(args: {
  companyId: string;
  chargebackId: string;
  approvedById: string;
}) {
  const cb = await prisma.chargeback.findFirst({
    where: { id: args.chargebackId, companyId: args.companyId },
    select: { id: true, status: true, userId: true, leadId: true, amountCents: true },
  });
  if (!cb) return { ok: false as const, error: "Chargeback not found." };
  if (cb.status !== "pending") return { ok: false as const, error: `Already ${cb.status}.` };

  await prisma.chargeback.update({
    where: { id: cb.id },
    data: { status: "approved", approvedById: args.approvedById, approvedAt: new Date() },
  });
  await prisma.activityLog.create({
    data: {
      companyId: args.companyId,
      type: "payment",
      message: `Chargeback approved — ${(cb.amountCents / 100).toFixed(2)} recoverable`,
      actorId: args.approvedById,
      leadId: cb.leadId,
    },
  });
  return { ok: true as const };
}

export async function rejectChargeback(args: {
  companyId: string;
  chargebackId: string;
  rejectedById: string;
  notes?: string | null;
}) {
  const cb = await prisma.chargeback.findFirst({
    where: { id: args.chargebackId, companyId: args.companyId },
    select: { id: true, status: true },
  });
  if (!cb) return { ok: false as const, error: "Chargeback not found." };
  if (cb.status !== "pending") return { ok: false as const, error: `Already ${cb.status}.` };
  await prisma.chargeback.update({
    where: { id: cb.id },
    data: {
      status: "rejected",
      rejectedById: args.rejectedById,
      rejectedAt: new Date(),
      notes: args.notes?.trim() || undefined,
    },
  });
  return { ok: true as const };
}

/** Original minus everything recovered so far. */
export async function chargebackBalance(
  companyId: string,
  chargebackId: string
): Promise<ChargebackBalance | null> {
  const cb = await prisma.chargeback.findFirst({
    where: { id: chargebackId, companyId },
    select: {
      id: true,
      userId: true,
      amountCents: true,
      recoveries: { select: { amountCents: true } },
    },
  });
  if (!cb) return null;
  const recovered = cb.recoveries.reduce((n, r) => n + r.amountCents, 0);
  return {
    chargebackId: cb.id,
    userId: cb.userId,
    originalCents: cb.amountCents,
    recoveredCents: recovered,
    remainingCents: Math.max(0, cb.amountCents - recovered),
  };
}

/** Every open balance for one person — what an admin sees when preparing payroll. */
export async function openBalancesFor(companyId: string, userId: string) {
  const rows = await prisma.chargeback.findMany({
    where: { companyId, userId, status: "approved" },
    select: {
      id: true,
      amountCents: true,
      reason: true,
      leadId: true,
      recoveries: { select: { amountCents: true } },
    },
  });
  return rows
    .map((cb) => {
      const recovered = cb.recoveries.reduce((n, r) => n + r.amountCents, 0);
      return {
        chargebackId: cb.id,
        reason: cb.reason,
        leadId: cb.leadId,
        originalCents: cb.amountCents,
        recoveredCents: recovered,
        remainingCents: cb.amountCents - recovered,
      };
    })
    .filter((b) => b.remainingCents > 0);
}

/**
 * Take an instalment on one payroll run.
 *
 * `amountCents` is the admin's choice: the whole balance, part of it, or — by
 * simply not calling this — nothing at all this period. It is clamped to the
 * remaining balance so a double-entry cannot recover more than is owed, and it
 * writes a `chargeback_recovery` adjustment so the deduction appears as its own
 * line on the pay stub rather than vanishing into a smaller commission.
 */
export async function recordChargebackRecovery(args: {
  companyId: string;
  chargebackId: string;
  payrollRunId: string;
  amountCents: number;
  createdById: string;
  notes?: string | null;
}) {
  await assertRunOpen(args.companyId, args.payrollRunId);

  const balance = await chargebackBalance(args.companyId, args.chargebackId);
  if (!balance) return { ok: false as const, error: "Chargeback not found." };

  const cb = await prisma.chargeback.findFirstOrThrow({
    where: { id: args.chargebackId, companyId: args.companyId },
    select: { status: true, leadId: true, projectId: true },
  });
  if (cb.status !== "approved") {
    return { ok: false as const, error: "Only an approved chargeback can be recovered." };
  }
  if (balance.remainingCents <= 0) {
    return { ok: false as const, error: "This chargeback is already fully recovered." };
  }

  const take = Math.min(balance.remainingCents, Math.abs(Math.round(args.amountCents)));
  if (take === 0) return { ok: false as const, error: "Enter an amount to recover." };

  await prisma.chargebackRecovery.create({
    data: {
      chargebackId: args.chargebackId,
      payrollRunId: args.payrollRunId,
      amountCents: take,
      notes: args.notes?.trim() || null,
      createdById: args.createdById,
    },
  });

  await addPayrollAdjustment({
    companyId: args.companyId,
    payrollRunId: args.payrollRunId,
    userId: balance.userId,
    kind: "chargeback_recovery",
    amountCents: take,
    reason: args.notes?.trim() || "Chargeback recovery",
    createdById: args.createdById,
    chargebackId: args.chargebackId,
    leadId: cb.leadId,
    projectId: cb.projectId,
  });

  // Settled only when the balance actually reaches zero — a partial recovery
  // leaves it approved and open for the next run.
  const remaining = balance.remainingCents - take;
  if (remaining <= 0) {
    await prisma.chargeback.update({
      where: { id: args.chargebackId },
      data: { status: "settled" },
    });
  }

  return { ok: true as const, recoveredCents: take, remainingCents: remaining };
}
