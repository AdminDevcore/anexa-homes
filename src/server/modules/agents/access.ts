import type { Role } from "@prisma/client";
import { roleCan } from "@/server/rbac/matrix";

/**
 * Who may do what with agents. Every agents page and action asks here, not
 * `can()`, for two reasons:
 *
 *  1. There is no Operations role. `manager` is both the sales manager and
 *     the solar coordinators, so access for managers with the Agents access
 *     switch is a per-person toggle that writes these three keys into
 *     `User.permissions`. Only a `manager` may hold them; on any other role
 *     they are ignored. Owners and admins already run and resolve agents by
 *     role (see rbac/matrix.ts) — the switch only extends that to managers.
 *  2. Editing config is ROLE-ONLY. `can()` honours any override, so a
 *     hand-edited `Agent:update: true` would be config access through `can()`.
 *     `canEditAgentConfig` never reads overrides.
 *
 * `can()` (in `server/rbac/guards.ts`) honours ANY role's `User.permissions`
 * override, not just a manager's. Nova's `refuseUnless` is built on `can()`,
 * so an agent tool ever added to Nova must call `agentCan`, not `can()` —
 * that is the only thing that keeps the Agents access switch limited to
 * managers.
 *
 * Nothing writes a `false` override today. `agentCan` ignores `false` — it
 * only reads `true` grants — so revocation works by deleting the keys
 * (`withoutAgentsAccess`), never by writing `false`.
 *
 * A partial switch, where a manager has only `Agent:approve` set, passes
 * `agentCan(user, "approve")` while `hasAgentsAccess` reads the switch as
 * off, since that requires all three keys. Only a direct database edit can
 * produce that state; toggling the switch off with `withoutAgentsAccess`
 * clears all three at once.
 */

export type AgentVerb = "read" | "run" | "approve";

export const AGENT_ACCESS_KEYS = ["Agent:read", "Agent:run", "Agent:approve"] as const;

/** The only role the switch can be given to. */
export const AGENT_ACCESS_ROLE: Role = "manager";

export const AGENT_CONFIG_ROLES: readonly Role[] = ["super_admin", "admin"];

type WithRole = { role: Role; permissions?: Record<string, unknown> | null };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function agentCan(user: WithRole, verb: AgentVerb): boolean {
  if (roleCan(user.role, verb, "Agent")) return true;
  if (user.role !== AGENT_ACCESS_ROLE) return false;
  return asRecord(user.permissions)[`Agent:${verb}`] === true;
}

export function canEditAgentConfig(user: { role: Role }): boolean {
  return AGENT_CONFIG_ROLES.includes(user.role);
}

export function hasAgentsAccess(permissions: unknown): boolean {
  const p = asRecord(permissions);
  return AGENT_ACCESS_KEYS.every((k) => p[k] === true);
}

export function withAgentsAccess(permissions: unknown): Record<string, unknown> {
  const next = { ...asRecord(permissions) };
  for (const k of AGENT_ACCESS_KEYS) next[k] = true;
  return next;
}

/** Deletes the keys. Never writes `false`: a false override would beat a role grant. */
export function withoutAgentsAccess(permissions: unknown): Record<string, unknown> {
  const next = { ...asRecord(permissions) };
  for (const k of AGENT_ACCESS_KEYS) delete next[k];
  return next;
}
