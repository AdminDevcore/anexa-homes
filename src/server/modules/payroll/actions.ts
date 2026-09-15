"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { getActiveVertical } from "@/server/auth/vertical";
import { requireCan, can } from "@/server/rbac/guards";
import { fireEvent } from "@/server/modules/notifications/engine";
import { sendEmailWithAttachments } from "@/server/modules/notifications/delivery";
import { emailBrandFor } from "@/server/modules/notifications/brand";
import { brandedEmailTemplate } from "@/server/modules/notifications/email-templates";
import { formatCents } from "@/lib/format";
import { computeCommissionsForProject } from "./engine";
import { getCommissionEligibleStageIds, commissionGateLabel } from "./eligibility";
import { generateOutcomeMessage } from "./gate";
import { getPayStubData, getRunStubList, buildPayStubPdf } from "./paystub";
import { postRunToBookkeeping } from "./post-bookkeeping";
import { collectPayables } from "./payables";

function fail(error: string) {
  return { ok: false as const, error };
}
function ok<T extends object = object>(data?: T) {
  return { ok: true as const, ...(data ?? {}) };
}

// --------------------------- Commission generation ---------------------------

export async function generateCommissionsAction() {
  const user = await requireUser();
  if (!can(user, "update", "Commission")) return fail("Not allowed.");

  // Only deals at or past their pipeline's gate are eligible — Roofing waits on
  // the depreciation request, Solar on the lender's M1 funding. See
  // ./gate.ts for why the two verticals gate in different places.
  const eligibleStageIds = await getCommissionEligibleStageIds(user.companyId);
  // Name the gate the user is actually behind, in the workspace they're standing in.
  const gate = commissionGateLabel(await getActiveVertical(user));

  /**
   * A SOLAR deal needs M1 FUNDING RECORDED, not merely a stage that says so.
   *
   * The stage gate says where the deal has got to in the pipeline; the milestone
   * says the lender's first payment actually landed. They are not the same fact,
   * and paying a rep on the first is advancing them the company's own cash on a
   * job that can still cancel. `SolarMilestone(payee: rep, sequence: 1).paidAt`
   * is where somebody marks that money received — see solar/cockpit-actions.ts.
   *
   * Roofing is untouched: its gate is the depreciation request and it has no
   * milestone row, so the extra condition applies only to the solar side.
   *
   * There is no partial-M1 rule. The milestone is paid or it is not, and a rep
   * gets 100% of what they are owed from it. M2 is company money and generates
   * no rep commission at all, which is why nothing here consults it.
   */
  const projects = eligibleStageIds.size
    ? await prisma.project.findMany({
        where: {
          companyId: user.companyId,
          lead: { stageId: { in: [...eligibleStageIds] } },
          OR: [
            { vertical: { not: "solar" } },
            { lead: { is: { solarMilestones: { some: { payee: "rep", sequence: 1, paidAt: { not: null } } } } } },
          ],
        },
        select: { id: true },
      })
    : [];

  let created = 0;
  for (const p of projects) {
    created += await computeCommissionsForProject(prisma, user.companyId, p.id);
  }
  revalidatePath("/portal/commissions");

  // "0 generated" on its own reads as a broken button, and "already paid out"
  // reads as a lie when the page is empty. Which of the two it is turns on
  // whether the eligible deals came out of the engine carrying anything at all,
  // so count them rather than assume. See generateOutcomeMessage.
  const withLines = projects.length
    ? await prisma.commission.findMany({
        where: { projectId: { in: projects.map((p) => p.id) } },
        select: { projectId: true },
        distinct: ["projectId"],
      })
    : [];
  const message = generateOutcomeMessage({
    gate,
    created,
    eligible: projects.length,
    withLines: withLines.length,
  });
  return { ok: true as const, created, message };
}

// --------------------------- Commission status ------------------------------

async function setCommissionStatus(
  userCompanyId: string,
  id: string,
  data: Prisma.CommissionUpdateInput
) {
  const c = await prisma.commission.findFirst({ where: { id, companyId: userCompanyId }, select: { id: true } });
  if (!c) throw new Error("Commission not found.");
  await prisma.commission.update({ where: { id }, data });
}

export async function approveCommissionAction(id: string) {
  const user = await requireUser();
  if (!can(user, "approve", "Commission")) return fail("Not allowed.");
  await setCommissionStatus(user.companyId, id, { status: "approved", approvedAt: new Date() });
  const commission = await prisma.commission.findUnique({ where: { id }, select: { projectId: true } });
  await fireEvent({ companyId: user.companyId, event: "commission_approved", actorId: user.userId, projectId: commission?.projectId ?? null });
  revalidatePath("/portal/commissions");
  return ok();
}

