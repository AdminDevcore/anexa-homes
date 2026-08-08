import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import type { AccessUser } from "@/server/rbac/guards";
import { listScope } from "@/server/rbac/policies";
import { canSeeScopeCosts } from "@/server/modules/scope/policies";

/** Verify the lead is in the user's Lead scope (tenant + row access). */
async function assertLeadAccess(user: AccessUser, leadId: string): Promise<boolean> {
  const scope = listScope(user, "Lead") as Prisma.LeadWhereInput;
  const lead = await prisma.lead.findFirst({
    where: { AND: [{ id: leadId }, scope] },
    select: { id: true },
  });
  return !!lead;
}

export type EstimateLineDTO = {
  id: string;
  position: number;
  catalogItemId: string | null;
  category: string;
  description: string;
  quantity: number;
  unit: string | null;
  /** cents per unit — what we charge. */
  unitPriceCents: number;
};

export type EstimateCatalogOption = {
  id: string;
  category: string;
  description: string;
  unit: string;
};

export type EstimateDTO = {
  id: string;
  leadId: string;
  discountCents: number;
  notes: string | null;
  costTemplateId: string | null;
  costTemplates: { id: string; name: string }[];
  /** catalogItemId → cents. Empty for roles that may not see cost. */
  costPrices: Record<string, number>;
  lines: EstimateLineDTO[];
  /** The catalog to add lines from, in this deal's workspace. */
  catalog: EstimateCatalogOption[];
  canSeeCosts: boolean;
};

/**
 * The estimate for a lead, serialized for the requesting user. Returns null when
 * the lead isn't accessible, and null when no estimate has been started — the
 * panel renders its own empty state rather than the server creating a row for
 * every deal anyone glances at.
 *
 * Cost is STRIPPED from the payload for non-management roles, not merely hidden
 * in the UI: a sales rep quotes the customer without ever receiving our margin.
 */
export async function getEstimateForLead(user: AccessUser, leadId: string): Promise<EstimateDTO | null> {
  if (!(await assertLeadAccess(user, leadId))) return null;

  const estimate = await prisma.estimate.findUnique({
    where: { leadId },
    include: { lines: { orderBy: [{ position: "asc" }, { createdAt: "asc" }] } },
  });
  if (!estimate) return null;

  const showCosts = canSeeScopeCosts(user.role);

  const [costTemplates, catalog] = await Promise.all([
    showCosts
      ? prisma.scopeCostTemplate.findMany({
          where: { companyId: user.companyId, isActive: true },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    prisma.scopeCatalogItem.findMany({
      where: { companyId: user.companyId, isActive: true },
      orderBy: [{ category: "asc" }, { subcategory: "asc" }, { position: "asc" }],
      select: { id: true, category: true, description: true, unit: true },
    }),
  ]);

  const costPrices: Record<string, number> = {};
  if (showCosts && estimate.costTemplateId) {
    const items = await prisma.scopeCostTemplateItem.findMany({
      where: { templateId: estimate.costTemplateId },
      select: { catalogItemId: true, costPerUnitCents: true },
    });
    for (const it of items) costPrices[it.catalogItemId] = it.costPerUnitCents;
  }

  return {
    id: estimate.id,
    leadId: estimate.leadId,
    discountCents: estimate.discountCents,
    notes: estimate.notes,
    costTemplateId: estimate.costTemplateId,
    costTemplates,
    costPrices,
    catalog,
    canSeeCosts: showCosts,
    lines: estimate.lines.map((l) => ({
      id: l.id,
      position: l.position,
      catalogItemId: l.catalogItemId,
      category: l.category,
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      unitPriceCents: l.unitPriceCents,
    })),
  };
}

/**
 * The catalog and cost templates for a lead that has no estimate row yet, so the
 * panel's empty state can offer "Add from catalog" without a round trip.
 */
export async function getEstimateStarterData(
  user: AccessUser,
  leadId: string
): Promise<{ catalog: EstimateCatalogOption[] } | null> {
  if (!(await assertLeadAccess(user, leadId))) return null;
  const catalog = await prisma.scopeCatalogItem.findMany({
    where: { companyId: user.companyId, isActive: true },
    orderBy: [{ category: "asc" }, { subcategory: "asc" }, { position: "asc" }],
    select: { id: true, category: true, description: true, unit: true },
  });
  return { catalog };
}
