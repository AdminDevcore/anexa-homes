import type { Prisma, Industry } from "@prisma/client";
import { prisma } from "@/server/db/client";
import type { AccessUser } from "@/server/rbac/guards";
import { listScope } from "@/server/rbac/policies";
import { canSeeScopeCosts } from "./policies";

/** Verify the lead is in the user's Lead scope (tenant + row access). */
async function assertLeadAccess(user: AccessUser, leadId: string): Promise<boolean> {
  const scope = listScope(user, "Lead") as Prisma.LeadWhereInput;
  const lead = await prisma.lead.findFirst({
    where: { AND: [{ id: leadId }, scope] },
    select: { id: true },
  });
  return !!lead;
}

export type ScopeLineDTO = {
  id: string;
  position: number;
  // Catalog link — when set, cost/supplement come from the selected templates.
  catalogItemId: string | null;
  category: string;
  description: string;
  quantity: number;
  unit: string | null;
  insuranceUnitPrice: number;
  // Legacy inline supplemented price (insurance-side); superseded by templates.
  supplementUnitPrice: number;
  // Present only for cost-capable roles.
  costUnitPrice?: number;
};

export type ScopeTemplateOption = { id: string; name: string };

export type ScopeDTO = {
  id: string;
  leadId: string;
  pdfFileId: string | null;
  notes: string | null;
  // Public-adjuster fee, % of the supplement recovered.
  paFeePct: number;
  // Estimated insurance deductible (cents). Informational: homeowner's share of
  // the RCV; does not change the profit pool.
  estDeductibleCents: number;
  // Company overhead, % of revenue removed before the profit pool.
  overheadPct: number;
  // Selected pricing templates + the options to choose from.
  costTemplateId: string | null;
  supplementTemplateId: string | null;
  costTemplates: ScopeTemplateOption[];
  supplementTemplates: ScopeTemplateOption[];
  // catalogItemId → cents for the selected templates. costPrices gated to cost roles.
  costPrices: Record<string, number>;
  supplementPrices: Record<string, number>;
  lines: ScopeLineDTO[];
  canSeeCosts: boolean;
};

/**
 * The scope of work for a lead, serialized for the requesting user. Returns null
 * when the lead isn't accessible. Cost fields are STRIPPED from the payload for
 * non-management roles (not merely hidden in the UI).
 */
export async function getScopeForLead(
  user: AccessUser,
  leadId: string
): Promise<ScopeDTO | null> {
  if (!(await assertLeadAccess(user, leadId))) return null;

  const scope = await prisma.scopeOfWork.findUnique({
    where: { leadId },
    include: {
      lines: { orderBy: [{ position: "asc" }, { createdAt: "asc" }] },
      company: { select: { overheadPct: true } },
    },
  });
  if (!scope) return null;

  const showCosts = canSeeScopeCosts(user.role);

  // Active templates for the dropdowns.
  const [costTemplates, supplementTemplates] = await Promise.all([
    prisma.scopeCostTemplate.findMany({ where: { companyId: user.companyId, isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.scopeSupplementTemplate.findMany({ where: { companyId: user.companyId, isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  // Price maps (catalogItemId → cents) for the selected templates.
  const costPrices: Record<string, number> = {};
  if (showCosts && scope.costTemplateId) {
    const items = await prisma.scopeCostTemplateItem.findMany({ where: { templateId: scope.costTemplateId }, select: { catalogItemId: true, costPerUnitCents: true } });
    for (const it of items) costPrices[it.catalogItemId] = it.costPerUnitCents;
  }
  const supplementPrices: Record<string, number> = {};
  if (scope.supplementTemplateId) {
    const items = await prisma.scopeSupplementTemplateItem.findMany({ where: { templateId: scope.supplementTemplateId }, select: { catalogItemId: true, supplementPerUnitCents: true } });
    for (const it of items) supplementPrices[it.catalogItemId] = it.supplementPerUnitCents;
  }

  return {
    id: scope.id,
    leadId: scope.leadId,
    pdfFileId: scope.pdfFileId,
    notes: scope.notes,
    paFeePct: scope.paFeePct,
    estDeductibleCents: scope.estDeductibleCents,
    overheadPct: scope.company.overheadPct,
    costTemplateId: scope.costTemplateId,
    supplementTemplateId: scope.supplementTemplateId,
    costTemplates,
    supplementTemplates,
    costPrices,
    supplementPrices,
    canSeeCosts: showCosts,
    lines: scope.lines.map((l) => ({
      id: l.id,
      position: l.position,
      catalogItemId: l.catalogItemId,
      category: l.category,
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      insuranceUnitPrice: l.insuranceUnitPrice,
      supplementUnitPrice: l.supplementUnitPrice,
      ...(showCosts ? { costUnitPrice: l.costUnitPrice } : {}),
    })),
  };
}

/** The scope PDF FileAsset, only if the user can access the owning lead. */
export async function scopePdfForUser(user: AccessUser, scopeId: string) {
  const scope = await prisma.scopeOfWork.findFirst({
    where: { id: scopeId, companyId: user.companyId },
    select: { leadId: true, pdfFileId: true },
  });
  if (!scope?.pdfFileId) return null;
  if (!(await assertLeadAccess(user, scope.leadId))) return null;
  return prisma.fileAsset.findFirst({
    where: { id: scope.pdfFileId, companyId: user.companyId },
    select: { id: true, name: true, storageKey: true, mimeType: true },
  });
}

/**
 * Estimated internal cost for a lead's scope (from the selected cost template,
 * matched by catalog item; legacy free-text lines use their inline cost). Returns
 * null when there's no scope or no cost is set — callers fall back to actual cost.
 */
export async function getScopeEstimatedCostCents(companyId: string, leadId: string): Promise<number | null> {
  const scope = await prisma.scopeOfWork.findUnique({
    where: { leadId },
    select: {
      companyId: true,
      costTemplateId: true,
      lines: { select: { quantity: true, catalogItemId: true, costUnitPrice: true } },
    },
  });
  if (!scope || scope.companyId !== companyId) return null;

  const costMap = new Map<string, number>();
  if (scope.costTemplateId) {
    const items = await prisma.scopeCostTemplateItem.findMany({
      where: { templateId: scope.costTemplateId },
      select: { catalogItemId: true, costPerUnitCents: true },
    });
    for (const it of items) costMap.set(it.catalogItemId, it.costPerUnitCents);
  }

  let total = 0;
  for (const l of scope.lines) {
    const per = l.catalogItemId ? costMap.get(l.catalogItemId) ?? 0 : l.costUnitPrice ?? 0;
    total += Math.round(l.quantity * per);
  }
  return total > 0 ? total : null;
}

/** Company scope template line items for an industry. */
export async function listScopeTemplate(companyId: string, industry: Industry) {
  return prisma.scopeTemplateItem.findMany({
    where: { companyId, industry },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
}

/** The whole master scope catalog for a company, ordered for grouped display. */
export async function getScopeCatalog(companyId: string) {
  return prisma.scopeCatalogItem.findMany({
    where: { companyId },
    orderBy: [{ category: "asc" }, { subcategory: "asc" }, { position: "asc" }],
  });
}
