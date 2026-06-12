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
  category: string;
  description: string;
  quantity: number;
  unit: string | null;
  insuranceUnitPrice: number;
  // Supplemented carrier price per unit (insurance-side, visible to all scope roles).
  supplementUnitPrice: number;
  // Present only for cost-capable roles.
  costUnitPrice?: number;
};

export type ScopeDTO = {
  id: string;
  leadId: string;
  pdfFileId: string | null;
  notes: string | null;
  // Public-adjuster fee, % of the supplement recovered.
  paFeePct: number;
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
    include: { lines: { orderBy: [{ position: "asc" }, { createdAt: "asc" }] } },
  });
  if (!scope) return null;

  const showCosts = canSeeScopeCosts(user.role);
  return {
    id: scope.id,
    leadId: scope.leadId,
    pdfFileId: scope.pdfFileId,
    notes: scope.notes,
    paFeePct: scope.paFeePct,
    canSeeCosts: showCosts,
    lines: scope.lines.map((l) => ({
      id: l.id,
      position: l.position,
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

/** Company scope template line items for an industry. */
export async function listScopeTemplate(companyId: string, industry: Industry) {
  return prisma.scopeTemplateItem.findMany({
    where: { companyId, industry },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
}
