import { prisma } from "@/server/db/client";
import { leadAccessible } from "@/server/rbac/lead-access";
import type { NovaActor, PageDeal } from "./types";

const DEAL_PATH =
  /^\/portal\/leads\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i;

/** The deal id in a portal path, or null. Pure — it trusts nothing. */
export function dealIdFromPath(pathname: string | null | undefined): string | null {
  const match = pathname ? DEAL_PATH.exec(pathname) : null;
  return match ? match[1].toLowerCase() : null;
}

/**
 * "This deal" — the one on screen, but only if this user may open it and it
 * is a Solar deal. The browser tells us the path; the row check decides. A
 * path naming someone else's deal, or a Roofing one, resolves to no page deal
 * at all, exactly as the deal page itself would 404.
 */
export async function resolvePageDeal(
  user: NovaActor,
  pathname: string | null | undefined
): Promise<PageDeal | null> {
  const id = dealIdFromPath(pathname);
  if (!id) return null;
  const row = await leadAccessible(user, id);
  if (!row || row.vertical !== "solar") return null;
  const lead = await prisma.lead.findUnique({
    where: { id },
    select: { firstName: true, lastName: true },
  });
  return lead ? { leadId: id, name: `${lead.firstName} ${lead.lastName}`.trim() } : null;
}
