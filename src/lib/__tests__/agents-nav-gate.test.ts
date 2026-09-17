import { describe, it, expect } from "vitest";
import type { Role } from "@prisma/client";
import { PORTAL_NAV } from "@/lib/nav";
import { can } from "@/server/rbac/guards";
import { ROLES } from "@/server/rbac/matrix";
import { AGENT_ACCESS_KEYS, agentCan } from "@/server/modules/agents/access";

/**
 * CI guard: the Agents sidebar item and the Agents pages must answer the same
 * question.
 *
 * They are computed by two different pieces of code. The sidebar (portal
 * layout) asks `can(user, "read", "Agent")` AND the nav item's `roles`
 * allowlist; every Agents page asks `agentCan(user, "read")`. They agree today
 * only because of a difference that is easy to miss:
 *
 *   `can()` honours a per-person `User.permissions` override on ANY role.
 *   `agentCan` honours it only on a manager.
 *
 * So a stale `Agent:read: true` on a sales rep passes `can()` and fails
 * `agentCan` — and the ONLY thing patching over that is the `roles` allowlist
 * on the nav item. Delete `roles`, or add a role to it that `agentCan` does not
 * grant, and the sidebar draws a link to a page that redirects the person
 * straight back to the dashboard.
 *
 * Nothing but a comment held those two in agreement before this test.
 *
 * Deliberately scoped to the Agents item. This is not a test of PORTAL_NAV.
 */

const AGENTS = PORTAL_NAV.find((i) => i.href === "/portal/agents");
const SWITCH: Record<string, unknown> = Object.fromEntries(AGENT_ACCESS_KEYS.map((k) => [k, true]));

/** Exactly what src/app/portal/layout.tsx does to decide whether to draw an item. */
function sidebarShowsAgents(role: Role, permissions: Record<string, unknown>): boolean {
  if (!AGENTS) return false;
  return (
    can({ userId: "u", companyId: "c", role, permissions }, "read", AGENTS.resource) &&
    // `roles`, where an item has one, narrows further — it never widens.
    (!AGENTS.roles || AGENTS.roles.includes(role))
  );
}

describe("the Agents sidebar item and the Agents pages agree", () => {
  it("still has an Agents item, gated on the Agent resource", () => {
    expect(AGENTS).toBeDefined();
    expect(AGENTS?.resource).toBe("Agent");
    // If this allowlist ever goes, the case below is what starts failing.
    expect(AGENTS?.roles).toBeDefined();
  });

  it("draws the item exactly when agentCan(user, 'read') is true, for every role", () => {
    const rows = ROLES.flatMap((role) =>
      ([
        ["no override", {}],
        ["the Agents access switch", SWITCH],
      ] as const).map(([held, permissions]) => ({
        who: `${role} with ${held}`,
        sidebar: sidebarShowsAgents(role, permissions),
        pages: agentCan({ role, permissions }, "read"),
      }))
    );

    // Empty array rather than a boolean, so a failure names every role that
    // disagrees and which way round it went.
    expect(rows.filter((r) => r.sidebar !== r.pages)).toEqual([]);
  });
});
