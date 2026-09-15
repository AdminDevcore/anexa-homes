import { prisma } from "@/server/db/client";
import type { Db } from "@/server/db/types";
import { runUnscoped } from "@/server/vertical/context";

/**
 * EVERY RECORD A PAYROLL WRITE NAMES BELONGS TO THE COMPANY WRITING IT.
 *
 * The ledger functions always scoped the row they CHANGE — `{ id, companyId }`
 * on the adjustment, the chargeback, the run. What they never checked was
 * everything else a caller hands in: the payee, the deal, the job, the
 * commission a chargeback claws back. A payroll admin at one company could tag
 * an adjustment to another company's deal, or raise a chargeback against
 * another company's rep, and the write went through with a foreign key into
 * somebody else's tenant.
 *
 * NOT a `"use server"` module: the company is a parameter, and the only place
 * it may come from is the session (or, inside the ledger, a row already loaded
 * under that session's company). An elevated role changes nothing here — a
 * super admin is more power INSIDE a company, never a way out of it.
 *
 * Unscoped by VERTICAL on purpose. Payroll is company-wide — a solar deal is
 * paid on the same run as a roofing one — so the workspace is not the boundary;
 * the tenant is, and every lookup below states it explicitly.
 *
 * Refusals say "not found", never "belongs to another company": a refusal must
 * not confirm that an id exists somewhere else.
 */

/**
 * A refusal to show the person, not a crash: a record that is not theirs, a
 * reason that is only whitespace, an edit the ledger does not allow. The server
 * actions turn it into `{ ok: false, error }`.
 */
export class PayrollRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayrollRefusedError";
  }
}

export type PayrollReferences = {
  userId?: string | null;
  leadId?: string | null;
  projectId?: string | null;
  commissionId?: string | null;
  chargebackId?: string | null;
  payrollRunId?: string | null;
};

/**
 * Throws `PayrollRefusedError` unless every id given is this company's, and the
 * ones given together describe the same thing: a job on the named deal, a
 * commission on the named job and paid to the named person, a chargeback owed
 * by the named person.
 *
 * Pass the transaction client when called inside one, so the checks read what
 * the transaction sees.
 */
export async function assertPayrollReferences(
  companyId: string,
  refs: PayrollReferences,
  db: Db = prisma
): Promise<void> {
  await runUnscoped("payroll: the records a ledger write names are checked against the company", async () => {
    if (refs.payrollRunId) {
      const run = await db.payrollRun.findFirst({ where: { id: refs.payrollRunId, companyId }, select: { id: true } });
      if (!run) throw new PayrollRefusedError("Payroll run not found.");
    }

    if (refs.userId) {
      const user = await db.user.findFirst({ where: { id: refs.userId, companyId }, select: { id: true } });
      if (!user) throw new PayrollRefusedError("That person was not found.");
    }

    if (refs.leadId) {
      const lead = await db.lead.findFirst({ where: { id: refs.leadId, companyId }, select: { id: true } });
      if (!lead) throw new PayrollRefusedError("Deal not found.");
    }

    if (refs.projectId) {
      const project = await db.project.findFirst({
        where: { id: refs.projectId, companyId },
        select: { leadId: true },
      });
      if (!project) throw new PayrollRefusedError("Job not found.");
      if (refs.leadId && project.leadId !== refs.leadId) {
        throw new PayrollRefusedError("That job belongs to a different deal.");
      }
    }

    if (refs.commissionId) {
      const commission = await db.commission.findFirst({
        where: { id: refs.commissionId, companyId },
        select: { userId: true, projectId: true, project: { select: { leadId: true } } },
      });
      if (!commission) throw new PayrollRefusedError("Commission not found.");
      if (refs.userId && commission.userId !== refs.userId) {
        throw new PayrollRefusedError("That commission was paid to somebody else.");
      }
      if (refs.projectId && commission.projectId !== refs.projectId) {
        throw new PayrollRefusedError("That commission is on a different job.");
      }
      if (refs.leadId && commission.project.leadId !== refs.leadId) {
        throw new PayrollRefusedError("That commission is on a different deal.");
      }
    }

    if (refs.chargebackId) {
      const chargeback = await db.chargeback.findFirst({
        where: { id: refs.chargebackId, companyId },
        select: { userId: true },
      });
      if (!chargeback) throw new PayrollRefusedError("Chargeback not found.");
      if (refs.userId && chargeback.userId !== refs.userId) {
        throw new PayrollRefusedError("That chargeback is owed by somebody else.");
      }
    }
  });
}
