import { prisma } from "@/server/db/client";

/**
 * What a payroll run owes as of the end of its period.
 *
 * NOT a `"use server"` module — it takes a `companyId`. It lives apart from
 * `actions.ts` so the sweep can be tested directly; the rule it encodes is the
 * one place money can silently disappear, so it is worth being able to prove.
 *
 * ── THERE IS NO LOWER BOUND, ON PURPOSE ────────────────────────────────────
 * A run pays everything approved and not yet batched, however old. The earlier
 * version required the line to have been CREATED inside the period, which
 * stranded money in two ordinary situations:
 *
 *   • a commission created in one week but approved three weeks later fell
 *     outside every future window and could never be batched again;
 *   • the lines released by a deleted run were only re-batchable by a run whose
 *     window happened to cover their original creation date.
 *
 * Payroll pays what is owed and unpaid. The only date test is that it became
 * payable by the time the period closed, which is exactly the rule that makes a
 * late M1 safe — and it is also what makes a MONDAY-TO-FRIDAY period workable
 * at all. A workweek excludes the weekend, so an M1 confirmed on a Saturday is
 * inside no period whatsoever. With no lower bound it is simply swept up by the
 * next Thursday, whose period ends after it. With one, it would have fallen
 * into the gap between two workweeks and never been payable. See `schedule.ts`.
 *
 * ── `approvedAt`, NOT `createdAt` ──────────────────────────────────────────
 * The day the money became payable, not the day the row appeared. Rows approved
 * before that column existed fall back to `createdAt`.
 *
 * ── NO VERTICAL FILTER ─────────────────────────────────────────────────────
 * Deliberately the plain client. Payroll is a company-wide act; a run assembled
 * inside one workspace that silently omitted the other workspace's people would
 * look complete and short somebody their money.
 */

/** The shared shape: approved, unbatched, payable by `periodEnd`. */
export function payableWhere(companyId: string, periodEnd: Date) {
  return {
    companyId,
    status: "approved" as const,
    payrollItems: { none: {} },
    OR: [{ approvedAt: { lte: periodEnd } }, { approvedAt: null, createdAt: { lte: periodEnd } }],
  };
}

export async function collectPayables(companyId: string, periodEnd: Date) {
  const [commissions, contractorPays] = await Promise.all([
    prisma.commission.findMany({
      where: payableWhere(companyId, periodEnd),
      include: {
        user: { select: { firstName: true, lastName: true } },
        project: { select: { projectNumber: true } },
      },
    }),
    prisma.contractorPay.findMany({
      where: payableWhere(companyId, periodEnd),
      include: {
        user: { select: { firstName: true, lastName: true } },
        project: { select: { projectNumber: true } },
      },
    }),
  ]);
  return { commissions, contractorPays };
}
