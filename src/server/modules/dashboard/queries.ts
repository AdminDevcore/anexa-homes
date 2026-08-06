import { prisma } from "@/server/db/client";
import type { SessionUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { listScope } from "@/server/rbac/policies";
import type { Prisma, Role, Vertical } from "@prisma/client";

// Roles allowed to see company financials on the dashboard: revenue, deal/lead
// dollar values. Field/ops roles (installer, canvasser, marketing) and customers
// are excluded. Adjust this list to change who sees money figures.
const FINANCIAL_ROLES: Role[] = ["super_admin", "admin", "manager", "accounting", "sales_rep"];
export function canSeeFinancials(user: Pick<SessionUser, "role">): boolean {
  return FINANCIAL_ROLES.includes(user.role);
}

export type DashboardStats = {
  totalLeads: number;
  activeProjects: number;
  jobsInProduction: number;
  pendingSignatures: number;
  pendingPayrollCents: number;
  pendingCommissionsCents: number;
  completedJobs: number;
  revenueCents: number;
  canSeePayroll: boolean;
  canSeeCommissions: boolean;
  canSeeFinancials: boolean;
};

export async function getDashboardStats(user: SessionUser, vertical: Vertical): Promise<DashboardStats> {
  // Deal-flow stats are isolated to the active vertical workspace.
  const leadWhere: Prisma.LeadWhereInput = { ...(listScope(user, "Lead") as Prisma.LeadWhereInput), vertical };
  const projectWhere: Prisma.ProjectWhereInput = { ...(listScope(user, "Project") as Prisma.ProjectWhereInput), lead: { vertical } };
  const docWhere = listScope(user, "Document") as Prisma.DocumentPackageWhereInput;

  const canSeePayroll = can(user, "read", "Payroll");
  const canSeeCommissions = can(user, "read", "Commission");
  const seeFinancials = canSeeFinancials(user);

  const [
    totalLeads,
    activeProjects,
    jobsInProduction,
    pendingSignatures,
    completedJobs,
    revenueAgg,
  ] = await Promise.all([
    prisma.lead.count({ where: leadWhere }),
    prisma.project.count({
      where: { ...projectWhere, status: { in: ["not_started", "in_production", "on_hold", "qc"] } },
    }),
    prisma.project.count({ where: { ...projectWhere, status: "in_production" } }),
    prisma.documentPackage.count({
      where: { ...docWhere, status: { in: ["sent", "viewed", "partially_signed"] } },
    }),
    prisma.project.count({
      where: { ...projectWhere, status: { in: ["completed", "closed"] } },
    }),
    prisma.project.aggregate({
      where: { ...projectWhere, status: { in: ["completed", "closed"] } },
      _sum: { contractValue: true },
    }),
  ]);

  let pendingPayrollCents = 0;
  if (canSeePayroll) {
    const agg = await prisma.payrollItem.aggregate({
      where: { paid: false, payrollRun: { companyId: user.companyId } },
      _sum: { amount: true },
    });
    pendingPayrollCents = agg._sum.amount ?? 0;
  }

  let pendingCommissionsCents = 0;
  if (canSeeCommissions) {
    const commWhere = listScope(user, "Commission") as Prisma.CommissionWhereInput;
    const agg = await prisma.commission.aggregate({
      where: { ...commWhere, status: { in: ["pending", "approved"] } },
      _sum: { amount: true },
    });
    pendingCommissionsCents = agg._sum.amount ?? 0;
  }

  return {
    totalLeads,
    activeProjects,
    jobsInProduction,
    pendingSignatures,
    pendingPayrollCents,
    pendingCommissionsCents,
    completedJobs,
    // Revenue is only surfaced to financial roles; zeroed otherwise so the figure
    // never reaches the client for roles that can't see it.
    revenueCents: seeFinancials ? revenueAgg._sum.contractValue ?? 0 : 0,
    canSeePayroll,
    canSeeCommissions,
    canSeeFinancials: seeFinancials,
  };
}

export async function getRecentLeads(user: SessionUser, vertical: Vertical, take = 6) {
  const where: Prisma.LeadWhereInput = { ...(listScope(user, "Lead") as Prisma.LeadWhereInput), vertical };
  const leads = await prisma.lead.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take,
    include: {
      stage: { select: { name: true, color: true } },
      assignedRep: { select: { firstName: true, lastName: true } },
      source: { select: { name: true } },
    },
  });
  // Strip deal value for non-financial roles so it never reaches the client.
  const seeFinancials = canSeeFinancials(user);
  return leads.map((l) => ({ ...l, value: seeFinancials ? l.value : null }));
}

export async function getRecentProjects(user: SessionUser, vertical: Vertical, take = 6) {
  const where: Prisma.ProjectWhereInput = { ...(listScope(user, "Project") as Prisma.ProjectWhereInput), lead: { vertical } };
  return prisma.project.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take,
    include: {
      // The stage comes along because it, not `Project.status`, is where a
      // job's status lives now — see the badge in the dashboard's project list.
      lead: { select: { firstName: true, lastName: true, stage: { select: { name: true } } } },
      manager: { select: { firstName: true, lastName: true } },
    },
  });
}
