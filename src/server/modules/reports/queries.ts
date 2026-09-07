import type { Prisma, Role } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { wonLeadFilter } from "@/server/modules/pipeline/sale-line";
import { managerTeamUserFilter } from "@/server/rbac/policies";
import { computeDealCommission } from "@/lib/commission";

// ── Commission liability (generated + estimated) ─────────────────────────────
//
// "Commissions owed" is only meaningful if it includes commission that hasn't
// been *generated* yet. A Commission row only exists once someone runs the
// generate action on a deal (gated to a late pipeline stage), so summing
// Commission rows alone wildly understates the real liability. This helper
// returns BOTH parts and never double-counts a deal:
//   - lockedInCents: generated, unpaid commissions (status pending/approved)
//   - estimatedCents: estimated rep split on ACTIVE deals that have NO
//     generated commission yet, via the canonical computeDealCommission
//
// A deal contributes to exactly one of the two: if any commission row exists
// for it (paid or not), the estimate skips it.

export type CommissionLiability = {
  lockedInCents: number;
  estimatedCents: number;
  byRep: { name: string; lockedInCents: number; estimatedCents: number }[];
};

export async function getCommissionLiability(
  companyId: string,
  scope: { leadWhere: Prisma.LeadWhereInput; userIds: string[] | null },
): Promise<CommissionLiability> {
  // Per-recipient accumulator, keyed by userId.
  const rows = new Map<string, { name: string; lockedInCents: number; estimatedCents: number }>();
  const bump = (id: string, name: string, field: "lockedInCents" | "estimatedCents", cents: number) => {
    const r = rows.get(id) ?? { name, lockedInCents: 0, estimatedCents: 0 };
    r[field] += cents;
    rows.set(id, r);
  };

  // 1) Generated commissions on this scope. Non-void rows mark a deal as
  //    "already generated" (excluded from the estimate); pending/approved ones
  //    are the locked-in owed amount.
  const commissions = await prisma.commission.findMany({
    where: {
      companyId,
      status: { not: "void" },
      ...(scope.userIds ? { userId: { in: scope.userIds } } : {}),
    },
    select: { projectId: true, userId: true, amount: true, status: true, user: { select: { firstName: true, lastName: true } } },
  });
  const generatedProjectIds = new Set<string>();
  let lockedInCents = 0;
  for (const c of commissions) {
    generatedProjectIds.add(c.projectId);
    if (c.status === "pending" || c.status === "approved") {
      lockedInCents += c.amount;
      bump(c.userId, `${c.user.firstName} ${c.user.lastName}`.trim(), "lockedInCents", c.amount);
    }
  }

  // 2) Active deals (not cancelled) in scope, with the data computeDealCommission
  //    needs. Skip deals that already have a generated commission.
  const [company, activeProjects] = await Promise.all([
    prisma.company.findUnique({ where: { id: companyId }, select: { overheadPct: true, paFeePct: true } }),
    prisma.project.findMany({
      where: { companyId, status: { notIn: ["cancelled"] }, lead: scope.leadWhere },
      select: {
        id: true,
        contractValue: true,
        supplementCents: true,
        deductibleCents: true,
        repGetsSupplement: true,
        companyProvidedLead: true,
        lead: {
          select: {
            assignedRep: {
              select: { id: true, firstName: true, lastName: true, commissionSplitPct: true, providedLeadSplitPct: true, deductiblePct: true },
            },
          },
        },
      },
    }),
  ]);
  const overheadPct = company?.overheadPct ?? 0;
  const paFeePct = company?.paFeePct ?? 0;
  const estimableProjects = activeProjects.filter((p) => !generatedProjectIds.has(p.id) && p.lead?.assignedRep);

  // 3) Batch the job-cost lookup across all estimable deals in one query.
  const projectIds = estimableProjects.map((p) => p.id);
  const jobCostByProject = new Map<string, number>();
  if (projectIds.length > 0) {
    const txns = await prisma.transaction.findMany({
      where: { companyId, projectId: { in: projectIds }, approved: true, amountCents: { lt: 0 } },
      select: { projectId: true, amountCents: true, category: { select: { excludeFromJobCost: true } } },
    });
    for (const t of txns) {
      if (!t.projectId) continue;
      if (!t.category || t.category.excludeFromJobCost) continue; // mirror jobCostFromTransactions
      jobCostByProject.set(t.projectId, (jobCostByProject.get(t.projectId) ?? 0) + -t.amountCents);
    }
  }

  // 4) Estimate each deal's rep split using the rep's CURRENT terms.
  let estimatedCents = 0;
  for (const p of estimableProjects) {
    const rep = p.lead!.assignedRep!;
    const selfGen = rep.commissionSplitPct ?? null;
    const providedSplit = rep.providedLeadSplitPct ?? null;
    const activeSplit = p.companyProvidedLead ? (providedSplit ?? selfGen) : selfGen;
    const breakdown = computeDealCommission({
      baseCents: p.contractValue,
      supplementCents: p.supplementCents,
      deductibleCents: p.deductibleCents,
      costCents: jobCostByProject.get(p.id) ?? 0,
      overheadPct,
      paFeePct,
      repSplitPct: activeSplit ?? 0,
      repDeductiblePct: rep.deductiblePct ?? 0,
      repWaivesSupplement: !p.repGetsSupplement,
    });
    estimatedCents += breakdown.repCommissionCents;
    bump(rep.id, `${rep.firstName} ${rep.lastName}`.trim(), "estimatedCents", breakdown.repCommissionCents);
  }

  const byRep = [...rows.values()].sort(
    (a, b) => b.lockedInCents + b.estimatedCents - (a.lockedInCents + a.estimatedCents),
  );
  return { lockedInCents, estimatedCents, byRep };
}

