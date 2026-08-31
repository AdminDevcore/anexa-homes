import { prisma } from "@/server/db/client";

/**
 * The closeout packet, as templates.
 *
 * Deliberately NOT a server action: it takes a companyId, and a "use server"
 * file exports an endpoint the browser can call with whatever companyId it
 * likes. The deal page calls this directly and `sendFinalDocsAction` calls it
 * after `requireUser`, so the id is always the session's own.
 *
 * No vertical filter here on purpose. `DocumentTemplate` is a SCOPED model
 * (see server/vertical/models.ts), so the isolation extension has already
 * narrowed reads to the active workspace — a solar deal's page asks in the
 * solar workspace and gets solar templates. Repeating the filter would be a
 * second, weaker copy of a guarantee that already holds.
 *
 * `createdAt asc` is the packet's print order — see the column comment on
 * DocumentTemplate.finalPacket.
 */
export async function finalPacketTemplates(companyId: string) {
  return prisma.documentTemplate.findMany({
    where: { companyId, finalPacket: true, active: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });
}
