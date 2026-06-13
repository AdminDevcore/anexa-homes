import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import type { AccessUser } from "@/server/rbac/guards";
import { listScope } from "@/server/rbac/policies";
import { brandingForCompany } from "@/server/branding/resolve";
import {
  type ProposalContent,
  type ProposalUpgrade,
  computeProposalFinancials,
  defaultProposalContent,
} from "@/lib/proposal";

/** Verify the lead is in the user's Lead scope (tenant + row access). */
async function assertLeadAccess(user: AccessUser, leadId: string): Promise<boolean> {
  const scope = listScope(user, "Lead") as Prisma.LeadWhereInput;
  const lead = await prisma.lead.findFirst({ where: { AND: [{ id: leadId }, scope] }, select: { id: true } });
  return !!lead;
}

export type ProposalPhoto = { id: string; url: string; caption: string; category: string };
export type ProposalPhotoGroup = { category: string; photos: ProposalPhoto[] };

export type ProposalScopeLine = {
  description: string;
  quantity: number;
  unit: string | null;
  insuranceUnitPriceCents: number;
  rcvCents: number;
};

export type ProposalFinancialsView = {
  rcvCents: number;
  acvCents: number;
  deductibleCents: number;
  depreciationCents: number;
  approvedSupplementsCents: number;
  customerUpgradesCents: number;
  totalProjectValueCents: number;
  estimatedOutOfPocketCents: number;
};

/** Customer-safe presentation payload — NEVER includes cost/profit/commission. */
export type ProposalView = {
  id: string;
  status: string;
  theme: string;
  token: string;
  customerName: string;
  propertyAddress: string;
  projectType: string;
  repName: string | null;
  createdAt: string;
  branding: { companyName: string; logoUrl: string | null; primaryColor: string; accentColor: string };
  claim: {
    status: string | null;
    carrier: string | null;
    claimNumber: string | null;
    lossDate: string | null;
    roofType: string | null;
  };
  content: ProposalContent;
  heroPhotoUrl: string | null;
  photoGroups: ProposalPhotoGroup[];
  scopeLines: ProposalScopeLine[];
  financials: ProposalFinancialsView;
  signUrl: string | null;
};

// Builder payload: the customer-safe ProposalView PLUS the editable checklist of
// site/inspection slots so the builder can gate on required photos.
export type ProposalBuilderData = {
  proposal: ProposalView;
  checklist: {
    templateId: string;
    items: { id: string; label: string; required: boolean; position: number; count: number }[];
  } | null;
  canManage: boolean;
};

function asContent(json: unknown): ProposalContent {
  if (json && typeof json === "object") return json as ProposalContent;
  return defaultProposalContent();
}

function frontHeroPhoto(groups: ProposalPhotoGroup[]): string | null {
  const front = groups.find((g) => /front/i.test(g.category));
  return front?.photos[0]?.url ?? groups[0]?.photos[0]?.url ?? null;
}

