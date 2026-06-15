"use server";

import { revalidatePath } from "next/cache";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { Prisma, ProjectCostType } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { listScope } from "@/server/rbac/policies";
import { putObject } from "@/server/storage";
import { computeDealCommission, resolveSplitSnapshot, applySplitSnapshot } from "@/lib/commission";
import { isStageCommissionEligible, COMMISSION_GATE_LABEL } from "@/server/modules/payroll/eligibility";
import { getDealJobCost } from "./job-cost";

function safeName(n: string): string {
  return n.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "file";
}

const COST_TYPES = new Set<ProjectCostType>(["labor", "material", "other"]);

/** Add a cost line (labor/material/other) to a project, with an optional invoice file. */
/**
 * Re-sync existing (non-paid) deal-split commissions to the CURRENT profit pool,
 * keeping each line's snapshotted split. Called after any deal-input change so the
 * Commission Payout never drifts from the live Deal Financials. Never creates lines —
 * editing the rep's global split still won't retroactively touch a deal.
 */
async function refreshDealSplitCommissions(companyId: string, projectId: string) {
  const existing = await prisma.commission.findMany({
    where: {
      companyId, projectId, ruleId: null, overrideId: null,
      status: { in: ["pending", "approved"] }, label: { startsWith: "Deal split" }, splitPct: { not: null },
    },
    select: { id: true, splitPct: true, splitFlatCents: true },
  });
  if (existing.length === 0) return;
  const project = await prisma.project.findFirst({
    where: { id: projectId, companyId },
    select: {
      contractValue: true, supplementCents: true, deductibleCents: true,
      repGetsSupplement: true,
      company: { select: { overheadPct: true, paFeePct: true } },
    },
  });
  if (!project) return;
  const { totalCents: costCents } = await getDealJobCost(companyId, projectId);
  const { repPoolBasisCents } = computeDealCommission({
    baseCents: project.contractValue, supplementCents: project.supplementCents, deductibleCents: project.deductibleCents,
    costCents, overheadPct: project.company.overheadPct, paFeePct: project.company.paFeePct, repSplitPct: 0,
    repWaivesSupplement: !project.repGetsSupplement,
  });
  await Promise.all(
    existing.map((c) =>
      prisma.commission.update({
        where: { id: c.id },
        data: { baseAmount: repPoolBasisCents, amount: applySplitSnapshot(repPoolBasisCents, c.splitPct!, c.splitFlatCents) },
      })
    )
  );
}

export async function addProjectCostAction(formData: FormData) {
  const user = await requireUser();
  if (!can(user, "update", "Commission")) return { ok: false as const, error: "Not allowed." };

  const projectId = String(formData.get("projectId") || "");
  const typeRaw = String(formData.get("type") || "material") as ProjectCostType;
  const type: ProjectCostType = COST_TYPES.has(typeRaw) ? typeRaw : "material";
  const label = String(formData.get("label") || "").trim();
  const vendor = (String(formData.get("vendor") || "").trim()) || null;
  const amountDollars = parseFloat(String(formData.get("amount") || "0"));
  const file = formData.get("file");

  if (!label) return { ok: false as const, error: "A label is required." };
  if (!Number.isFinite(amountDollars) || amountDollars < 0) return { ok: false as const, error: "Enter a valid amount." };

  const scope = listScope(user, "Project") as Prisma.ProjectWhereInput;
  const project = await prisma.project.findFirst({ where: { AND: [{ id: projectId }, scope] }, select: { id: true } });
  if (!project) return { ok: false as const, error: "Project not found or access denied." };

  let fileAssetId: string | null = null;
  if (file instanceof File && file.size > 0) {
    const buf = Buffer.from(await file.arrayBuffer());
    const key = `companies/${user.companyId}/invoices/${nanoid()}-${safeName(file.name)}`;
    await putObject(key, buf);
    const asset = await prisma.fileAsset.create({
      data: {
        companyId: user.companyId, kind: "document", name: file.name, storageKey: key,
        mimeType: file.type || null, size: buf.length, category: "invoice", projectId, uploadedById: user.userId,
      },
      select: { id: true },
    });
    fileAssetId = asset.id;
  }

  await prisma.projectCost.create({
    data: {
      companyId: user.companyId, projectId, type, label, vendor,
      amount: Math.round(amountDollars * 100), fileAssetId, createdById: user.userId,
    },
  });
  await refreshDealSplitCommissions(user.companyId, projectId);
  revalidatePath(`/portal/projects/${projectId}`);
  return { ok: true as const };
}

export async function deleteProjectCostAction(id: string) {
  const user = await requireUser();
  if (!can(user, "update", "Commission")) return { ok: false as const, error: "Not allowed." };
  const cost = await prisma.projectCost.findFirst({ where: { id, companyId: user.companyId }, select: { id: true, projectId: true } });
  if (!cost) return { ok: false as const, error: "Cost not found." };
  await prisma.projectCost.delete({ where: { id } });
  await refreshDealSplitCommissions(user.companyId, cost.projectId);
  revalidatePath(`/portal/projects/${cost.projectId}`);
  return { ok: true as const };
}