export async function markCommissionPaidAction(id: string) {
  const user = await requireUser();
  if (!can(user, "approve", "Commission")) return fail("Not allowed.");
  await setCommissionStatus(user.companyId, id, { status: "paid", paidAt: new Date() });
  revalidatePath("/portal/commissions");
  return ok();
}

export async function voidCommissionAction(id: string) {
  const user = await requireUser();
  if (!can(user, "update", "Commission")) return fail("Not allowed.");
  await setCommissionStatus(user.companyId, id, { status: "void" });
  revalidatePath("/portal/commissions");
  return ok();
}

export async function approveAllPendingCommissionsAction() {
  const user = await requireUser();
  if (!can(user, "approve", "Commission")) return fail("Not allowed.");
  const res = await prisma.commission.updateMany({
    where: { companyId: user.companyId, status: "pending" },
    data: { status: "approved", approvedAt: new Date() },
  });
  revalidatePath("/portal/commissions");
  return { ok: true as const, count: res.count };
}

// --------------------------- Commission rules -------------------------------

/**
 * Commission rules are roofing's. Solar pays a rep off the split on his own
 * profile and has no crew or project-manager line for a rule to pay out to, so
 * its hub no longer offers the page at all. CommissionRule rows are
 * vertical-isolated, so a rule written from a solar session lands in a
 * workspace whose payroll never asks for one — silently, with no error. The
 * guard is here as well as on the page because a server action is reachable
 * without it.
 */
async function rejectSolar(user: Parameters<typeof getActiveVertical>[0]) {
  return (await getActiveVertical(user)) === "solar"
    ? fail("Commission rules are set up in the Roofing workspace.")
    : null;
}

const ruleSchema = z.object({
  name: z.string().min(1).max(120),
  role: z.enum(["sales_rep", "manager", "project_manager", "installer"]),
  type: z.enum(["percentage", "flat", "job_cost"]),
  percent: z.number().min(0).max(100).default(0),
  flatAmount: z.number().int().min(0).default(0), // cents
  projectType: z.string().max(80).optional().or(z.literal("")),
});

export async function createCommissionRuleAction(input: z.infer<typeof ruleSchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const blocked = await rejectSolar(user);
  if (blocked) return blocked;
  const parsed = ruleSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid rule.");
  // The id comes back so the screen can OPEN the rule that was just created.
  const row = await prisma.commissionRule.create({
    data: {
      companyId: user.companyId,
      name: parsed.data.name,
      role: parsed.data.role,
      type: parsed.data.type,
      percent: parsed.data.percent,
      flatAmount: parsed.data.flatAmount,
      projectType: parsed.data.projectType || null,
    },
    select: { id: true },
  });
  revalidatePath("/portal/settings/commissions");
  return { ok: true as const, id: row.id };
}

export async function updateCommissionRuleAction(id: string, input: z.infer<typeof ruleSchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const blocked = await rejectSolar(user);
  if (blocked) return blocked;
  const parsed = ruleSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid rule.");
  const existing = await prisma.commissionRule.findFirst({ where: { id, companyId: user.companyId }, select: { id: true } });
  if (!existing) return fail("Rule not found.");
  await prisma.commissionRule.update({
    where: { id },
    data: {
      name: parsed.data.name,
      role: parsed.data.role,
      type: parsed.data.type,
      percent: parsed.data.percent,
      flatAmount: parsed.data.flatAmount,
      projectType: parsed.data.projectType || null,
    },
  });
  revalidatePath("/portal/settings/commissions");
  return ok();
}

export async function toggleCommissionRuleAction(id: string, active: boolean) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const blocked = await rejectSolar(user);
  if (blocked) return blocked;
  const existing = await prisma.commissionRule.findFirst({ where: { id, companyId: user.companyId }, select: { id: true } });
  if (!existing) return fail("Rule not found.");
  await prisma.commissionRule.update({ where: { id }, data: { active } });
  revalidatePath("/portal/settings/commissions");
  return ok();
}

export async function deleteCommissionRuleAction(id: string) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const blocked = await rejectSolar(user);
  if (blocked) return blocked;
  const existing = await prisma.commissionRule.findFirst({ where: { id, companyId: user.companyId }, select: { id: true } });
  if (!existing) return fail("Rule not found.");
  await prisma.commissionRule.delete({ where: { id } });
  revalidatePath("/portal/settings/commissions");
  return ok();
}

// --------------------------- Payroll runs -----------------------------------

const runSchema = z.object({
  label: z.string().min(1).max(120),
  periodStart: z.string(),
  periodEnd: z.string(),
});

