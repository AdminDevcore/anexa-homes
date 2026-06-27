// RBAC matrix — single source of truth for role -> (resource, action) grants.
// Row-level scoping (e.g. "only your own leads") lives in policies.ts.

import type { Role } from "@prisma/client";

export const ROLES = [
  "super_admin",
  "admin",
  "manager",
  "sales_rep",
  "canvasser",
  "marketing",
  "installer",
  "accounting",
  "customer",
] as const;

export const RESOURCES = [
  "Company",
  "User",
  "Lead",
  "Pipeline",
  "Project",
  "Claim",
  "RoofMeasurement",
  "Crew",
  "Task",
  "Note",
  "File",
  "Document", // templates + packages + signing
  "Commission",
  "Payroll",
  "Invoice",
  "Report",
  "Settings",
  "Chat", // internal team chat (staff only)
  "Canvassing", // door-to-door knocking + territories
  "Bookkeeping", // lightweight ledger / P&L (accounting + owner only)
  "Knowledge", // training library / knowledge base (role-gated)
  "Scope", // scope-of-work job cost calculator (costs management-only)
  "Proposal", // customer-facing roofing presentation / proposal builder
  "Review", // public website customer reviews (moderation queue)
] as const;

export const ACTIONS = [
  "create",
  "read",
  "update",
  "delete",
  "assign",
  "approve",
  "sign",
  "export",
  "manage", // implies all of the above for that resource
] as const;

export type Resource = (typeof RESOURCES)[number];
export type Action = (typeof ACTIONS)[number];

export type Grant = Partial<Record<Resource, readonly Action[]>>;

const ALL: readonly Action[] = ["manage"];

// Staff who operate inside the company portal (everyone except customer).
export const STAFF_ROLES: Role[] = [
  "super_admin",
  "admin",
  "manager",
  "sales_rep",
  "canvasser",
  "marketing",
  "installer",
  "accounting",
];

export const ADMIN_ROLES: Role[] = ["super_admin", "admin"];

export function isStaff(role: Role): boolean {
  return STAFF_ROLES.includes(role);
}
export function isAdmin(role: Role): boolean {
  return ADMIN_ROLES.includes(role);
}

const GRANTS: Record<Role, Grant> = {
  super_admin: {
    Chat: ALL,
    Canvassing: ALL,
    Company: ALL,
    User: ALL,
    Lead: ALL,
    Pipeline: ALL,
    Project: ALL,
    Claim: ALL,
    RoofMeasurement: ALL,
    Crew: ALL,
    Task: ALL,
    Note: ALL,
    File: ALL,
    Document: ALL,
    Commission: ALL,
    Payroll: ALL,
    Invoice: ALL,
    Report: ALL,
    Settings: ALL,
    Bookkeeping: ALL,
    Knowledge: ALL,
    Scope: ALL,
    Proposal: ALL,
    Review: ALL,
  },

  admin: {
    Chat: ALL,
    Canvassing: ALL,
    Company: ["read", "update"],
    User: ["create", "read", "update", "assign"],
    Lead: ALL,
    Pipeline: ALL,
    Project: ALL,
    Claim: ALL,
    RoofMeasurement: ALL,
    Crew: ALL,
    Task: ALL,
    Note: ALL,
    File: ALL,
    Document: ALL,
    Commission: ["read", "approve", "update"],
    Payroll: ["read", "approve", "update", "export"],
    Invoice: ALL,
    Settings: ["read", "update"],
    Knowledge: ALL,
    Scope: ALL,
    Proposal: ALL,
    // Admins moderate reviews (approve/reject/feature/hide/edit) but cannot delete.
    Review: ["read", "update", "approve"],
  },

  manager: {
    Chat: ["create", "read"],
    Canvassing: ALL,
    // Sales managers can invite staff (create) but not edit roles (no update/assign).
    User: ["create", "read"],
    Lead: ["create", "read", "update", "assign"],
    Pipeline: ["read", "update"],
    Project: ["create", "read", "update", "assign"],
    Claim: ["create", "read", "update"],
    RoofMeasurement: ["create", "read", "update"],
    Crew: ["read", "assign"],
    Task: ["create", "read", "update", "assign"],
    Note: ["create", "read", "update"],
    File: ["create", "read", "update"],
    Document: ["create", "read", "update"],
    Commission: ["read"],
    Invoice: ["read"],
    Knowledge: ALL,
    Scope: ALL,
    Proposal: ALL,
  },

  sales_rep: {
    Chat: ["create", "read"],
    Canvassing: ["create", "read", "update"],
    Lead: ["create", "read", "update"],
    Pipeline: ["read"],
    Project: ["read"],
    Claim: ["create", "read", "update"],
    RoofMeasurement: ["create", "read", "update"],
    Task: ["create", "read", "update"],
    Note: ["create", "read"],
    File: ["create", "read"],
    Document: ["create", "read"],
    Commission: ["read"],
    Knowledge: ["read"],
    Scope: ["read", "update"],
    Proposal: ["create", "read", "update"],
  },

  // Door-to-door canvasser: books appointments (leads) and works ONLY their own deals.
  canvasser: {
    Chat: ["create", "read"],
    Canvassing: ["create", "read", "update"],
    Lead: ["create", "read", "update"],
    Pipeline: ["read"],
    Project: ["read"],
    Claim: ["create", "read"],
    RoofMeasurement: ["create", "read"],
    Task: ["create", "read", "update"],
    Note: ["create", "read"],
    File: ["create", "read"],
    Knowledge: ["read"],
    Scope: ["read"],
    Proposal: ["create", "read", "update"],
  },

  // External marketing company / lead provider: submits leads and sees ONLY the
  // deals they created.
  marketing: {
    Lead: ["create", "read"],
    Project: ["read"],
    Note: ["create", "read"],
    File: ["read"],
    Knowledge: ["read"],
    // The marketing team curates website reviews (but cannot delete them).
    Review: ["read", "update", "approve"],
  },

  installer: {
    Chat: ["create", "read"],
    Project: ["read"],
    Task: ["read", "update"],
    Note: ["create", "read"],
    File: ["create", "read"],
    Knowledge: ["read"],
  },

  accounting: {
    Chat: ["create", "read"],
    Project: ["read"],
    Commission: ["read", "approve", "update"],
    Payroll: ALL,
    Invoice: ["create", "read", "update"],
    Report: ["read", "export"],
    Bookkeeping: ALL,
    Knowledge: ["read"],
    Scope: ["read"],
    Proposal: ["read"],
  },

  customer: {},
};

export function roleCan(role: Role, action: Action, resource: Resource): boolean {
  const grant = GRANTS[role];
  if (!grant) return false;
  const actions = grant[resource];
  if (!actions) return false;
  if (actions.includes("manage")) return true;
  return actions.includes(action);
}

export function grantsForRole(role: Role): Grant {
  return GRANTS[role] ?? {};
}

/** Effective resource→actions grants for a role (ignores per-user overrides). */
export function roleGrants(role: Role): Grant {
  return GRANTS[role] ?? {};
}
