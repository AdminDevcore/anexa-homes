import type { Role } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { roleGrants } from "@/server/rbac/matrix";
import { hasAgentsAccess } from "@/server/modules/agents/access";
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
  /**
   * The team this person BELONGS to, already resolved — a manager's own team
   * name, a rep's manager's, a canvasser's rep's manager's. Null when they sit
   * under nobody (or under a manager who hasn't named their team yet), which
   * the roster shows as a dash rather than inventing a label.
   *
   * Deliberately NOT called `teamName`: that is the raw column, and only a
   * manager has one. This is the resolved answer to "whose team are they on".
   */
  team: string | null;
};

/**
 * The team a person belongs to. A manager IS their team; everyone below
 * inherits it up the same chain the RBAC scope walks down —
 * canvasser → rep → manager (see managerTeamUserFilter in rbac/policies.ts).
 * Kept as one function so the roster, the profile and the leaderboard can never
 * disagree about who is on whose team.
 */
export function teamNameOf(u: {
  role: string;
  teamName: string | null;
  manager?: { teamName: string | null } | null;
  salesRep?: { manager?: { teamName: string | null } | null } | null;
}): string | null {
  if (u.role === "manager") return u.teamName;
  return u.manager?.teamName ?? u.salesRep?.manager?.teamName ?? null;
}

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
      teamName: true,
      manager: { select: { teamName: true } },
      salesRep: { select: { manager: { select: { teamName: true } } } },
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
    team: teamNameOf(u),
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

/** Somebody in a person's downline, as the Team card lists them. */
export type TeamPerson = { id: string; name: string; role: string; roleLabel: string; status: string };
/**
 * A rep on a manager's team, with the canvassers who sit under that rep.
 * Two levels because a manager's team IS two levels deep — the RBAC scope
 * reaches canvassers through their rep (managerTeamUserFilter), so the Team
 * card has to show the same people the manager can actually see.
 */
export type TeamReport = TeamPerson & { canvassers: TeamPerson[] };

export type UserDetail = TeamMember & {
  commissionSplitPct: number | null;
  providedLeadType: string;
  providedLeadSplitPct: number | null;
  providedLeadFlatCents: number | null;
  deductiblePct: number | null;
  /** Solar: the rep's net redline in cents per watt. See src/lib/solar-pay.ts. */
  solarRedlineCentsPerWatt: number | null;
  /** Solar: the rep's fixed rate in mills per watt. */
  solarPerWattMills: number | null;
  solarRedlinePerBatteryCents: number | null;
  solarPerBatteryFlatCents: number | null;
  solarBatteryPayPlan: "margin" | "flat" | null;
  solarLeadAdjustMode: "none" | "percentage" | "flat";
  solarCompanyLeadTakePct: number | null;
  solarCompanyLeadFlatCents: number | null;
  verticals: import("@prisma/client").Vertical[];
  /**
   * This manager's OWN team name — the raw column, null on everybody else.
   * `team` (from TeamMember) is the team they belong to; for a manager the two
   * are the same string, and for anyone else only `team` is filled.
   */
  teamName: string | null;
  // Canvasser → rep reporting.
  salesRepId: string | null;
  salesRepName: string | null;
  canvassers: TeamPerson[]; // who reports to this user (if a rep)
  // Rep → manager reporting.
  managerId: string | null;
  managerName: string | null;
  reports: TeamReport[]; // reps reporting to this user (if a manager)
  /** The ROLE's grant summary, for display. Not the override column. */
  permissions: RolePermission[];
  /**
   * The Agents access switch, derived from the `User.permissions` override
   * column — a different thing entirely from `permissions` above. Exposed as
   * the derived boolean so the page never reads the raw column, and so the
   * word `permissions` never means two things on one screen.
   */
  agentsAccess: boolean;
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
    select: { id: true, firstName: true, lastName: true, teamName: true },
  });
  // The team name rides along so the picker reads "Cheyenne — Team Alpha".
  // Two managers with similar names are told apart by the team, which is the
  // thing the person assigning a rep is actually thinking in.
  return mgrs.map((m) => ({ id: m.id, name: `${m.firstName} ${m.lastName}`.trim(), teamName: m.teamName }));
}

const asPerson = (u: { id: string; firstName: string; lastName: string; role: Role; status: string }): TeamPerson => ({
  id: u.id,
  name: `${u.firstName} ${u.lastName}`.trim(),
  role: u.role,
  roleLabel: roleLabel(u.role),
  status: u.status,
});

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
      solarRedlineCentsPerWatt: true,
      solarPerWattMills: true,
      solarRedlinePerBatteryCents: true,
      solarPerBatteryFlatCents: true,
      solarBatteryPayPlan: true,
      solarLeadAdjustMode: true,
      solarCompanyLeadTakePct: true,
      solarCompanyLeadFlatCents: true,
      verticals: true,
      teamName: true,
      // The per-person override column, read here so the member page does not
      // have to query it a second time. Returned below as the derived
      // `agentsAccess` boolean, never raw.
      permissions: true,
      salesRepId: true,
      salesRep: { select: { firstName: true, lastName: true, manager: { select: { teamName: true } } } },
      managerId: true,
      manager: { select: { firstName: true, lastName: true, teamName: true } },
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
    prisma.user.findMany({ where: { companyId, salesRepId: userId, deletedAt: null }, orderBy: { firstName: "asc" }, select: { id: true, firstName: true, lastName: true, role: true, status: true } }),
    prisma.user.findMany({
      where: { companyId, managerId: userId, deletedAt: null },
      orderBy: { firstName: "asc" },
      select: {
        id: true, firstName: true, lastName: true, role: true, status: true,
        // The second level of the team: a manager sees these people's work
        // through their rep, so the card lists them where the scope puts them.
        canvassers: {
          where: { deletedAt: null },
          orderBy: { firstName: "asc" },
          select: { id: true, firstName: true, lastName: true, role: true, status: true },
        },
      },
    }),
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
    solarRedlineCentsPerWatt: u.solarRedlineCentsPerWatt,
    solarPerWattMills: u.solarPerWattMills,
    solarRedlinePerBatteryCents: u.solarRedlinePerBatteryCents,
    solarPerBatteryFlatCents: u.solarPerBatteryFlatCents,
    solarBatteryPayPlan: u.solarBatteryPayPlan,
    solarLeadAdjustMode: u.solarLeadAdjustMode,
    solarCompanyLeadTakePct: u.solarCompanyLeadTakePct,
    solarCompanyLeadFlatCents: u.solarCompanyLeadFlatCents,
    verticals: u.verticals,
    team: teamNameOf(u),
    teamName: u.teamName,
    salesRepId: u.salesRepId,
    salesRepName: u.salesRep ? `${u.salesRep.firstName} ${u.salesRep.lastName}`.trim() : null,
    canvassers: canvassers.map(asPerson),
    managerId: u.managerId,
    managerName: u.manager ? `${u.manager.firstName} ${u.manager.lastName}`.trim() : null,
    reports: reports.map((r) => ({ ...asPerson(r), canvassers: r.canvassers.map(asPerson) })),
    permissions: rolePermissionSummary(u.role),
    agentsAccess: hasAgentsAccess(u.permissions),
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