export async function createPayrollRunAction(input: z.infer<typeof runSchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Payroll")) return fail("Not allowed.");
  const parsed = runSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid payroll period.");

  const start = new Date(parsed.data.periodStart);
  const end = new Date(parsed.data.periodEnd);
  end.setHours(23, 59, 59, 999);

  /* One run pays EVERYONE we owe as of the end of the period — commissions and
   * contractor invoices alike, because the crew that built the job is owed as
   * surely as the rep that sold it. The sweep and the reason it has no lower
   * bound live in `payables.ts`; the short version is that a late M1 lands on
   * the next run instead of falling out of existence. */
  const { commissions, contractorPays } = await collectPayables(user.companyId, end);

  if (commissions.length + contractorPays.length === 0) {
    return fail("No approved commissions or contractor invoices found in that period.");
  }

  const run = await prisma.payrollRun.create({
    data: {
      companyId: user.companyId,
      label: parsed.data.label,
      periodStart: start,
      periodEnd: end,
      status: "draft",
      items: {
        create: [
          ...commissions.map((c) => ({
            userId: c.userId,
            commissionId: c.id,
            label: `${c.label ?? "Commission"} — ${c.project.projectNumber}`,
            amount: c.amount,
          })),
          // "Contractor invoice", not the file's name. A pay stub line reading
          // "IMG_4821.jpg" tells the person being paid nothing, and the stub is
          // the one document in this flow the contractor actually receives.
          ...contractorPays.map((p) => ({
            userId: p.userId,
            contractorPayId: p.id,
            label: p.project?.projectNumber
              ? `Contractor invoice — ${p.project.projectNumber}`
              : "Contractor invoice",
            amount: p.amount,
          })),
        ],
      },
    },
  });

  revalidatePath("/portal/payroll");
  return { ok: true as const, runId: run.id, items: commissions.length + contractorPays.length };
}

export async function approvePayrollRunAction(id: string) {
  const user = await requireUser();
  if (!can(user, "approve", "Payroll")) return fail("Not allowed.");
  const run = await prisma.payrollRun.findFirst({ where: { id, companyId: user.companyId }, select: { id: true } });
  if (!run) return fail("Run not found.");
  await prisma.payrollRun.update({ where: { id }, data: { status: "approved", approvedAt: new Date() } });
  await fireEvent({ companyId: user.companyId, event: "payroll_approved", actorId: user.userId });
  revalidatePath(`/portal/payroll/${id}`);
  revalidatePath("/portal/payroll");
  return ok();
}

export async function markPayrollRunPaidAction(id: string) {
  const user = await requireUser();
  if (!can(user, "update", "Payroll")) return fail("Not allowed.");
  const run = await prisma.payrollRun.findFirst({
    where: { id, companyId: user.companyId },
    include: { items: true },
  });
  if (!run) return fail("Run not found.");
  if (run.status === "paid") return ok(); // already paid — nothing to do

  const commissionIds = run.items.map((i) => i.commissionId).filter((x): x is string => !!x);
  // Contractor lines settle in the same transaction as the commission lines.
  // Left out, the money would leave the building while Contractor Pay still
  // read "approved" and the next run would batch the same invoice again.
  const contractorPayIds = run.items.map((i) => i.contractorPayId).filter((x): x is string => !!x);

  await prisma.$transaction([
    prisma.payrollItem.updateMany({ where: { payrollRunId: id }, data: { paid: true } }),
    prisma.commission.updateMany({
      where: { id: { in: commissionIds } },
      data: { status: "paid", paidAt: new Date() },
    }),
    prisma.contractorPay.updateMany({
      where: { id: { in: contractorPayIds } },
      data: { status: "paid", paidAt: new Date() },
    }),
    prisma.payrollRun.update({ where: { id }, data: { status: "paid", paidAt: new Date() } }),
  ]);

  // Book the payout to Bookkeeping: one money-out txn per commission line,
  // deal-tagged + rep as vendor + pay stub attached. Best-effort: a booking
  // hiccup must not leave the run un-paid.
  try {
    await postRunToBookkeeping(user.companyId, id, user.userId);
  } catch (err) {
    console.error("[payroll] postRunToBookkeeping failed", id, err);
  }

  revalidatePath(`/portal/payroll/${id}`);
  revalidatePath("/portal/payroll");
  revalidatePath("/portal/contractor-pay");
  revalidatePath("/portal/bookkeeping");
  return ok();
}

/**
 * Delete a payroll run that hasn't been paid yet (draft or approved). Cascades
 * its PayrollItems; the linked commissions and contractor-pay lines are NOT
 * deleted — they stay `approved` and return to the unbatched pool so a
 * corrected run can pick them up. That is also what unlocks a contractor's
 * amount for editing again. Paid runs can never be deleted (money already
 * disbursed).
 */
