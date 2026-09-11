import type { Prisma, Vertical } from "@prisma/client";
import { prisma } from "@/server/db/client";
import type { AccessUser } from "./guards";
import { listScope } from "./policies";

/**
 * "May this user act on this deal?" — the row-level half of authorisation.
 *
 * WHY THIS EXISTS AS ONE FUNCTION. A server action holds two separate
 * questions and they are easy to confuse:
 *
 *   can(user, "update", "Lead")   — may you edit deals AT ALL?
 *   leadAccessible(user, leadId)  — may you edit THIS one?
 *
 * The first is the matrix; the second is `listScope`. Every export of a
 * `"use server"` module is a public RPC endpoint, so the id in the second
 * question is whatever the caller typed. Checking only the first is the same
 * bug in every module that has had it: `sales_rep` holds `Lead:update`, so a
 * rep who changes one character of a leadId edits another rep's deal — their
 * design, their pricing, their lender, their credit settings — and the deal
 * page that would have 404'd them never gets consulted, because the browser
 * never went there.
 *
 * The shape is lifted from `scope/actions.ts`, which got this right first and
 * is now the pattern rather than the exception.
 *
 * AND, NOT SPREAD. `listScope` returns fragments carrying their own `OR` for
 * every non-privileged role. Spread into a `where` beside another `OR`, the
 * second key wins and the scope evaporates without an error — see the note on
 * `dashboardLeadWhere` in modules/dashboard/scope.ts, which is the same trap
 * found the expensive way.
 *
 * Returns the row (never a boolean) because callers need `vertical` to refuse
 * a roofing deal from a solar action, and because `if (!lead) return fail(…)`
 * reads better than a negated predicate.
 */
export async function leadAccessible(
  user: AccessUser,
  leadId: string
): Promise<{ id: string; vertical: Vertical } | null> {
  const scope = listScope(user, "Lead") as Prisma.LeadWhereInput;
  return prisma.lead.findFirst({
    where: { AND: [{ id: leadId }, scope] },
    select: { id: true, vertical: true },
  });
}

/**
 * The same question about a JOB.
 *
 * Separate from `leadAccessible` rather than derived from it because the two
 * scopes genuinely differ: an installer reaches the PROJECT they are named on
 * without reaching the DEAL behind it. Asking the wrong one would either lock
 * a crew out of their own install or let them read the homeowner's contract.
 * See the installer branches in policies.ts.
 */
export async function projectAccessible(
  user: AccessUser,
  projectId: string
): Promise<{ id: string; leadId: string | null } | null> {
  const scope = listScope(user, "Project") as Prisma.ProjectWhereInput;
  return prisma.project.findFirst({
    where: { AND: [{ id: projectId }, scope] },
    select: { id: true, leadId: true },
  });
}