/** Compute the rep's commission from the deal worksheet and (re)write it for payroll. */
export async function generateDealCommissionAction(projectId: string) {
  const user = await requireUser();
  if (!can(user, "update", "Commission")) return { ok: false as const, error: "Not allowed." };

  const project = await prisma.project.findFirst({
    where: { id: projectId, companyId: user.companyId },
    select: {
      contractValue: true,
      supplementCents: true,
      deductibleCents: true,
      repGetsSupplement: true,
      companyProvidedLead: true,
      company: { select: { overheadPct: true, paFeePct: true } },
      lead: { select: { stageId: true, assignedRep: { select: { id: true, commissionSplitPct: true, providedLeadType: true, providedLeadSplitPct: true, providedLeadFlatCents: true, deductiblePct: true } } } },
    },
  });
  if (!project) return { ok: false as const, error: "Project not found." };

  // Gate: commissions can't be generated until the deal reaches Depreciation Requested.
  if (!(await isStageCommissionEligible(user.companyId, project.lead?.stageId ?? null))) {
    return { ok: false as const, error: `Commissions can only be generated once the job reaches ${COMMISSION_GATE_LABEL}.` };
  }

  const rep = project.lead?.assignedRep;
  if (!rep) return { ok: false as const, error: "This project's lead has no assigned rep." };

  const { totalCents: costTotal } = await getDealJobCost(user.companyId, projectId);
  // The pool (revenue − cost − overhead − PA fee); the rep gets one split % of it.
  const dc = computeDealCommission({
    baseCents: project.contractValue,
    supplementCents: project.supplementCents,
    deductibleCents: project.deductibleCents,
    costCents: costTotal,
    overheadPct: project.company.overheadPct,
    paFeePct: project.company.paFeePct,
    repSplitPct: 0,
    repWaivesSupplement: !project.repGetsSupplement,
  });

  // Keep the locked split if this deal already has one (snapshot); else snapshot the
  // rep's CURRENT terms. So editing a rep's split never changes an existing deal.
  const existing = await prisma.commission.findFirst({
    where: { companyId: user.companyId, projectId, userId: rep.id, overrideId: null, ruleId: null, status: { in: ["pending", "approved"] }, label: { startsWith: "Deal split" } },
    select: { splitPct: true, splitFlatCents: true },
  });
  const snap =
    existing && existing.splitPct != null
      ? { splitPct: existing.splitPct, splitFlatCents: existing.splitFlatCents }
      : resolveSplitSnapshot(project.companyProvidedLead, {
          selfGenPct: rep.commissionSplitPct,
          providedType: rep.providedLeadType,
          providedPct: rep.providedLeadSplitPct,
          providedFlatCents: rep.providedLeadFlatCents,
        });
  if (!snap) {
    return {
      ok: false as const,
      error: project.companyProvidedLead
        ? "Set this rep's provided-lead split (Team → member) first."
        : "Set this rep's commission split % (Team → member) first.",
    };
  }
  const splitAmount = applySplitSnapshot(dc.repPoolBasisCents, snap.splitPct, snap.splitFlatCents);
  const splitLabel =
    snap.splitFlatCents > 0
      ? `Deal split (${snap.splitPct}% − ${(snap.splitFlatCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })} lead fee · provided lead)`
      : `Deal split (${snap.splitPct}%${project.companyProvidedLead ? " · provided lead" : ""})`;

  // The rep's deductible share = the rep's OWN deductible % (independent of the
  // pool split / lead source). The deductible is collected on top of the pool.
  const repDeductiblePct = rep.deductiblePct ?? 0;
  const deductibleAmount = project.deductibleCents > 0 ? Math.round((project.deductibleCents * repDeductiblePct) / 100) : 0;

  // Replace this rep's non-paid lines (pool split + deductible share) and rewrite them.
  await prisma.$transaction([
    prisma.commission.deleteMany({ where: { companyId: user.companyId, projectId, userId: rep.id, overrideId: null, status: { in: ["pending", "approved"] } } }),
    prisma.commission.create({
      data: { companyId: user.companyId, projectId, userId: rep.id, label: splitLabel, baseAmount: dc.repPoolBasisCents, amount: splitAmount, splitPct: snap.splitPct, splitFlatCents: snap.splitFlatCents, status: "pending" },
    }),
    ...(deductibleAmount > 0
      ? [
          prisma.commission.create({
            data: {
              companyId: user.companyId, projectId, userId: rep.id,
              label: `Deductible share (${repDeductiblePct}% of ${(project.deductibleCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })})`,
              baseAmount: project.deductibleCents, amount: deductibleAmount, status: "pending" as const,
            },
          }),
        ]
      : []),
  ]);
  revalidatePath(`/portal/projects/${projectId}`);
  revalidatePath("/portal/commissions");
  return { ok: true as const, amount: splitAmount + deductibleAmount };
}

// --- Deal supplement / deductible (both increase the effective contract) -----

