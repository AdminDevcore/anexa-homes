import { prisma } from "@/server/db/client";
import type { NovaCtx } from "../types";

const SELF = /^(me|my|mine|myself|i)$/i;

/**
 * Staff in this company whose name contains every word said — or the caller,
 * for "me". Used only to NARROW a query that is already row-scoped (whose deals,
 * whose tasks), never to reveal anything a filter would not.
 */
export async function resolvePeople(
  ctx: NovaCtx,
  said: string
): Promise<{ id: string; name: string }[]> {
  if (SELF.test(said.trim())) return [{ id: ctx.user.userId, name: ctx.user.fullName }];
  const tokens = said.trim().split(/\s+/).filter(Boolean);
  const people = await prisma.user.findMany({
    where: {
      companyId: ctx.user.companyId,
      deletedAt: null,
      role: { not: "customer" },
      AND: tokens.map((t) => ({
        OR: [
          { firstName: { contains: t, mode: "insensitive" as const } },
          { lastName: { contains: t, mode: "insensitive" as const } },
        ],
      })),
    },
    take: 10,
    select: { id: true, firstName: true, lastName: true },
  });
  return people.map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}`.trim() }));
}
