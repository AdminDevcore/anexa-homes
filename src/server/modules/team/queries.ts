import type { Role } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { roleGrants } from "@/server/rbac/matrix";
import { roleLabel } from "@/lib/roles";

// Hierarchy order for grouping/sorting by role.
export const ROLE_ORDER: Role[] = [
  "super_admin",
  "admin",
  "manager",
  "sales_rep",
  "canvasser",
  "marketing",
  "installer",
  "accounting",
];

export function roleRank(role: string): number {
  const i = ROLE_ORDER.indexOf(role as Role);
  return i === -1 ? ROLE_ORDER.length : i;
}

export type TeamMember = {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  role: string;
  roleLabel: string;
  title: string | null;
  status: string;
  avatarUrl: string | null;
  employeeNo: number | null;
  createdAt: string;
  lastLoginAt: string | null;
};

export async function getTeamMembers(viewer: { companyId: string; userId: string; role: Role }): Promise<TeamMember[]> {
  const companyId = viewer.companyId;
  // A sales manager sees only their own team (themselves + their reps + the
  // canvassers under those reps); admins/leadership see the whole company.
  const teamScope =
    viewer.role === "manager"
      ? {
          OR: [
            { id: viewer.userId },
            { managerId: viewer.userId },
            { salesRep: { managerId: viewer.userId } },
          ],
        }
      : {};
  const users = await prisma.user.findMany({
    where: { companyId, role: { not: "customer" as Role }, deletedAt: null, ...teamScope },
    orderBy: [{ firstName: "asc" }],
    select: {
      id: true, firstName: true, lastName: true, email: true, phone: true,
      role: true, title: true, status: true, avatarUrl: true, employeeNo: true, createdAt: true, lastLoginAt: true,
    },
  });
  return users.map((u) => ({
    id: u.id,
    name: `${u.firstName} ${u.lastName}`.trim(),
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    phone: u.phone,
    role: u.role,
    roleLabel: roleLabel(u.role),
    title: u.title,
    status: u.status,
    avatarUrl: u.avatarUrl,
    employeeNo: u.employeeNo,
    createdAt: u.createdAt.toISOString(),
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
  }));
}

export type PendingInvite = {
  id: string;
  email: string;
  role: string;
  roleLabel: string;
  invitedByName: string | null;
  createdAt: string;
  expiresAt: string;
  expired: boolean;
};

/**
 * Pending (not-yet-accepted) invitations. These live in the Invitation table,
 * separate from User, so they don't appear in getTeamMembers — surfaced here so
 * the Team page can show who's been invited but hasn't joined. A manager sees
 * only invites they sent; admins/leadership see all company invites.
 */
export async function getPendingInvitations(viewer: { companyId: string; userId: string; role: Role }): Promise<PendingInvite[]> {
  const scope = viewer.role === "manager" ? { invitedById: viewer.userId } : {};
  const invites = await prisma.invitation.findMany({
    where: { companyId: viewer.companyId, acceptedAt: null, ...scope },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, email: true, role: true, createdAt: true, expiresAt: true,
      invitedBy: { select: { firstName: true, lastName: true } },
    },
  });
  const now = Date.now();
  return invites.map((i) => ({
    id: i.id,
    email: i.email,
    role: i.role,
    roleLabel: roleLabel(i.role),
    invitedByName: i.invitedBy ? `${i.invitedBy.firstName} ${i.invitedBy.lastName}`.trim() : null,
    createdAt: i.createdAt.toISOString(),
    expiresAt: i.expiresAt.toISOString(),
    expired: i.expiresAt.getTime() < now,
  }));
}

export type RolePermission = { resource: string; actions: string[]; full: boolean };

/** Human-readable "what this role can access" summary from the RBAC matrix. */
export function rolePermissionSummary(role: Role): RolePermission[] {
  const grants = roleGrants(role);
  return Object.entries(grants).map(([resource, actions]) => {
    const acts = (actions as readonly string[]) ?? [];
    const full = acts.includes("manage");
    return { resource, actions: full ? ["full access"] : [...acts], full };
  });
}

export type UserDetail = TeamMember & {
  commissionSplitPct: number | null;
  providedLeadType: string;
  providedLeadSplitPct: number | null;
  providedLeadFlatCents: number | null;
  deductiblePct: number | null;
  verticals: import("@prisma/client").Vertical[];
  // Canvasser → rep reporting.
  salesRepId: string | null;
  salesRepName: string | null;
  canvassers: { id: string; name: string }[]; // who reports to this user (if a rep)
  // Rep → manager reporting.
  managerId: string | null;
  managerName: string | null;
  reports: { id: string; name: string }[]; // reps reporting to this user (if a manager)
  permissions: RolePermission[];
  activity: {
    assignedLeads: number;
    openTasks: number;
    doneTasks: number;
    appointments: number;
    knocks: number;
    commissionCount: number;
    commissionTotalCents: number;
  };
};

