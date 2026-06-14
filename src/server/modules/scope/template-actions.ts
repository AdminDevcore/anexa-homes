"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";

// Cost & Supplement Templates: versioned price lists over the master scope
// catalog. Editing a template price never mutates the catalog. All actions are
// tenant-scoped and gated by the Settings permission.

type Result = { ok: true } | { ok: false; error: string };
type CreateResult = { ok: true; id: string } | { ok: false; error: string };

async function gate(): Promise<{ companyId: string } | { error: string }> {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return { error: "Not allowed." };
  return { companyId: user.companyId };
}

function parseDate(v?: string): Date {
  if (!v) return new Date();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

const COST_PATH = "/portal/settings/scope-cost-templates";
const SUPP_PATH = "/portal/settings/scope-supplement-templates";

/** Active catalog item ids for the company (the snapshot source for a new template). */
async function activeCatalogItemIds(companyId: string): Promise<string[]> {
  const items = await prisma.scopeCatalogItem.findMany({
    where: { companyId, isActive: true },
    orderBy: [{ category: "asc" }, { subcategory: "asc" }, { position: "asc" }],
    select: { id: true },
  });
  return items.map((i) => i.id);
}

// ── Cost templates ──────────────────────────────────────────────────────────

export async function createCostTemplateAction(input: {
  name: string;
  description?: string;
  effectiveDate?: string;
  isActive?: boolean;
}): Promise<CreateResult> {
  const g = await gate();
  if ("error" in g) return { ok: false, error: g.error };
  const name = input.name?.trim();
  if (!name) return { ok: false, error: "Template name is required." };

  const catalogIds = await activeCatalogItemIds(g.companyId);
  const tpl = await prisma.scopeCostTemplate.create({
    data: {
      companyId: g.companyId,
      name,
      description: input.description?.trim() || null,
      effectiveDate: parseDate(input.effectiveDate),
      isActive: input.isActive ?? true,
      items: {
        create: catalogIds.map((catalogItemId) => ({
          companyId: g.companyId,
          catalogItemId,
          costPerUnitCents: 0,
        })),
      },
    },
    select: { id: true },
  });
  revalidatePath(COST_PATH);
  return { ok: true, id: tpl.id };
}

export async function updateCostTemplateAction(input: {
  id: string;
  name?: string;
  description?: string;
  effectiveDate?: string;
  isActive?: boolean;
}): Promise<Result> {
  const g = await gate();
  if ("error" in g) return { ok: false, error: g.error };
  const existing = await prisma.scopeCostTemplate.findFirst({ where: { id: input.id, companyId: g.companyId }, select: { id: true } });
  if (!existing) return { ok: false, error: "Template not found." };

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const n = input.name.trim();
    if (!n) return { ok: false, error: "Template name can't be empty." };
    data.name = n;
  }
  if (input.description !== undefined) data.description = input.description.trim() || null;
  if (input.effectiveDate !== undefined) data.effectiveDate = parseDate(input.effectiveDate);
  if (input.isActive !== undefined) data.isActive = input.isActive;

  await prisma.scopeCostTemplate.update({ where: { id: input.id }, data });
  revalidatePath(COST_PATH);
  revalidatePath(`${COST_PATH}/${input.id}`);
  return { ok: true };
}

export async function deleteCostTemplateAction(id: string): Promise<Result> {
  const g = await gate();
  if ("error" in g) return { ok: false, error: g.error };
  const existing = await prisma.scopeCostTemplate.findFirst({ where: { id, companyId: g.companyId }, select: { id: true } });
  if (!existing) return { ok: false, error: "Template not found." };
  await prisma.scopeCostTemplate.delete({ where: { id } });
  revalidatePath(COST_PATH);
  return { ok: true };
}

export async function updateCostTemplateItemAction(input: { id: string; costPerUnitCents: number }): Promise<Result> {
  const g = await gate();
  if ("error" in g) return { ok: false, error: g.error };
  const item = await prisma.scopeCostTemplateItem.findFirst({ where: { id: input.id, companyId: g.companyId }, select: { templateId: true } });
  if (!item) return { ok: false, error: "Line not found." };
  await prisma.scopeCostTemplateItem.update({
    where: { id: input.id },
    data: { costPerUnitCents: Math.max(0, Math.round(input.costPerUnitCents)) },
  });
  revalidatePath(`${COST_PATH}/${item.templateId}`);
  return { ok: true };
}

/** Add catalog items that were created after this template (or otherwise missing). */
export async function addMissingCostTemplateItemsAction(templateId: string): Promise<Result> {
  const g = await gate();
  if ("error" in g) return { ok: false, error: g.error };
  const tpl = await prisma.scopeCostTemplate.findFirst({ where: { id: templateId, companyId: g.companyId }, select: { id: true } });
  if (!tpl) return { ok: false, error: "Template not found." };
  const have = new Set(
    (await prisma.scopeCostTemplateItem.findMany({ where: { templateId }, select: { catalogItemId: true } })).map((i) => i.catalogItemId)
  );
  const catalogIds = await activeCatalogItemIds(g.companyId);
  const missing = catalogIds.filter((id) => !have.has(id));
  if (missing.length === 0) return { ok: false, error: "Template already has every active catalog item." };
  await prisma.scopeCostTemplateItem.createMany({
    data: missing.map((catalogItemId) => ({ companyId: g.companyId, templateId, catalogItemId, costPerUnitCents: 0 })),
  });
  revalidatePath(`${COST_PATH}/${templateId}`);
  return { ok: true };
}

