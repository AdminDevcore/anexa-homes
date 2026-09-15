"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { leadAccessible } from "@/server/rbac/lead-access";
import { listScope } from "@/server/rbac/policies";
import { getActiveVertical } from "@/server/auth/vertical";
import { canSeeScopeCosts } from "@/server/modules/scope/policies";
import { computeEstimate } from "@/lib/estimate";
import { ensureProposal } from "@/server/modules/proposals/queries";

type Result = { ok: true } | { ok: false; error: string };


/**
 * Get-or-create the estimate for a lead the user can edit.
 *
 * Estimates reuse the `Scope` resource rather than introducing one of their own:
 * the roles that may price a job are exactly the roles that may work a scope,
 * and sales_rep already holds read+update there. What separates them is COST
 * visibility, which `canSeeScopeCosts` gates independently.
 */
async function ensureEstimate(
  leadId: string
): Promise<{ ok: true; estimateId: string; companyId: string } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can(user, "update", "Scope")) return { ok: false, error: "Not allowed." };
  const lead = await leadAccessible(user, leadId);
  if (!lead) return { ok: false, error: "Deal not found or access denied." };

  const existing = await prisma.estimate.findUnique({ where: { leadId }, select: { id: true } });
  if (existing) return { ok: true, estimateId: existing.id, companyId: user.companyId };

  const vertical = await getActiveVertical(user);
  const created = await prisma.estimate.create({
    data: { companyId: user.companyId, leadId, vertical },
    select: { id: true },
  });
  return { ok: true, estimateId: created.id, companyId: user.companyId };
}

export async function ensureEstimateAction(leadId: string): Promise<Result> {
  const res = await ensureEstimate(leadId);
  if (!res.ok) return res;
  revalidatePath(`/portal/leads/${leadId}`);
  return { ok: true };
}

// ── Line items ──────────────────────────────────────────────────────────────

export async function addEstimateLineAction(input: {
  leadId: string;
  category?: string;
  description?: string;
  unit?: string | null;
  catalogItemId?: string | null;
}): Promise<Result> {
  const ensured = await ensureEstimate(input.leadId);
  if (!ensured.ok) return ensured;

  const position = await prisma.estimateLine.count({ where: { estimateId: ensured.estimateId } });
  await prisma.estimateLine.create({
    data: {
      companyId: ensured.companyId,
      estimateId: ensured.estimateId,
      position,
      catalogItemId: input.catalogItemId || null,
      category: input.category?.trim() || "General",
      description: input.description?.trim() || "",
      unit: input.unit || null,
    },
  });
  revalidatePath(`/portal/leads/${input.leadId}`);
  return { ok: true };
}

/** Add several catalog items at once. Skips items already on the sheet, so the
 *  picker is safe to use twice without producing duplicate lines. */
export async function addCatalogItemsAction(input: {
  leadId: string;
  catalogItemIds: string[];
}): Promise<Result> {
  const ensured = await ensureEstimate(input.leadId);
  if (!ensured.ok) return ensured;
  if (input.catalogItemIds.length === 0) return { ok: false, error: "Pick at least one item." };

  const items = await prisma.scopeCatalogItem.findMany({
    where: { id: { in: input.catalogItemIds }, companyId: ensured.companyId, isActive: true },
    orderBy: [{ category: "asc" }, { subcategory: "asc" }, { position: "asc" }],
  });
  if (items.length === 0) return { ok: false, error: "Those catalog items no longer exist." };

  const already = new Set(
    (
      await prisma.estimateLine.findMany({
        where: { estimateId: ensured.estimateId, catalogItemId: { not: null } },
        select: { catalogItemId: true },
      })
    ).map((l) => l.catalogItemId)
  );
  const toAdd = items.filter((i) => !already.has(i.id));
  if (toAdd.length === 0) return { ok: false, error: "Those items are already on this estimate." };

  let position = await prisma.estimateLine.count({ where: { estimateId: ensured.estimateId } });
  await prisma.estimateLine.createMany({
    data: toAdd.map((i) => ({
      companyId: ensured.companyId,
      estimateId: ensured.estimateId,
      position: position++,
      catalogItemId: i.id,
      category: i.category,
      description: i.description,
      quantity: 0,
      unit: i.unit,
      unitPriceCents: 0,
    })),
  });
  revalidatePath(`/portal/leads/${input.leadId}`);
  return { ok: true };
}

export async function updateEstimateLineAction(input: {
  id: string;
  leadId: string;
  category?: string;
  description?: string;
  quantity?: number;
  unit?: string | null;
  unitPriceCents?: number;
}): Promise<Result> {
  const user = await requireUser();
  if (!can(user, "update", "Scope")) return { ok: false, error: "Not allowed." };
  const lead = await leadAccessible(user, input.leadId);
  if (!lead) return { ok: false, error: "Access denied." };

  // Confirm the line belongs to this lead's estimate (tenant-safe).
  const line = await prisma.estimateLine.findFirst({
    where: { id: input.id, companyId: user.companyId, estimate: { leadId: input.leadId } },
    select: { id: true },
  });
  if (!line) return { ok: false, error: "Line not found." };

  const data: Prisma.EstimateLineUpdateInput = {};
  if (input.category !== undefined) data.category = input.category.trim() || "General";
  if (input.description !== undefined) data.description = input.description;
  if (input.quantity !== undefined) data.quantity = Number.isFinite(input.quantity) ? Math.max(0, input.quantity) : 0;
  if (input.unit !== undefined) data.unit = input.unit || null;
  if (input.unitPriceCents !== undefined) {
    data.unitPriceCents = Math.max(0, Math.round(input.unitPriceCents));
  }

  await prisma.estimateLine.update({ where: { id: input.id }, data });
  revalidatePath(`/portal/leads/${input.leadId}`);
  return { ok: true };
}

