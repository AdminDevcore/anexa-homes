import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { can } from "@/server/rbac/guards";
import { listScope } from "@/server/rbac/policies";
import { getActiveVertical } from "@/server/auth/vertical";
import type { SessionUser } from "@/server/auth/session";
import { countContractorInvoicesNeedingAttention } from "@/server/modules/contractor-pay/queries";

/**
 * What is waiting on each Pay tab, keyed by the tab's href.
 *
 * Counted, not fetched: this runs on BOTH halves of the page (each one needs
 * the other's number for its badge), so it is two `count` queries rather than
 * two more lists. Each is read exactly the way its own page reads it — the
 * commission side through `listScope` and the active workspace, the invoice
 * side through the file table's workspace filter — so a badge can never promise
 * rows the page would then refuse to show.
 *
 * Nothing is counted for a tab the user cannot open, and the strip itself is
 * not drawn unless they hold both.
 */
export async function payTabCounts(user: SessionUser): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};

  const [commissions, contractor] = await Promise.all([
    can(user, "read", "Commission") ? pendingCommissions(user) : Promise.resolve(null),
    can(user, "read", "ContractorInvoice")
      ? countContractorInvoicesNeedingAttention(user.companyId)
      : Promise.resolve(null),
  ]);

  if (commissions !== null) counts["/portal/commissions"] = commissions;
  if (contractor !== null) counts["/portal/contractor-pay"] = contractor;
  return counts;
}

async function pendingCommissions(user: SessionUser): Promise<number> {
  const vertical = await getActiveVertical(user);
  return prisma.commission.count({
    where: {
      AND: [
        listScope(user, "Commission") as Prisma.CommissionWhereInput,
        { project: { lead: { vertical } } },
        { status: "pending" },
      ],
    },
  });
}
