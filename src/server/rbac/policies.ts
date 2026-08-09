import type { Prisma } from "@prisma/client";
import type { AccessUser } from "./guards";
import type { Resource } from "./matrix";

export type WhereFragment = Record<string, unknown>;

/**
 * A Prisma `User` filter matching everyone on a sales manager's team:
 *   • the manager themselves
 *   • sales reps who report to them (User.managerId)
 *   • canvassers under those reps (User.salesRep.managerId)
 * Use it against any User relation, e.g. `{ assignedRep: managerTeamUserFilter(id) }`.
 */
export function managerTeamUserFilter(managerId: string): Prisma.UserWhereInput {
  return {
    OR: [{ id: managerId }, { managerId }, { salesRep: { managerId } }],
  };
}

/**
 * A Prisma `Project` filter matching the jobs an installer is assigned to via
 * their crew. Use against a Project relation, e.g. `{ project: installerProjectFilter(id) }`.
 */
export function installerProjectFilter(userId: string): Prisma.ProjectWhereInput {
  return { crewAssignments: { some: { crew: { members: { some: { userId } } } } } };
}

/**
 * Returns a Prisma `where` fragment that scopes a list query to exactly the rows
 * the user is allowed to see. ALWAYS spread this into queries that read tenant data.
 *
 * Base rule: everything is scoped to the user's company (tenant isolation).
 * Then narrowed further by role for sensitive resources.
 */
export function listScope(user: AccessUser, resource: Resource): WhereFragment {
  const base: WhereFragment = { companyId: user.companyId };
  const role = user.role;

  // Admins/super admins see the whole company.
  if (role === "super_admin" || role === "admin") return base;

  switch (resource) {
    case "Lead": {
      if (role === "sales_rep") {
        // Their own leads, plus anything their assigned canvassers generated.
        return {
          ...base,
          OR: [{ assignedRepId: user.userId }, { createdBy: { salesRepId: user.userId } }],
        };
      }
      if (role === "canvasser") {
        // A canvasser sees only their own deals (assigned to or created by them).
        return { ...base, OR: [{ assignedRepId: user.userId }, { createdById: user.userId }] };
      }
      if (role === "marketing") {
        // A marketing / lead-provider sees only the leads they submitted.
        return { ...base, createdById: user.userId };
      }
      if (role === "manager") {
        // A manager sees only their team's leads (their reps + canvassers under them).
        const team = managerTeamUserFilter(user.userId);
        return { ...base, OR: [{ assignedRep: team }, { createdBy: team }] };
      }
      if (role === "installer") {
        // Installers only see leads whose job they're assigned to (via their crew).
        return { ...base, project: installerProjectFilter(user.userId) };
      }
      if (role === "accounting") return base; // financial role: company-wide read.
      // Any other non-privileged role sees nothing by default (deny-by-default).
      // That includes the retired `customer` role, which used to get its own
      // "only your own deal" branch here: homeowners have no accounts in this
      // product, so a row that still carries the role resolves to nothing.
      return { ...base, id: "__none__" };
    }

    case "Project": {
      if (role === "sales_rep") {
        return { ...base, lead: { OR: [{ assignedRepId: user.userId }, { createdBy: { salesRepId: user.userId } }] } };
      }
      if (role === "canvasser") {
        return { ...base, lead: { OR: [{ assignedRepId: user.userId }, { createdById: user.userId }] } };
      }
      if (role === "marketing") {
        return { ...base, lead: { createdById: user.userId } };
      }
      if (role === "installer") {
        return { ...base, ...installerProjectFilter(user.userId) };
      }
      if (role === "manager") {
        const team = managerTeamUserFilter(user.userId);
        return { ...base, lead: { OR: [{ assignedRep: team }, { createdBy: team }] } };
      }
      if (role === "accounting") return base; // financial role: company-wide read.
      return { ...base, id: "__none__" };
    }

    case "Commission": {
      // Accounting sees all; a manager sees only their team's; reps see their own.
      if (role === "accounting") return base;
      if (role === "manager") return { ...base, user: managerTeamUserFilter(user.userId) };
      return { ...base, userId: user.userId };
    }

    case "Payroll": {
      // Only accounting/admin reach payroll; others get an impossible filter.
      if (role === "accounting") return base;
      return { ...base, id: "__none__" };
    }

    case "Document": {
      if (role === "sales_rep") {
        return { ...base, lead: { OR: [{ assignedRepId: user.userId }, { createdBy: { salesRepId: user.userId } }] } };
      }
      if (role === "canvasser") {
        return { ...base, lead: { OR: [{ assignedRepId: user.userId }, { createdById: user.userId }] } };
      }
      if (role === "marketing") {
        return { ...base, lead: { createdById: user.userId } };
      }
      if (role === "installer") {
        // Documents on jobs the installer's crew is assigned to.
        return { ...base, lead: { project: installerProjectFilter(user.userId) } };
      }
      if (role === "manager") {
        const team = managerTeamUserFilter(user.userId);
        return { ...base, lead: { OR: [{ assignedRep: team }, { createdBy: team }] } };
      }
      if (role === "accounting") return base;
      return { ...base, id: "__none__" };
    }

    case "Task": {
      // Admins (handled above) oversee all. A manager sees their team's tasks;
      // everyone else sees only tasks assigned to them or that they created.
      if (role === "manager") {
        const team = managerTeamUserFilter(user.userId);
        return { ...base, OR: [{ assignee: team }, { createdBy: team }] };
      }
      return { ...base, OR: [{ assigneeId: user.userId }, { createdById: user.userId }] };
    }

    default:
      return base;
  }
}
