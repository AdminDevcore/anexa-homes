import { prisma } from "@/server/db/client";
import { runUnscoped } from "@/server/vertical/context";

export type LinkedDealSummary = {
  id: string;
  vertical: string;
  name: string;
  stageName: string | null;
  status: string;
};

/**
 * Read the linked deal for display.
 *
 * Crosses the vertical boundary on purpose, so it is deliberately narrow:
 * identity and stage only. No contract value, no documents, no financials —
 * a solar coordinator gets to see that the roof job exists and where it has
 * got to, and nothing else.
 */
export async function getLinkedDealSummary(
  companyId: string,
  linkedDealId: string | null
): Promise<LinkedDealSummary | null> {
  if (!linkedDealId) return null;
  const deal = await runUnscoped(
    "crossover: show the linked deal in the other workspace (identity + stage only)",
    () =>
      prisma.lead.findFirst({
        where: { id: linkedDealId, companyId },
        select: {
          id: true,
          vertical: true,
          firstName: true,
          lastName: true,
          status: true,
          stage: { select: { name: true } },
        },
      })
  );
  if (!deal) return null;
  return {
    id: deal.id,
    vertical: deal.vertical,
    name: `${deal.firstName} ${deal.lastName}`.trim(),
    stageName: deal.stage?.name ?? null,
    status: deal.status,
  };
}
