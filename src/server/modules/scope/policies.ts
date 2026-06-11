import type { Role, ClaimStatus } from "@prisma/client";

// Only management sees our cost and profit/margin. Everyone else sees the
// insurance/scope side. Enforced in BOTH the payload serializer and the UI.
const MANAGEMENT_ROLES: Role[] = ["super_admin", "admin", "manager"];

export function canSeeScopeCosts(role: Role): boolean {
  return MANAGEMENT_ROLES.includes(role);
}

// Claim statuses at/after which the scope of work is available (scope has been
// received from the carrier). Before this, the deal has no scope tab.
const SCOPE_READY_STATUSES: ClaimStatus[] = [
  "scope_received",
  "supplement_needed",
  "approved",
  "paid",
  "closed",
];

export function isScopeReady(status: ClaimStatus): boolean {
  return SCOPE_READY_STATUSES.includes(status);
}

/**
 * True when the deal's current pipeline stage is at or after "Scope Received".
 * `stages` must be ordered by position. Falls back to false if the pipeline has
 * no scope_received stage. This is the badge the user actually sees on the deal.
 */
export function stageAtOrAfterScope(
  stages: { id: string; key: string }[],
  currentStageId: string | null | undefined
): boolean {
  const target = stages.findIndex((s) => s.key === "scope_received");
  const current = stages.findIndex((s) => s.id === currentStageId);
  return target >= 0 && current >= target;
}
