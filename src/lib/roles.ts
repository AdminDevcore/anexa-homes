import type { Role } from "@prisma/client";

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  manager: "Manager",
  sales_rep: "Sales Rep",
  canvasser: "Canvasser",
  marketing: "Marketing",
  installer: "Installer / Crew",
  accounting: "Payroll / Accounting",
  customer: "Customer",
};

// Roles a Super Admin / Admin can actually assign in the UI (retired ones excluded).
export const ASSIGNABLE_ROLES: Role[] = [
  "super_admin",
  "admin",
  "manager",
  "sales_rep",
  "canvasser",
  "marketing",
  "installer",
  "accounting",
];

export function roleLabel(role: Role): string {
  return ROLE_LABELS[role] ?? role;
}

// Privileged roles that ONLY a Super Admin may grant — whether inviting a new
// user or changing an existing member's role. Admins and sales managers can
// invite/manage staff, but can never create or promote anyone into these.
export const SUPER_ADMIN_ONLY_ROLES: Role[] = ["super_admin", "admin", "manager", "accounting"];

/** Can `actor` assign `target` — i.e. invite into it or change a user to it? */
export function canAssignRole(actor: Role, target: Role): boolean {
  if (actor === "super_admin") return true;
  return !SUPER_ADMIN_ONLY_ROLES.includes(target);
}

/** The roles `actor` may pick from in an invite/edit dropdown. */
export function assignableRolesFor(actor: Role): Role[] {
  return ASSIGNABLE_ROLES.filter((r) => canAssignRole(actor, r));
}
