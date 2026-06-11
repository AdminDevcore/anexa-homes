import type { Prisma, Role } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { managerTeamUserFilter } from "@/server/rbac/policies";

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
    prisma.lead.count({ where: { ...leadWhere, status: "won" } }),
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