const adjustmentSchema = z.object({
  projectId: z.string().min(1),
  field: z.enum(["supplement", "deductible", "depreciation"]),
  amountCents: z.number().int().min(0),
});

/** Set a deal's supplement / deductible / depreciation amount (cents). */
export async function setDealAdjustmentAction(input: z.infer<typeof adjustmentSchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Commission")) return { ok: false as const, error: "Not allowed." };
  const parsed = adjustmentSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Enter a valid amount." };
  const { projectId, field, amountCents } = parsed.data;
  const project = await prisma.project.findFirst({ where: { id: projectId, companyId: user.companyId }, select: { id: true } });
  if (!project) return { ok: false as const, error: "Project not found." };
  const data =
    field === "supplement"
      ? { supplementCents: amountCents }
      : field === "deductible"
        ? { deductibleCents: amountCents }
        : { depreciationCents: amountCents };
  await prisma.project.update({ where: { id: project.id }, data });
  await refreshDealSplitCommissions(user.companyId, projectId);
  revalidatePath(`/portal/projects/${projectId}`);
  return { ok: true as const };
}

const repGetsSchema = z.object({
  projectId: z.string().min(1),
  field: z.enum(["supplement", "depreciation"]),
  value: z.boolean(),
});

/** Toggle whether the rep gets the supplement / depreciation in their split on this deal. */
export async function setDealRepGetsAction(input: z.infer<typeof repGetsSchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Commission")) return { ok: false as const, error: "Not allowed." };
  const parsed = repGetsSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid request." };
  const { projectId, field, value } = parsed.data;
  const project = await prisma.project.findFirst({ where: { id: projectId, companyId: user.companyId }, select: { id: true } });
  if (!project) return { ok: false as const, error: "Project not found." };
  await prisma.project.update({
    where: { id: project.id },
    data: field === "supplement" ? { repGetsSupplement: value } : { repGetsDepreciation: value },
  });
  await refreshDealSplitCommissions(user.companyId, projectId);
  revalidatePath(`/portal/projects/${projectId}`);
  return { ok: true as const };
}

const leadProvidedSchema = z.object({ projectId: z.string().min(1), provided: z.boolean() });

/** Mark whether the COMPANY provided this deal's lead (picks the provided-lead split). */
export async function setDealLeadProvidedAction(input: z.infer<typeof leadProvidedSchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Commission")) return { ok: false as const, error: "Not allowed." };
  const parsed = leadProvidedSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid request." };
  const project = await prisma.project.findFirst({ where: { id: parsed.data.projectId, companyId: user.companyId }, select: { id: true } });
  if (!project) return { ok: false as const, error: "Project not found." };
  await prisma.project.update({ where: { id: project.id }, data: { companyProvidedLead: parsed.data.provided } });
  revalidatePath(`/portal/projects/${parsed.data.projectId}`);
  return { ok: true as const };
}

// --- Settings: company overhead % + per-rep split % --------------------------

export async function setOverheadPctAction(pct: number) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return { ok: false as const, error: "Not allowed." };
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return { ok: false as const, error: "Enter a percent between 0 and 100." };
  await prisma.company.update({ where: { id: user.companyId }, data: { overheadPct: pct } });
  revalidatePath("/portal/settings/commissions");
  return { ok: true as const };
}

export async function setPaFeePctAction(pct: number) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return { ok: false as const, error: "Not allowed." };
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return { ok: false as const, error: "Enter a percent between 0 and 100." };
  await prisma.company.update({ where: { id: user.companyId }, data: { paFeePct: pct } });
  revalidatePath("/portal/settings/commissions");
  return { ok: true as const };
}

// Rep splits are edited per-rep on each Team member's profile
// (updateTeamMemberAction → User.commissionSplitPct). The duplicate bulk editor
// that lived in Commission settings was removed, so there's no setRepSplitAction.

const scheduleSchema = z.object({
  projectId: z.string().min(1),
  field: z.enum(["adjuster", "install"]),
  date: z.string().optional().nullable(), // "YYYY-MM-DD" or null to clear
});

/** Set a project's adjuster-meeting or install date (shown on the calendar). */
export async function setProjectScheduleAction(input: z.infer<typeof scheduleSchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Project") && !can(user, "update", "Commission")) {
    return { ok: false as const, error: "Not allowed." };
  }
  const parsed = scheduleSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid request." };
  const { projectId, field, date } = parsed.data;
  const project = await prisma.project.findFirst({ where: { id: projectId, companyId: user.companyId }, select: { id: true, leadId: true } });
  if (!project) return { ok: false as const, error: "Project not found." };
  const value = date ? new Date(`${date}T12:00:00`) : null;
  if (value && Number.isNaN(value.getTime())) return { ok: false as const, error: "Enter a valid date." };
  await prisma.project.update({
    where: { id: project.id },
    data: field === "adjuster" ? { adjusterMeetingAt: value } : { installDate: value },
  });
  revalidatePath(`/portal/leads/${project.leadId}`);
  revalidatePath("/portal/calendar");
  return { ok: true as const };
}
