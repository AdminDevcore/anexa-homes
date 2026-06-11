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
