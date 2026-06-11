import { prisma } from "@/server/db/client";
import { computeDealCommission, type DealCommission } from "@/lib/commission";

export type DealCost = {
  id: string;
  type: string;
  label: string;
  vendor: string | null;
  amount: number;
  fileAssetId: string | null;
};

export type DealFinancials = {
  contractValue: number; // base scope (cents)
  supplementCents: number; // approved supplement
  deductibleCents: number; // customer-paid deductible
  depreciationCents: number; // recoverable depreciation
  repGetsSupplement: boolean; // per-deal: supplement in the rep/manager split pool?
  repGetsDepreciation: boolean; // per-deal: depreciation in the split pool?
  overheadPct: number;
  costs: DealCost[];
  costTotal: number;
  // Bookkeeping transactions tagged to this deal (money in/out tied to the job).
  linkedTransactions: { id: string; date: string; description: string; vendor: string | null; category: string | null; amountCents: number }[];
  linkedTotal: number;
  companyProvidedLead: boolean;
  // splitPct = the ACTIVE split (provided-lead vs self-gen) used in the breakdown.
  rep: {
    id: string;
    name: string;
    splitPct: number | null;
    selfGenSplitPct: number | null;
    providedLeadSplitPct: number | null;
    deductiblePct: number | null;
  } | null;
  breakdown: DealCommission;
  commission: { id: string; amount: number; status: string } | null;
};

export type ProjectPayoutLine = { id: string; label: string | null; amount: number; status: string; recipient: string };
export type ProjectPayout = { lines: ProjectPayoutLine[]; total: number; paid: number; outstanding: number };

/** Every commission on a job (the payout breakdown): rep, crew, manager override, etc. */
export async function getProjectPayout(companyId: string, projectId: string): Promise<ProjectPayout> {
  const rows = await prisma.commission.findMany({
    where: { companyId, projectId, status: { not: "void" } },
    orderBy: { createdAt: "asc" },
    select: { id: true, label: true, amount: true, status: true, user: { select: { firstName: true, lastName: true } } },
  });
  const lines: ProjectPayoutLine[] = rows.map((r) => ({
    id: r.id,
    label: r.label,
    amount: r.amount,
    status: r.status,
    recipient: `${r.user.firstName} ${r.user.lastName}`.trim(),
  }));
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const paid = lines.filter((l) => l.status === "paid").reduce((s, l) => s + l.amount, 0);
  return { lines, total, paid, outstanding: total - paid };
}

/** Full deal financials for a project: cost lines, overhead, rep split, and the live breakdown. */
export async function getDealFinancials(companyId: string, projectId: string): Promise<DealFinancials | null> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, companyId },
    select: {
      contractValue: true,
      supplementCents: true,
      deductibleCents: true,
      depreciationCents: true,
      repGetsSupplement: true,
      repGetsDepreciation: true,
      companyProvidedLead: true,
      company: { select: { overheadPct: true } },
      lead: { select: { assignedRep: { select: { id: true, firstName: true, lastName: true, commissionSplitPct: true, providedLeadSplitPct: true, deductiblePct: true } } } },
      costs: {
        orderBy: { createdAt: "asc" },
        select: { id: true, type: true, label: true, vendor: true, amount: true, fileAssetId: true },
      },
    },
  });
  if (!project) return null;

  const rep = project.lead?.assignedRep ?? null;
  const overheadPct = project.company.overheadPct;
  const costTotal = project.costs.reduce((s, c) => s + c.amount, 0);
  // Company-provided leads use the (usually lower) provided-lead split; otherwise
  // the rep's standard self-gen split. Falls back to self-gen if provided is unset.
  const selfGen = rep?.commissionSplitPct ?? null;
  const providedSplit = rep?.providedLeadSplitPct ?? null;
  const activeSplit = project.companyProvidedLead ? (providedSplit ?? selfGen) : selfGen;
  const breakdown = computeDealCommission({
    baseCents: project.contractValue,
    supplementCents: project.supplementCents,
    deductibleCents: project.deductibleCents,
    depreciationCents: project.depreciationCents,
    repGetsSupplement: project.repGetsSupplement,
    repGetsDepreciation: project.repGetsDepreciation,
    costCents: costTotal,
    overheadPct,
    repSplitPct: activeSplit ?? 0,
    repDeductiblePct: rep?.deductiblePct ?? 0,
  });

  const commission = rep
    ? await prisma.commission.findFirst({
        where: { companyId, projectId, userId: rep.id },
        orderBy: { createdAt: "desc" },
        select: { id: true, amount: true, status: true },
      })
    : null;

  // Bookkeeping transactions tagged to this deal (via the Bookkeeping "Deal" column).
  const txns = await prisma.transaction.findMany({
    where: { companyId, projectId },
    orderBy: { date: "desc" },
    select: { id: true, date: true, description: true, vendor: true, amountCents: true, category: { select: { name: true } } },
  });
  const linkedTransactions = txns.map((t) => ({
    id: t.id, date: t.date.toISOString(), description: t.description, vendor: t.vendor, category: t.category?.name ?? null, amountCents: t.amountCents,
  }));
  const linkedTotal = txns.reduce((s, t) => s + t.amountCents, 0);

  return {
    contractValue: project.contractValue,
    supplementCents: project.supplementCents,
    deductibleCents: project.deductibleCents,
    depreciationCents: project.depreciationCents,
    repGetsSupplement: project.repGetsSupplement,
    repGetsDepreciation: project.repGetsDepreciation,
    overheadPct,
    costs: project.costs,
    costTotal,
    linkedTransactions,
    linkedTotal,
    companyProvidedLead: project.companyProvidedLead,
    rep: rep
      ? { id: rep.id, name: `${rep.firstName} ${rep.lastName}`.trim(), splitPct: activeSplit, selfGenSplitPct: selfGen, providedLeadSplitPct: providedSplit, deductiblePct: rep.deductiblePct ?? null }
      : null,
    breakdown,
    commission,
  };
}
