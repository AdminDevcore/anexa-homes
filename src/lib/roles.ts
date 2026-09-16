import type { Role } from "@prisma/client";

// Partial by design: `customer` is a retired enum value with no label, because
// there is nowhere in this product that a customer is a user. `roleLabel`
// falls back to the raw value, so a legacy row still renders something rather
// than blank. See LEGACY_ROLES in server/rbac/matrix.ts.
export const ROLE_LABELS: Partial<Record<Role, string>> = {
  super_admin: "Super Admin",
  admin: "Admin",
  manager: "Manager",
  sales_rep: "Sales Rep",
  canvasser: "Canvasser",
  marketing: "Marketing",
  installer: "Installer / Crew",
  accounting: "Payroll / Accounting",
  // Named for what they can do, not for who they are: this label is what an
  // admin reads in the invite dropdown before handing someone the books.
  accountant_readonly: "Accountant (read-only)",
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
  "accountant_readonly",
];

export function roleLabel(role: Role): string {
  return ROLE_LABELS[role] ?? role;
}

// Privileged roles that ONLY a Super Admin may grant — whether inviting a new
// user or changing an existing member's role. Admins and sales managers can
// invite/manage staff, but can never create or promote anyone into these.
export const SUPER_ADMIN_ONLY_ROLES: Role[] = [
  "super_admin",
  "admin",
  "manager",
  "accounting",
  // The outside CPA reads every figure the company has. Read-only is not a
  // reason to let a sales manager hand that out — who sees the books is an
  // owner's decision, the same as who runs payroll.
  "accountant_readonly",
];

/** Can `actor` assign `target` — i.e. invite into it or change a user to it? */
export function canAssignRole(actor: Role, target: Role): boolean {
  if (actor === "super_admin") return true;
  return !SUPER_ADMIN_ONLY_ROLES.includes(target);
}

/** The roles `actor` may pick from in an invite/edit dropdown. */
export function assignableRolesFor(actor: Role): Role[] {
  return ASSIGNABLE_ROLES.filter((r) => canAssignRole(actor, r));
}
