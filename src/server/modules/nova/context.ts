import { randomUUID } from "node:crypto";
import { prisma } from "@/server/db/client";
import type { SessionUser } from "@/server/auth/session";
import { resolvePageDeal } from "./page-context";
import type { NovaActor, NovaCtx } from "./types";

/**
 * The context one request runs in: the signed-in user exactly as the session
 * resolved them (role and per-user permission overrides included), the
 * company's timezone, and the deal on screen — if this user may open it.
 */
export async function buildNovaCtx(
  user: SessionUser,
  input: { pathname: string | null; conversationId: string | null }
): Promise<NovaCtx> {
  const actor: NovaActor = {
    userId: user.userId,
    companyId: user.companyId,
    role: user.role,
    permissions: user.permissions,
    fullName: user.fullName,
  };
  const [company, page] = await Promise.all([
    prisma.company.findUnique({ where: { id: user.companyId }, select: { timezone: true } }),
    resolvePageDeal(actor, input.pathname),
  ]);
  return {
    user: actor,
    conversationId: input.conversationId ?? randomUUID(),
    // Same default the appointment form uses when the company has none set.
    timeZone: company?.timezone || "America/Chicago",
    now: new Date(),
    page,
  };
}