export async function deletePayrollRunAction(id: string) {
  const user = await requireUser();
  if (!can(user, "update", "Payroll")) return fail("Not allowed.");
  const runRow = await prisma.payrollRun.findFirst({
    where: { id, companyId: user.companyId },
    select: { id: true, status: true, finalizedAt: true },
  });
  if (!runRow) return fail("Run not found.");
  if (runRow.status === "paid") return fail("Paid payroll runs can't be deleted.");
  /* A FINALISED RUN IS A HISTORICAL RECORD, whether or not the money has moved
   * yet. Deleting one would erase the statement somebody was given and release
   * its lines back into the pool to be paid a second time — which is the exact
   * outcome finalisation exists to make impossible. A correction goes on the
   * next run. */
  if (runRow.finalizedAt) {
    return fail("Finalised payroll runs can't be deleted. Put the correction on the next run.");
  }

  await prisma.payrollRun.delete({ where: { id } });
  revalidatePath("/portal/payroll");
  revalidatePath("/portal/contractor-pay");
  return ok();
}

// --------------------------- Pay stub email ----------------------------------

const emailStubSchema = z.object({ runId: z.string().min(1), userId: z.string().min(1) });

/** Email an employee their pay stub (PDF attached). */
export async function emailPayStubAction(input: z.infer<typeof emailStubSchema>) {
  const me = await requireUser();
  if (!can(me, "export", "Payroll")) return fail("Not allowed.");
  const parsed = emailStubSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid request.");

  const data = await getPayStubData(me.companyId, parsed.data.runId, parsed.data.userId);
  if (!data) return fail("No pay stub for this employee in this run.");
  if (!data.employee.email) return fail("That employee has no email on file.");

  const { brand, fromName } = await emailBrandFor(me.companyId);

  const pdf = await buildPayStubPdf(data);
  /**
   * THE NET, off the same breakdown the PDF prints.
   *
   * This line summed `data.items` — the commission lines alone — and called the
   * answer "Net pay". A rep with a $1,000 trenching deduction was emailed
   * "Net pay: $10,000" over an attachment that correctly said $9,000, and a
   * bank transfer that agreed with the attachment. `payStubBreakdown` already
   * folds in bonuses, deductions and chargeback recoveries; `getPayStubData`
   * already returns it.
   */
  const netPay = data.breakdown.finalCents;
  const tpl = brandedEmailTemplate({
    brand,
    subject: `Your pay stub — ${data.run.label}`,
    heading: "Your pay stub is ready",
    paragraphs: [
      `Hi ${data.employee.firstName},`,
      `Your pay stub for ${data.run.label} is attached as a PDF. Net pay: ${formatCents(netPay)}.`,
    ],
    note: "This pay stub is confidential — please keep it for your records.",
  });
  await sendEmailWithAttachments(
    data.employee.email,
    tpl.subject,
    tpl.text,
    [{ filename: `paystub-${data.run.label.replace(/[^a-z0-9]+/gi, "-")}.pdf`, content: pdf }],
    { fromName, html: tpl.html }
  );
  return { ok: true as const, email: data.employee.email, dev: !process.env.RESEND_API_KEY };
}

/** Email every employee in a run their own pay stub; returns a per-recipient summary. */
export async function emailAllPayStubsAction(runId: string) {
  const me = await requireUser();
  if (!can(me, "export", "Payroll")) return fail("Not allowed.");
  const list = await getRunStubList(me.companyId, runId);
  if (list.length === 0) return fail("No pay stubs in this run.");

  const { brand, fromName } = await emailBrandFor(me.companyId);

  const results: { name: string; email: string | null; sent: boolean; error?: string }[] = [];
  for (const data of list) {
    const name = `${data.employee.firstName} ${data.employee.lastName}`.trim();
    if (!data.employee.email) {
      results.push({ name, email: null, sent: false, error: "No email on file" });
      continue;
    }
    try {
      const pdf = await buildPayStubPdf(data);
      // The net, not the commission subtotal — see `emailPayStubAction`.
      const netPay = data.breakdown.finalCents;
      const tpl = brandedEmailTemplate({
        brand,
        subject: `Your pay stub — ${data.run.label}`,
        heading: "Your pay stub is ready",
        paragraphs: [
          `Hi ${data.employee.firstName},`,
          `Your pay stub for ${data.run.label} is attached as a PDF. Net pay: ${formatCents(netPay)}.`,
        ],
        note: "This pay stub is confidential — please keep it for your records.",
      });
      await sendEmailWithAttachments(
        data.employee.email,
        tpl.subject,
        tpl.text,
        [{ filename: `paystub-${data.run.label.replace(/[^a-z0-9]+/gi, "-")}.pdf`, content: pdf }],
        { fromName, html: tpl.html }
      );
      results.push({ name, email: data.employee.email, sent: true });
    } catch {
      results.push({ name, email: data.employee.email, sent: false, error: "Send failed" });
    }
  }
  const sent = results.filter((r) => r.sent).length;
  return { ok: true as const, sent, total: results.length, results, dev: !process.env.RESEND_API_KEY };
}