// Shared loader: pulls lead/claim/scope/photos for a proposal and assembles the
// customer-safe view. `photoUrl` differs by context (authed portal vs public token).
async function assembleView(
  proposal: { id: string; status: string; theme: string; publicToken: string; customerName: string; propertyAddress: string; content: unknown; createdAt: Date; companyId: string; leadId: string },
  photoUrl: (fileId: string) => string,
): Promise<ProposalView> {
  const content = asContent(proposal.content);

  const [lead, claim, scope, photos, branding] = await Promise.all([
    prisma.lead.findUnique({
      where: { id: proposal.leadId },
      select: {
        assignedRep: { select: { firstName: true, lastName: true } },
        project: { select: { supplementCents: true } },
      },
    }),
    prisma.claim.findFirst({
      where: { companyId: proposal.companyId, leadId: proposal.leadId },
      orderBy: { createdAt: "desc" },
      select: { status: true, carrier: true, claimNumber: true, lossDate: true, rcv: true, acv: true, deductible: true, depreciation: true },
    }),
    prisma.scopeOfWork.findUnique({
      where: { leadId: proposal.leadId },
      select: { lines: { orderBy: [{ position: "asc" }], select: { description: true, quantity: true, unit: true, insuranceUnitPrice: true } } },
    }),
    prisma.fileAsset.findMany({
      where: { companyId: proposal.companyId, leadId: proposal.leadId, kind: "photo", photoTemplateItemId: { not: null } },
      orderBy: { createdAt: "asc" },
      select: { id: true, category: true },
    }),
    brandingForCompany(proposal.companyId),
  ]);

  const captions = content.photoCaptions ?? {};
  const included = content.includedPhotoIds;
  const byCategory = new Map<string, ProposalPhoto[]>();
  for (const p of photos) {
    if (included && included.length > 0 && !included.includes(p.id)) continue;
    const category = p.category?.trim() || "Other";
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category)!.push({ id: p.id, url: photoUrl(p.id), caption: captions[p.id] ?? "", category });
  }
  const photoGroups: ProposalPhotoGroup[] = Array.from(byCategory.entries()).map(([category, photos]) => ({ category, photos }));

  const scopeLines: ProposalScopeLine[] = (scope?.lines ?? []).map((l) => ({
    description: l.description,
    quantity: l.quantity,
    unit: l.unit,
    insuranceUnitPriceCents: l.insuranceUnitPrice,
    rcvCents: Math.round(l.quantity * l.insuranceUnitPrice),
  }));

  const rcvCents = claim?.rcv ?? 0;
  const approvedSupplementsCents = lead?.project?.supplementCents ?? 0;
  const upgrades: ProposalUpgrade[] = content.upgrades ?? [];
  const fin = computeProposalFinancials({
    rcvCents,
    acvCents: claim?.acv ?? 0,
    deductibleCents: claim?.deductible ?? 0,
    depreciationCents: claim?.depreciation ?? 0,
    approvedSupplementsCents,
    upgrades,
  });

  const repName = lead?.assignedRep ? `${lead.assignedRep.firstName} ${lead.assignedRep.lastName}`.trim() : null;

  return {
    id: proposal.id,
    status: proposal.status,
    theme: proposal.theme,
    token: proposal.publicToken,
    customerName: proposal.customerName,
    propertyAddress: proposal.propertyAddress,
    projectType: "Roofing / Insurance Restoration",
    repName,
    createdAt: proposal.createdAt.toISOString(),
    branding: { companyName: branding.companyName, logoUrl: branding.logoUrl ?? null, primaryColor: branding.primaryColor, accentColor: branding.accentColor },
    claim: {
      status: claim?.status ?? null,
      carrier: claim?.carrier ?? null,
      claimNumber: claim?.claimNumber ?? null,
      lossDate: claim?.lossDate ? claim.lossDate.toISOString() : (content.dateOfLoss ?? null),
      roofType: content.roofType ?? null,
    },
    content,
    heroPhotoUrl: frontHeroPhoto(photoGroups),
    photoGroups,
    scopeLines,
    financials: {
      rcvCents,
      acvCents: claim?.acv ?? 0,
      deductibleCents: claim?.deductible ?? 0,
      depreciationCents: claim?.depreciation ?? 0,
      approvedSupplementsCents,
      customerUpgradesCents: fin.customerUpgradesCents,
      totalProjectValueCents: fin.totalProjectValueCents,
      estimatedOutOfPocketCents: fin.estimatedOutOfPocketCents,
    },
    signUrl: null, // wired in Phase 4 (deep-link to esign) — null = rep will send docs
  };
}

/** Builder payload for the authed deal owner. Photos served via the portal route. */
export async function getProposalForBuilder(user: AccessUser, leadId: string): Promise<ProposalBuilderData | null> {
  if (!(await assertLeadAccess(user, leadId))) return null;

  const proposal = await prisma.proposal.findFirst({
    where: { companyId: user.companyId, leadId },
    orderBy: { createdAt: "desc" },
  });
  if (!proposal) return null;

  const view = await assembleView(proposal, (fileId) => `/portal/files/${fileId}`);

  // Site/inspection checklist (kind "site") + lead-scoped photo counts per slot.
  const template = await prisma.photoTemplate.findFirst({
    where: { companyId: user.companyId, kind: "site" },
    include: { items: { orderBy: { position: "asc" } } },
  });
  let checklist: ProposalBuilderData["checklist"] = null;
  if (template) {
    const counts = await prisma.fileAsset.groupBy({
      by: ["photoTemplateItemId"],
      where: { companyId: user.companyId, leadId, kind: "photo", photoTemplateItemId: { not: null } },
      _count: { _all: true },
    });
    const countMap = new Map<string, number>();
    for (const c of counts) if (c.photoTemplateItemId) countMap.set(c.photoTemplateItemId, c._count._all);
    checklist = {
      templateId: template.id,
      items: template.items.map((it) => ({ id: it.id, label: it.label, required: it.required, position: it.position, count: countMap.get(it.id) ?? 0 })),
    };
  }

  const { canManageProposals } = await import("./policies");
  return { proposal: view, checklist, canManage: canManageProposals(user.role) };
}

/** Public payload by token (no auth). Photos served via the token photo route. */
export async function getPublicProposal(token: string): Promise<ProposalView | null> {
  const proposal = await prisma.proposal.findUnique({ where: { publicToken: token } });
  if (!proposal) return null;
  return assembleView(proposal, (fileId) => `/present/${token}/photo/${fileId}`);
}
