import type { Prisma, Role, Vertical } from "@prisma/client";
import type { AccessUser } from "@/server/rbac/guards";

// Management roles manage the whole knowledge base AND see every category
// regardless of a category's `visibleRoles`.
const MANAGEMENT_ROLES: Role[] = ["super_admin", "admin", "manager"];

/**
 * The non-management staff roles a category's visibility can target. These are
 * the roles that only see training shared to them (super_admin/admin/manager are
 * omitted — they always see everything).
 */
export const TRAINING_AUDIENCE_ROLES: Role[] = [
  "sales_rep",
  "canvasser",
  "marketing",
  "installer",
  "accounting",
];

export function canManageKnowledge(role: Role): boolean {
  return MANAGEMENT_ROLES.includes(role);
}

/**
 * Prisma where-fragment scoping categories to exactly what `user` may see in the
 * active `vertical` workspace. Management roles see all; everyone else sees only
 * categories whose `visibleRoles` includes their role.
 */
export function categoryScope(
  user: AccessUser,
  vertical: Vertical
): Prisma.KnowledgeCategoryWhereInput {
  const base: Prisma.KnowledgeCategoryWhereInput = {
    companyId: user.companyId,
    vertical,
  };
  if (canManageKnowledge(user.role)) return base;
  return { ...base, visibleRoles: { has: user.role } };
}