export type ReportData = {
  totals: {
    totalLeads: number;
    wonLeads: number;
    closingRate: number;
    jobsSold: number;
    jobsCompleted: number;
    revenueCents: number;
    payrollOwedCents: number;
    commissionsOwedCents: number;
  };
  salesByRep: { name: string; jobs: number; revenueCents: number }[];
  leadsBySource: { name: string; count: number }[];
  projectsByStatus: { status: string; count: number }[];
  claimsByStatus: { status: string; count: number }[];
};

export async function getReportData(user: { companyId: string; userId: string; role: Role }): Promise<ReportData> {
  const companyId = user.companyId;
  // Finance/leadership see the whole company; a manager sees only their team;
  // everyone else (e.g. a sales rep) sees only their own numbers.
  const seesAll = ["super_admin", "admin", "accounting"].includes(user.role);
  const seesPayroll = seesAll; // managers never see payroll numbers
  const leadRel: Prisma.LeadWhereInput | undefined = seesAll
    ? undefined
    : user.role === "manager"
      ? { OR: [{ assignedRep: managerTeamUserFilter(user.userId) }, { createdBy: managerTeamUserFilter(user.userId) }] }
      : { assignedRepId: user.userId };
  const leadWhere: Prisma.LeadWhereInput = { companyId, ...(leadRel ?? {}) };
  const projectWhere: Prisma.ProjectWhereInput = { companyId, ...(leadRel ? { lead: leadRel } : {}) };
  const claimWhere: Prisma.ClaimWhereInput = { companyId, ...(leadRel ? { lead: leadRel } : {}) };
  const commissionWhere: Prisma.CommissionWhereInput = {
    companyId,
    status: { in: ["pending", "approved"] },
    ...(seesAll ? {} : user.role === "manager" ? { user: managerTeamUserFilter(user.userId) } : { userId: user.userId }),
  };

  const [
    totalLeads,
    wonLeads,
    projects,
    users,
    sources,
    leadsBySourceRaw,
    projectsByStatusRaw,
    claimsByStatusRaw,
    jobsCompleted,
    revenueAgg,
    payrollAgg,
    commissionAgg,
  ] = await Promise.all([
    prisma.lead.count({ where: leadWhere }),
    prisma.lead.count({ where: { ...leadWhere, ...(await wonLeadFilter(companyId)) } }),
    prisma.project.findMany({
      where: projectWhere,
      select: { contractValue: true, status: true, lead: { select: { assignedRepId: true } } },
    }),
    prisma.user.findMany({ where: { companyId }, select: { id: true, firstName: true, lastName: true } }),
    prisma.leadSource.findMany({ where: { companyId }, select: { id: true, name: true } }),
    prisma.lead.groupBy({ by: ["sourceId"], where: leadWhere, _count: { _all: true } }),
    prisma.project.groupBy({ by: ["status"], where: projectWhere, _count: { _all: true } }),
    prisma.claim.groupBy({ by: ["status"], where: claimWhere, _count: { _all: true } }),
    prisma.project.count({ where: { ...projectWhere, status: { in: ["completed", "closed"] } } }),
    prisma.project.aggregate({
      where: { ...projectWhere, status: { in: ["completed", "closed"] } },
      _sum: { contractValue: true },
    }),
    seesPayroll
      ? prisma.payrollItem.aggregate({ where: { paid: false, payrollRun: { companyId } }, _sum: { amount: true } })
      : Promise.resolve({ _sum: { amount: 0 } } as { _sum: { amount: number | null } }),
    prisma.commission.aggregate({ where: commissionWhere, _sum: { amount: true } }),
  ]);

  const userName = (id: string | null) => {
    const u = users.find((x) => x.id === id);
    return u ? `${u.firstName} ${u.lastName}` : "Unassigned";
  };
  const sourceName = (id: string | null) => sources.find((s) => s.id === id)?.name ?? "Unknown";

  // Sales by rep (from projects -> lead.assignedRep)
  const repMap = new Map<string, { name: string; jobs: number; revenueCents: number }>();
  for (const p of projects) {
    const repId = p.lead.assignedRepId;
    // "Sales by Rep" only counts projects that actually have an assigned rep —
    // unassigned revenue isn't attributable to anyone, so it's excluded here.
    if (!repId) continue;
    const entry = repMap.get(repId) ?? { name: userName(repId), jobs: 0, revenueCents: 0 };
    entry.jobs += 1;
    entry.revenueCents += p.contractValue;
    repMap.set(repId, entry);
  }

  return {
    totals: {
      totalLeads,
      wonLeads,
      closingRate: totalLeads ? Math.round((wonLeads / totalLeads) * 100) : 0,
      jobsSold: projects.length,
      jobsCompleted,
      revenueCents: revenueAgg._sum.contractValue ?? 0,
      payrollOwedCents: payrollAgg._sum.amount ?? 0,
      commissionsOwedCents: commissionAgg._sum.amount ?? 0,
    },
    salesByRep: [...repMap.values()].sort((a, b) => b.revenueCents - a.revenueCents),
    leadsBySource: leadsBySourceRaw.map((r) => ({ name: sourceName(r.sourceId), count: r._count._all })),
    projectsByStatus: projectsByStatusRaw.map((r) => ({ status: r.status.replace(/_/g, " "), count: r._count._all })),
    claimsByStatus: claimsByStatusRaw.map((r) => ({ status: r.status.replace(/_/g, " "), count: r._count._all })),
  };
}
