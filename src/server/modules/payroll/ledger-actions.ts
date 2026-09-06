"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import {
  addPayrollAdjustment,
  updatePayrollAdjustment,
  deletePayrollAdjustment,
  finalizePayrollRun,
  PayrollLockedError,
} from "./adjustments";
import {
  requestChargeback,
  approveChargeback,
  rejectChargeback,
  recordChargebackRecovery,
  REP_CAUSED_REASONS,
} from "./chargebacks";

/**
 * The browser's way into the payroll ledger.
 *
 * Every export of a `"use server"` module is a public RPC endpoint, so each one
 * re-derives the company from the session and re-checks permission rather than
 * trusting anything in its arguments. None of them takes a companyId.
 *
 * ── THE TWO AUTHORITIES ────────────────────────────────────────────────────
 * `update Payroll` moves money on a run: adjustments, recoveries, finalisation.
 * `approve Commission` decides whether a debt exists at all: raising, approving
 * and rejecting a chargeback. They are deliberately different — preparing a run
 * and deciding somebody owes money back are not the same act, and the second is
 * the one that needs a second person.
 *
 * A `PayrollLockedError` is caught and returned as an ordinary error string:
 * hitting a finalised run is a thing a user does, not a crash.
 */

function fail(error: string) {
  return { ok: false as const, error };
}

async function guard(action: "update" | "approve") {
  const user = await requireUser();
  const allowed =
    action === "update" ? can(user, "update", "Payroll") : can(user, "approve", "Commission");
  return allowed ? user : null;
}

/** Turn the lock into a message rather than a stack trace. */
async function locked<T>(fn: () => Promise<T>) {
  try {
    return { ok: true as const, value: await fn() };
  } catch (err) {
    if (err instanceof PayrollLockedError) return { ok: false as const, error: err.message };
    throw err;
  }
}

// --------------------------- Adjustments ------------------------------------

const adjustmentSchema = z.object({
  payrollRunId: z.string().min(1),
  userId: z.string().min(1),
  kind: z.enum(["bonus", "deduction"]),
  /** Magnitude in cents, always positive — `kind` supplies the sign. */
  amountCents: z.number().int().positive(),
  reason: z.string().min(3).max(300),
  leadId: z.string().optional().nullable(),
  projectId: z.string().optional().nullable(),
});

export async function addPayrollAdjustmentAction(input: z.infer<typeof adjustmentSchema>) {
  const user = await guard("update");
  if (!user) return fail("Not allowed.");
  const parsed = adjustmentSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid adjustment.");

  // `chargeback_recovery` is deliberately NOT accepted here. A recovery has to
  // draw down a real balance, so it only ever comes through
  // recordChargebackRecoveryAction — otherwise a hand-typed "recovery" would
  // deduct money against a debt that no chargeback record backs.
  const res = await locked(() =>
    addPayrollAdjustment({
      companyId: user.companyId,
      payrollRunId: parsed.data.payrollRunId,
      userId: parsed.data.userId,
      kind: parsed.data.kind,
      amountCents: parsed.data.amountCents,
      reason: parsed.data.reason,
      createdById: user.userId,
      leadId: parsed.data.leadId ?? null,
      projectId: parsed.data.projectId ?? null,
    })
  );
  if (!res.ok) return fail(res.error);
  revalidatePath(`/portal/payroll/${parsed.data.payrollRunId}`);
  return { ok: true as const };
}

const editSchema = z.object({
  adjustmentId: z.string().min(1),
  payrollRunId: z.string().min(1),
  amountCents: z.number().int().positive().optional(),
  reason: z.string().min(3).max(300).optional(),
});

export async function updatePayrollAdjustmentAction(input: z.infer<typeof editSchema>) {
  const user = await guard("update");
  if (!user) return fail("Not allowed.");
  const parsed = editSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid adjustment.");
  const res = await locked(() =>
    updatePayrollAdjustment({
      companyId: user.companyId,
      adjustmentId: parsed.data.adjustmentId,
      amountCents: parsed.data.amountCents,
      reason: parsed.data.reason,
      updatedById: user.userId,
    })
  );
  if (!res.ok) return fail(res.error);
  revalidatePath(`/portal/payroll/${parsed.data.payrollRunId}`);
  return { ok: true as const };
}

