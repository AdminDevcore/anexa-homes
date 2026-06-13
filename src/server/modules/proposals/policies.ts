import type { Role } from "@prisma/client";

// Management can manage every proposal; field roles manage their own (Lead scope).
const MANAGEMENT_ROLES: Role[] = ["super_admin", "admin", "manager"];

export function canManageProposals(role: Role): boolean {
  return MANAGEMENT_ROLES.includes(role);
}
