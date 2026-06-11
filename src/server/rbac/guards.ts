import type { Role } from "@prisma/client";
import { roleCan, type Action, type Resource } from "./matrix";

// Minimal shape required to make access decisions. The full session adds more.
export type AccessUser = {
  userId: string;
  companyId: string;
  role: Role;
  permissions?: Record<string, unknown> | null;
};

export class ForbiddenError extends Error {
  status = 403;
  constructor(message = "You do not have permission to perform this action.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class UnauthorizedError extends Error {
  status = 401;
  constructor(message = "You must be signed in.") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/**
 * Per-user permission overrides take the shape:
 *   { "Lead:delete": true, "Payroll:read": false }
 * An explicit value (true/false) overrides the role matrix.
 */
function overrideFor(
  user: AccessUser,
  action: Action,
  resource: Resource
): boolean | undefined {
  const perms = user.permissions;
  if (!perms || typeof perms !== "object") return undefined;
  const key = `${resource}:${action}`;
  const value = (perms as Record<string, unknown>)[key];
  if (typeof value === "boolean") return value;
  return undefined;
}

export function can(
  user: AccessUser,
  action: Action,
  resource: Resource
): boolean {
  const override = overrideFor(user, action, resource);
  if (override !== undefined) return override;
  return roleCan(user.role, action, resource);
}

export function requireCan(
  user: AccessUser,
  action: Action,
  resource: Resource
): void {
  if (!can(user, action, resource)) {
    throw new ForbiddenError(
      `${user.role} may not ${action} ${resource}.`
    );
  }
}

export function requireRole(user: AccessUser, ...roles: Role[]): void {
  if (!roles.includes(user.role)) {
    throw new ForbiddenError(`Requires one of: ${roles.join(", ")}.`);
  }
}
