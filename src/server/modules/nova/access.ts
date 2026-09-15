import { can } from "@/server/rbac/guards";
import type { Action, Resource } from "@/server/rbac/matrix";
import { leadAccessible } from "@/server/rbac/lead-access";
import { roleLabel } from "@/lib/roles";
import type { NovaActor, NovaCtx, ToolResult } from "./types";

/**
 * Permission checks for Nova — thin wrappers, never new rules.
 *
 * Everything here delegates to the portal's own `can()` (role matrix plus any
 * per-user override) and `leadAccessible()` (row scope). The only thing added
 * is the sentence Nova says when the answer is no.
 */

type Refusal = Extract<ToolResult, { ok: false }>;

/** Null when allowed; otherwise the refusal to return, naming the role. */
export function refuseUnless(
  user: NovaActor,
  action: Action,
  resource: Resource,
  doing: string
): Refusal | null {
  if (can(user, action, resource)) return null;
  return {
    ok: false,
    reason: "refused",
    message: `Your role (${roleLabel(user.role)}) can't ${doing}.`,
  };
}

export const DEAL_OUT_OF_REACH =
  "I can't find that deal among the Solar deals you can open.";

/**
 * The deal a tool acts on: the one named, else the one on screen — and only if
 * this user may open it and it lives in Solar. A Roofing deal and another
 * rep's deal get the same answer, the same way the deal page 404s both.
 */
export async function resolveDeal(
  ctx: NovaCtx,
  dealId: string | undefined
): Promise<{ ok: true; leadId: string } | Refusal> {
  const id = dealId ?? ctx.page?.leadId;
  if (!id) {
    return {
      ok: false,
      reason: "invalid",
      message: "Which deal? Tell me the customer's name, or open the deal first.",
    };
  }
  const row = await leadAccessible(ctx.user, id);
  if (!row || row.vertical !== "solar") {
    return { ok: false, reason: "refused", message: DEAL_OUT_OF_REACH };
  }
  return { ok: true, leadId: row.id };
}