/** Active users a canvasser can be assigned to (sales reps + management). */
export async function getAssignableReps(companyId: string, excludeUserId?: string) {
  const reps = await prisma.user.findMany({
    where: {
      companyId,
      status: "active",
      role: { in: ["sales_rep", "manager", "admin", "super_admin"] },
      ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
    },
    orderBy: [{ role: "asc" }, { firstName: "asc" }],
    select: { id: true, firstName: true, lastName: true },
  });
  return reps.map((r) => ({ id: r.id, name: `${r.firstName} ${r.lastName}`.trim() }));
}

/** Active sales managers a rep can be assigned under. */
export async function getAssignableManagers(companyId: string, excludeUserId?: string) {
  const mgrs = await prisma.user.findMany({
    where: {
      companyId,
      status: "active",
      role: "manager",
      ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
    },
    orderBy: [{ firstName: "asc" }],
    select: { id: true, firstName: true, lastName: true },
  });
  return mgrs.map((m) => ({ id: m.id, name: `${m.firstName} ${m.lastName}`.trim() }));
}

export async function getUserDetail(companyId: string, userId: string): Promise<UserDetail | null> {
  const u = await prisma.user.findFirst({
    where: { id: userId, companyId },
    select: {
      id: true, firstName: true, lastName: true, email: true, phone: true,
      role: true, title: true, status: true, avatarUrl: true, employeeNo: true, createdAt: true, lastLoginAt: true,
      commissionSplitPct: true,
      providedLeadType: true,
      providedLeadSplitPct: true,
      providedLeadFlatCents: true,
      deductiblePct: true,
      verticals: true,
      salesRepId: true,
      salesRep: { select: { firstName: true, lastName: true } },
      managerId: true,
      manager: { select: { firstName: true, lastName: true } },
    },
  });
  if (!u) return null;

  const [assignedLeads, openTasks, doneTasks, appointments, knocks, commission, canvassers, reports] = await Promise.all([
    prisma.lead.count({ where: { companyId, assignedRepId: userId } }),
    prisma.task.count({ where: { companyId, assigneeId: userId, status: { not: "done" } } }),
    prisma.task.count({ where: { companyId, assigneeId: userId, status: "done" } }),
    prisma.knock.count({ where: { companyId, repId: userId, appointmentAt: { not: null } } }),
    prisma.knock.count({ where: { companyId, repId: userId, disposition: { not: "not_knocked" } } }),
    prisma.commission.aggregate({ where: { companyId, userId }, _count: true, _sum: { amount: true } }),
    prisma.user.findMany({ where: { companyId, salesRepId: userId }, orderBy: { firstName: "asc" }, select: { id: true, firstName: true, lastName: true } }),
    prisma.user.findMany({ where: { companyId, managerId: userId }, orderBy: { firstName: "asc" }, select: { id: true, firstName: true, lastName: true } }),
  ]);

  return {
    id: u.id,
    name: `${u.firstName} ${u.lastName}`.trim(),
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    phone: u.phone,
    role: u.role,
    roleLabel: roleLabel(u.role),
    title: u.title,
    status: u.status,
    avatarUrl: u.avatarUrl,
    employeeNo: u.employeeNo,
    createdAt: u.createdAt.toISOString(),
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    commissionSplitPct: u.commissionSplitPct,
    providedLeadType: u.providedLeadType,
    providedLeadSplitPct: u.providedLeadSplitPct,
    providedLeadFlatCents: u.providedLeadFlatCents,
    deductiblePct: u.deductiblePct,
    verticals: u.verticals,
    salesRepId: u.salesRepId,
    salesRepName: u.salesRep ? `${u.salesRep.firstName} ${u.salesRep.lastName}`.trim() : null,
    canvassers: canvassers.map((c) => ({ id: c.id, name: `${c.firstName} ${c.lastName}`.trim() })),
    managerId: u.managerId,
    managerName: u.manager ? `${u.manager.firstName} ${u.manager.lastName}`.trim() : null,
    reports: reports.map((r) => ({ id: r.id, name: `${r.firstName} ${r.lastName}`.trim() })),
    permissions: rolePermissionSummary(u.role),
    activity: {
      assignedLeads,
      openTasks,
      doneTasks,
      appointments,
      knocks,
      commissionCount: commission._count,
      commissionTotalCents: commission._sum.amount ?? 0,
    },
  };
}