export async function deleteEstimateLineAction(input: { id: string; leadId: string }): Promise<Result> {
  const user = await requireUser();
  if (!can(user, "update", "Scope")) return { ok: false, error: "Not allowed." };
  // The lookup below narrows to this leadId, but a leadId off the wire is not
  // proof the caller may touch that deal — this line is a job cost.
  if (!(await leadAccessible(user, input.leadId))) return { ok: false, error: "Line not found." };
  const line = await prisma.estimateLine.findFirst({
    where: { id: input.id, companyId: user.companyId, estimate: { leadId: input.leadId } },
    select: { id: true },
  });
  if (!line) return { ok: false, error: "Line not found." };
  await prisma.estimateLine.delete({ where: { id: input.id } });
  revalidatePath(`/portal/leads/${input.leadId}`);
  return { ok: true };
}

// ── The estimate itself ─────────────────────────────────────────────────────

export async function updateEstimateAction(input: {
  leadId: string;
  discountCents?: number;
  notes?: string;
  costTemplateId?: string | null;
}): Promise<Result> {
  const user = await requireUser();
  const ensured = await ensureEstimate(input.leadId);
  if (!ensured.ok) return ensured;

  const data: Prisma.EstimateUpdateInput = {};
  if (input.discountCents !== undefined) {
    data.discountCents = Number.isFinite(input.discountCents) ? Math.max(0, Math.round(input.discountCents)) : 0;
  }
  if (input.notes !== undefined) data.notes = input.notes.trim() || null;
  // The cost template only means anything to roles that can see cost — ignore it
  // silently for everyone else rather than letting a rep change what management reads.
  if (input.costTemplateId !== undefined && canSeeScopeCosts(user.role)) {
    data.costTemplate = input.costTemplateId
      ? { connect: { id: input.costTemplateId } }
      : { disconnect: true };
  }

  await prisma.estimate.update({ where: { id: ensured.estimateId }, data });
  revalidatePath(`/portal/leads/${input.leadId}`);
  return { ok: true };
}

/**
 * Send the estimate's total to the deal's price.
 *
 * Where it lands depends on how the deal is priced, because the two deal types
 * quote from different numbers:
 *  - CASH: the proposal quotes `content.projectPriceCents`, so that is what the
 *    total becomes — build the proposal next and the price is already in it.
 *  - INSURANCE: the proposal quotes the deductible and RCV and never reads a
 *    project price, so there is nothing there to set. The total lands on the
 *    project's contract value instead — the deal-value figure the pipeline and
 *    the commission math read.
 *
 * Explicit on purpose: editing a line never moves the deal's price on its own.
 */
export async function applyEstimateAsPriceAction(
  leadId: string
): Promise<{ ok: true; target: "proposal" | "deal"; totalCents: number } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can(user, "update", "Scope")) return { ok: false, error: "Not allowed." };
  const lead = await prisma.lead.findFirst({
    where: {
      AND: [{ id: leadId }, listScope(user, "Lead") as Prisma.LeadWhereInput],
    },
    select: { id: true, dealType: true, project: { select: { id: true } } },
  });
  if (!lead) return { ok: false, error: "Deal not found or access denied." };

  const estimate = await prisma.estimate.findUnique({
    where: { leadId },
    include: { lines: true },
  });
  if (!estimate || estimate.lines.length === 0) {
    return { ok: false, error: "Add at least one line before setting the price." };
  }

  // Cost plays no part here — the customer's price is the price, whoever asks.
  const calc = computeEstimate(
    estimate.lines.map((l) => ({
      quantity: l.quantity,
      unitPriceCents: l.unitPriceCents,
      costPerUnitCents: 0,
      category: l.category,
    })),
    { discountCents: estimate.discountCents }
  );
  if (calc.totalCents <= 0) return { ok: false, error: "This estimate totals zero — set quantities and prices first." };

  if (lead.dealType === "cash") {
    if (!can(user, "update", "Proposal")) return { ok: false, error: "You can't edit this deal's proposal." };
    if (!(await ensureProposal(user, leadId))) return { ok: false, error: "Could not open the proposal." };
    const proposal = await prisma.proposal.findFirst({
      where: { companyId: user.companyId, leadId },
      orderBy: { createdAt: "desc" },
      select: { id: true, content: true },
    });
    if (!proposal) return { ok: false, error: "Could not open the proposal." };
    const content = (proposal.content ?? {}) as Record<string, unknown>;
    await prisma.proposal.update({
      where: { id: proposal.id },
      data: {
        content: { ...content, projectPriceCents: calc.totalCents } as unknown as Prisma.InputJsonValue,
      },
    });
    revalidatePath(`/portal/leads/${leadId}/presentation`);
    revalidatePath(`/portal/leads/${leadId}`);
    return { ok: true, target: "proposal", totalCents: calc.totalCents };
  }

  if (!lead.project) return { ok: false, error: "This deal has no job yet, so there's no deal value to set." };
  await prisma.project.update({ where: { id: lead.project.id }, data: { contractValue: calc.totalCents } });
  revalidatePath(`/portal/leads/${leadId}`);
  return { ok: true, target: "deal", totalCents: calc.totalCents };
}
