import { prisma } from "@/server/db/client";

// Read models for the Cost/Supplement Template settings pages.

export type TemplateSummary = {
  id: string;
  name: string;
  description: string | null;
  effectiveDate: string;
  isActive: boolean;
  itemCount: number;
};

export type CostTemplateLine = {
  id: string;
  category: string;
  subcategory: string;
  description: string;
  unit: string;
  trade: string;
  costPerUnitCents: number;
};

export type SupplementTemplateLine = {
  id: string;
  category: string;
  subcategory: string;
  description: string;
  unit: string;
  trade: string;
  supplementPerUnitCents: number;
  reason: string | null;
  requiredEvidence: string | null;
  notes: string | null;
};

export type TemplateDetail<L> = {
  id: string;
  name: string;
  description: string | null;
  effectiveDate: string;
  isActive: boolean;
  lines: L[];
};


export async function listCostTemplates(companyId: string): Promise<TemplateSummary[]> {
  const rows = await prisma.scopeCostTemplate.findMany({
    where: { companyId },
    orderBy: [{ isActive: "desc" }, { effectiveDate: "desc" }, { createdAt: "desc" }],
    select: { id: true, name: true, description: true, effectiveDate: true, isActive: true, _count: { select: { items: true } } },
  });
  return rows.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    effectiveDate: t.effectiveDate.toISOString(),
    isActive: t.isActive,
    itemCount: t._count.items,
  }));
}

export async function getCostTemplate(companyId: string, id: string): Promise<TemplateDetail<CostTemplateLine> | null> {
  const tpl = await prisma.scopeCostTemplate.findFirst({
    where: { id, companyId },
    select: {
      id: true, name: true, description: true, effectiveDate: true, isActive: true,
      items: {
        orderBy: [{ catalogItem: { category: "asc" } }, { catalogItem: { subcategory: "asc" } }, { catalogItem: { position: "asc" } }],
        select: {
          id: true, costPerUnitCents: true,
          catalogItem: { select: { category: true, subcategory: true, description: true, unit: true, trade: true } },
        },
      },
    },
  });
  if (!tpl) return null;
  return {
    id: tpl.id,
    name: tpl.name,
    description: tpl.description,
    effectiveDate: tpl.effectiveDate.toISOString(),
    isActive: tpl.isActive,
    lines: tpl.items.map((i) => ({
      id: i.id,
      category: i.catalogItem.category,
      subcategory: i.catalogItem.subcategory,
      description: i.catalogItem.description,
      unit: i.catalogItem.unit,
      trade: i.catalogItem.trade,
      costPerUnitCents: i.costPerUnitCents,
    })),
  };
}

export async function listSupplementTemplates(companyId: string): Promise<TemplateSummary[]> {
  const rows = await prisma.scopeSupplementTemplate.findMany({
    where: { companyId },
    orderBy: [{ isActive: "desc" }, { effectiveDate: "desc" }, { createdAt: "desc" }],
    select: { id: true, name: true, description: true, effectiveDate: true, isActive: true, _count: { select: { items: true } } },
  });
  return rows.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    effectiveDate: t.effectiveDate.toISOString(),
    isActive: t.isActive,
    itemCount: t._count.items,
  }));
}

export async function getSupplementTemplate(companyId: string, id: string): Promise<TemplateDetail<SupplementTemplateLine> | null> {
  const tpl = await prisma.scopeSupplementTemplate.findFirst({
    where: { id, companyId },
    select: {
      id: true, name: true, description: true, effectiveDate: true, isActive: true,
      items: {
        orderBy: [{ catalogItem: { category: "asc" } }, { catalogItem: { subcategory: "asc" } }, { catalogItem: { position: "asc" } }],
        select: {
          id: true, supplementPerUnitCents: true, reason: true, requiredEvidence: true, notes: true,
          catalogItem: { select: { category: true, subcategory: true, description: true, unit: true, trade: true } },
        },
      },
    },
  });
  if (!tpl) return null;
  return {
    id: tpl.id,
    name: tpl.name,
    description: tpl.description,
    effectiveDate: tpl.effectiveDate.toISOString(),
    isActive: tpl.isActive,
    lines: tpl.items.map((i) => ({
      id: i.id,
      category: i.catalogItem.category,
      subcategory: i.catalogItem.subcategory,
      description: i.catalogItem.description,
      unit: i.catalogItem.unit,
      trade: i.catalogItem.trade,
      supplementPerUnitCents: i.supplementPerUnitCents,
      reason: i.reason,
      requiredEvidence: i.requiredEvidence,
      notes: i.notes,
    })),
  };
}
