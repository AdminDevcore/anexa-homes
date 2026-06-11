import type { Role } from "@prisma/client";
import { isAdmin } from "@/server/rbac/matrix";

/** Managers + admins see every rep's knocks and manage territories. */
export function canManageAllCanvassing(role: Role): boolean {
  return isAdmin(role) || role === "manager";
}