export async function deletePayrollAdjustmentAction(adjustmentId: string, payrollRunId: string) {
  const user = await guard("update");
  if (!user) return fail("Not allowed.");
  const res = await locked(() =>
    deletePayrollAdjustment({ companyId: user.companyId, adjustmentId })
  );
  if (!res.ok) return fail(res.error);
  revalidatePath(`/portal/payroll/${payrollRunId}`);
  return { ok: true as const };
}

// --------------------------- Finalisation -----------------------------------

/**
 * Close a run. ONE WAY — there is no re-open action, here or anywhere, because
 * an unlock button is the same thing as no lock at all.
 */
export async function finalizePayrollRunAction(payrollRunId: string) {
  const user = await guard("update");
  if (!user) return fail("Not allowed.");
  const res = await finalizePayrollRun({
    companyId: user.companyId,
    payrollRunId,
    actorId: user.userId,
  });
  revalidatePath(`/portal/payroll/${payrollRunId}`);
  revalidatePath("/portal/payroll");
  return res.alreadyFinal
    ? { ok: true as const, message: "This run was already finalised." }
    : { ok: true as const };
}

// --------------------------- Chargebacks ------------------------------------

const chargebackSchema = z.object({
  userId: z.string().min(1),
  amountCents: z.number().int().positive(),
  // The enum IS the whitelist of rep-caused reasons. An installation failure, a
  // permitting problem, a utility refusal or a lender issue is not on it and
  // cannot be selected — those are the company's risk, not the rep's pay.
  reason: z.enum(REP_CAUSED_REASONS as [string, ...string[]]),
  notes: z.string().max(1000).optional().nullable(),
  commissionId: z.string().optional().nullable(),
  projectId: z.string().optional().nullable(),
  leadId: z.string().optional().nullable(),
});

export async function requestChargebackAction(input: z.infer<typeof chargebackSchema>) {
  const user = await guard("approve");
  if (!user) return fail("Not allowed.");
  const parsed = chargebackSchema.safeParse(input);
  if (!parsed.success) return fail("Pick a documented rep-caused reason and an amount.");

  const cb = await requestChargeback({
    companyId: user.companyId,
    userId: parsed.data.userId,
    amountCents: parsed.data.amountCents,
    reason: parsed.data.reason as (typeof REP_CAUSED_REASONS)[number],
    notes: parsed.data.notes ?? null,
    requestedById: user.userId,
    commissionId: parsed.data.commissionId ?? null,
    projectId: parsed.data.projectId ?? null,
    leadId: parsed.data.leadId ?? null,
  });
  revalidatePath("/portal/commissions");
  return { ok: true as const, chargebackId: cb.id };
}

export async function approveChargebackAction(chargebackId: string) {
  const user = await guard("approve");
  if (!user) return fail("Not allowed.");
  const res = await approveChargeback({
    companyId: user.companyId,
    chargebackId,
    approvedById: user.userId,
  });
  if (!res.ok) return fail(res.error);
  revalidatePath("/portal/commissions");
  return { ok: true as const };
}

export async function rejectChargebackAction(chargebackId: string, notes?: string) {
  const user = await guard("approve");
  if (!user) return fail("Not allowed.");
  const res = await rejectChargeback({
    companyId: user.companyId,
    chargebackId,
    rejectedById: user.userId,
    notes: notes ?? null,
  });
  if (!res.ok) return fail(res.error);
  revalidatePath("/portal/commissions");
  return { ok: true as const };
}

const recoverySchema = z.object({
  chargebackId: z.string().min(1),
  payrollRunId: z.string().min(1),
  /** How much to take THIS run. The admin's choice every time. */
  amountCents: z.number().int().positive(),
  notes: z.string().max(300).optional().nullable(),
});

export async function recordChargebackRecoveryAction(input: z.infer<typeof recoverySchema>) {
  const user = await guard("update");
  if (!user) return fail("Not allowed.");
  const parsed = recoverySchema.safeParse(input);
  if (!parsed.success) return fail("Enter an amount to recover.");

  const res = await locked(() =>
    recordChargebackRecovery({
      companyId: user.companyId,
      chargebackId: parsed.data.chargebackId,
      payrollRunId: parsed.data.payrollRunId,
      amountCents: parsed.data.amountCents,
      createdById: user.userId,
      notes: parsed.data.notes ?? null,
    })
  );
  if (!res.ok) return fail(res.error);
  if (!res.value.ok) return fail(res.value.error);
  revalidatePath(`/portal/payroll/${parsed.data.payrollRunId}`);
  return {
    ok: true as const,
    recoveredCents: res.value.recoveredCents,
    remainingCents: res.value.remainingCents,
  };
}
