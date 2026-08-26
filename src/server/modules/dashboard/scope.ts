import type { Prisma, Vertical } from "@prisma/client";
import type { SessionUser } from "@/server/auth/session";
import { listScope } from "@/server/rbac/policies";

/**
 * The dashboard's two deal-flow filters: who the user may see, AND the active
 * workspace.
 *
 * Both are built with `AND: [scope, ...]` rather than a spread, and that is the
 * whole point of this file. `listScope(user, "Project")` expresses ownership for
 * every non-privileged role THROUGH the lead — `{ lead: { createdById } }` for
 * marketing, `{ lead: { OR: [...] } }` for a rep, a canvasser, a manager. The
 * vertical filter reaches the project through the lead too. Merged with a
 * spread, the second `lead` key silently replaced the first and the dashboard
 * counted the entire company's jobs for roles that are supposed to see only
 * their own. ANDing keeps both clauses; the calendar and commissions pages
 * already did it this way.
 */
export function dashboardLeadWhere(user: SessionUser, vertical: Vertical): Prisma.LeadWhereInput {
  return { AND: [listScope(user, "Lead") as Prisma.LeadWhereInput, { vertical }] };
}

export function dashboardProjectWhere(user: SessionUser, vertical: Vertical): Prisma.ProjectWhereInput {
  return { AND: [listScope(user, "Project") as Prisma.ProjectWhereInput, { lead: { is: { vertical } } }] };
}