// ── Supplement templates ─────────────────────────────────────────────────────

export async function createSupplementTemplateAction(input: {
  name: string;
  description?: string;
  effectiveDate?: string;
  isActive?: boolean;
}): Promise<CreateResult> {
  const g = await gate();
  if ("error" in g) return { ok: false, error: g.error };
  const name = input.name?.trim();
  if (!name) return { ok: false, error: "Template name is required." };

  const catalogIds = await activeCatalogItemIds(g.companyId);
  const tpl = await prisma.scopeSupplementTemplate.create({
    data: {
      companyId: g.companyId,
      name,
      description: input.description?.trim() || null,
      effectiveDate: parseDate(input.effectiveDate),
      isActive: input.isActive ?? true,
      items: {
        create: catalogIds.map((catalogItemId) => ({
          companyId: g.companyId,
          catalogItemId,
          supplementPerUnitCents: 0,
        })),
      },
    },
    select: { id: true },
  });
  revalidatePath(SUPP_PATH);
  return { ok: true, id: tpl.id };
}

export async function updateSupplementTemplateAction(input: {
  id: string;
  name?: string;
  description?: string;
  effectiveDate?: string;
  isActive?: boolean;
}): Promise<Result> {
  const g = await gate();
  if ("error" in g) return { ok: false, error: g.error };
  const existing = await prisma.scopeSupplementTemplate.findFirst({ where: { id: input.id, companyId: g.companyId }, select: { id: true } });
  if (!existing) return { ok: false, error: "Template not found." };

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const n = input.name.trim();
    if (!n) return { ok: false, error: "Template name can't be empty." };
    data.name = n;
  }
  if (input.description !== undefined) data.description = input.description.trim() || null;
  if (input.effectiveDate !== undefined) data.effectiveDate = parseDate(input.effectiveDate);
  if (input.isActive !== undefined) data.isActive = input.isActive;

  await prisma.scopeSupplementTemplate.update({ where: { id: input.id }, data });
  revalidatePath(SUPP_PATH);
  revalidatePath(`${SUPP_PATH}/${input.id}`);
  return { ok: true };
}

export async function deleteSupplementTemplateAction(id: string): Promise<Result> {
  const g = await gate();
  if ("error" in g) return { ok: false, error: g.error };
  const existing = await prisma.scopeSupplementTemplate.findFirst({ where: { id, companyId: g.companyId }, select: { id: true } });
  if (!existing) return { ok: false, error: "Template not found." };
  await prisma.scopeSupplementTemplate.delete({ where: { id } });
  revalidatePath(SUPP_PATH);
  return { ok: true };
}

export async function updateSupplementTemplateItemAction(input: {
  id: string;
  supplementPerUnitCents?: number;
  reason?: string;
  requiredEvidence?: string;
  notes?: string;
}): Promise<Result> {
  const g = await gate();
  if ("error" in g) return { ok: false, error: g.error };
  const item = await prisma.scopeSupplementTemplateItem.findFirst({ where: { id: input.id, companyId: g.companyId }, select: { templateId: true } });
  if (!item) return { ok: false, error: "Line not found." };

  const data: Record<string, unknown> = {};
  if (input.supplementPerUnitCents !== undefined) data.supplementPerUnitCents = Math.max(0, Math.round(input.supplementPerUnitCents));
  if (input.reason !== undefined) data.reason = input.reason.trim() || null;
  if (input.requiredEvidence !== undefined) data.requiredEvidence = input.requiredEvidence.trim() || null;
  if (input.notes !== undefined) data.notes = input.notes.trim() || null;

  await prisma.scopeSupplementTemplateItem.update({ where: { id: input.id }, data });
  revalidatePath(`${SUPP_PATH}/${item.templateId}`);
  return { ok: true };
}

export async function addMissingSupplementTemplateItemsAction(templateId: string): Promise<Result> {
  const g = await gate();
  if ("error" in g) return { ok: false, error: g.error };
  const tpl = await prisma.scopeSupplementTemplate.findFirst({ where: { id: templateId, companyId: g.companyId }, select: { id: true } });
  if (!tpl) return { ok: false, error: "Template not found." };
  const have = new Set(
    (await prisma.scopeSupplementTemplateItem.findMany({ where: { templateId }, select: { catalogItemId: true } })).map((i) => i.catalogItemId)
  );
  const catalogIds = await activeCatalogItemIds(g.companyId);
  const missing = catalogIds.filter((id) => !have.has(id));
  if (missing.length === 0) return { ok: false, error: "Template already has every active catalog item." };
  await prisma.scopeSupplementTemplateItem.createMany({
    data: missing.map((catalogItemId) => ({ companyId: g.companyId, templateId, catalogItemId, supplementPerUnitCents: 0 })),
  });
  revalidatePath(`${SUPP_PATH}/${templateId}`);
  return { ok: true };
}
