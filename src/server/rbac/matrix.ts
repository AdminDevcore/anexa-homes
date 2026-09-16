// RBAC matrix — single source of truth for role -> (resource, action) grants.
// Row-level scoping (e.g. "only your own leads") lives in policies.ts.

import type { Role } from "@prisma/client";

/**
 * Every role this product has. All of them are staff.
 *
 * `customer` is deliberately absent. It is still a value in the Postgres enum
 * so historical rows keep validating, but homeowners do not have accounts here:
 * there is no customer portal, no customer sign-in and no way to invite one.
 * Anything customer-facing (proposals, e-signature) reaches
 * them through a public token link, never a login. See LEGACY_ROLES.
 */
export const ROLES = [
  "super_admin",
  "admin",
  "manager",
  "sales_rep",
  "canvasser",
  "marketing",
  "installer",
  "accounting",
  // Listed here, and not only in GRANTS, because this list is what the ratchet
  // tests iterate. A role missing from it holds whatever it holds while
  // `export-grants.test.ts` passes vacuously — which is the opposite of what
  // that file is for.
  "accountant_readonly",
] as const;

/**
 * Enum values Postgres still accepts but the product has retired. Nothing may
 * be created in, promoted to, or displayed as one of these. `auth/config.ts`
 * refuses to authenticate them, which is what makes the absence enforceable
 * rather than merely cosmetic.
 */
export const LEGACY_ROLES: Role[] = ["customer"];

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
  // What a subcontractor billed for a job. Deliberately NOT covered by File:
  // an invoice is filed on a deal, and everyone who can open that deal can read
  // a file on it — including the rep whose commission it eats into. This is the
  // permission that decides who may open one. See src/lib/contractor-invoice.ts.
  "ContractorInvoice",
  "Report",
  "Settings",
  "Chat", // internal team chat (staff only)
  "Canvassing", // door-to-door knocking + territories
  "StormIntelligence", // NOAA/SPC storm data targeting (canvassing companion)
  "Bookkeeping", // lightweight ledger / P&L (accounting + owner only)
  "Knowledge", // training library / knowledge base (role-gated)
  "Scope", // scope-of-work job cost calculator (costs management-only)
  "Proposal", // customer-facing roofing presentation / proposal builder
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
  // The outside CPA is staff for the purpose of reaching the portal at all —
  // they log in, so `isStaff` must be true or nothing renders. What they may
  // actually DO is decided entirely by GRANTS below, which is read/export on
  // two resources and silence everywhere else.
  "accountant_readonly",
];

export const ADMIN_ROLES: Role[] = ["super_admin", "admin"];

/**
 * Roles that can be the rep on a deal AND therefore carry a pay structure.
 *
 * The commission engines read pay terms off exactly one person — the deal's
 * assigned rep (plus, on roofing, every active sales manager). Any role that can
 * be assigned a deal must be able to hold terms, or the deal reaches its gate
 * with nobody to pay and the engine writes no line at all: not an error, not a
 * $0 row, silence. That is what happened to an owner-sold solar deal at M1
 * Funding, whose $/W had no field on any page to live in.
 *
 * Not STAFF_ROLES: an installer or the bookkeeper can technically be picked in
 * the rep box, and putting a redline on them would be putting a redline on
 * somebody no engine reads.
 */
export const PAY_ELIGIBLE_ROLES: Role[] = ["super_admin", "admin", "manager", "sales_rep"];

/** Takes a plain string too: the team page carries the role as one. */
export function isPayEligible(role: Role | string): boolean {
  return (PAY_ELIGIBLE_ROLES as string[]).includes(role);
}

export function isStaff(role: Role): boolean {
  return STAFF_ROLES.includes(role);
}
export function isAdmin(role: Role): boolean {
  return ADMIN_ROLES.includes(role);
}

// Partial, not total: a retired role (see LEGACY_ROLES) has no entry at all,
// and `roleCan` reads a missing entry as "no grants" — deny by default.
const GRANTS: Partial<Record<Role, Grant>> = {
  super_admin: {
    Chat: ALL,
    Canvassing: ALL,
    StormIntelligence: ALL,
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
    ContractorInvoice: ALL,
    Report: ALL,
    Settings: ALL,
    Bookkeeping: ALL,
    Knowledge: ALL,
    Scope: ALL,
    Proposal: ALL,
  },

  admin: {
    Chat: ALL,
    Canvassing: ALL,
    StormIntelligence: ALL,
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
    // ContractorInvoice is deliberately absent, exactly as `Report` is. An
    // admin runs the sales floor; what a subcontractor charges is a funding
    // number, and the narrow list is the point of the drop box.
    Settings: ["read", "update"],
    Knowledge: ALL,
    Scope: ALL,
    Proposal: ALL,
  },

  manager: {
    Chat: ["create", "read"],
    Canvassing: ALL,
    StormIntelligence: ALL,
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
    StormIntelligence: ["read"],
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
    StormIntelligence: ["read"],
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
    // The funding desk pays these, so it opens them, prices them from the PDF
    // and approves them into payroll — the same verbs it already holds on
    // Commission. Delete is NOT among them, and is super-admin-only: a
    // submitted invoice is the contractor's evidence that he billed, and the
    // person who pays it should not be able to make it disappear. Voiding a
    // pay line is the honest way to decline one, and that is `approve`.
    ContractorInvoice: ["read", "export", "update", "approve"],
    Report: ["read", "export"],
    Bookkeeping: ALL,
    Knowledge: ["read"],
    Scope: ["read"],
    Proposal: ["read"],
  },

  /**
   * THE OUTSIDE CPA. ONE resource, two verbs, and nothing else.
   *
   * Everything an accountant actually needs — P&L, balance sheet, trial
   * balance, general ledger, 1099 totals, reconciliation history — is a
   * BOOKKEEPING artifact, and lives under `Bookkeeping`.
   *
   * `Report` WAS granted here and has been deliberately taken away. It reads
   * like the financial-reports permission and is not: it is the gate on the
   * reports hub, which is mostly the sales floor — Funnel, Lead Sources,
   * Canvassing, Rep Scorecard, Delinquency, Claims, A/R Aging, Production.
   * Granting it handed an outside party customer names, addresses and per-rep
   * performance, which is the very thing refusing `Project: ["read"]` was meant
   * to prevent. It also does not stop at the hub: each of those pages gates
   * itself on `can(user, "read", "Report")` independently, so hiding the cards
   * would still have left every URL openable — ten pages and twenty export/PDF
   * routes. Withholding the resource denies all of them at once, including the
   * ones nobody has written yet. `cpa-report-visibility.test.ts` pins it.
   *
   * `Project: ["read"]` was considered and deliberately refused: it would hand
   * an outside party the entire deal pipeline, with customer names and
   * addresses, to answer questions the statements already answer. Every extra
   * resource here is a real widening of what leaves the building.
   *
   * `create` IS DELIBERATELY ABSENT, and not only because this role is
   * read-only. `row-scope-boundary.test.ts` allows
   * `books/actions.ts#postManualEntryAction` to take a projectId without a
   * per-viewer scope check, on the stated grounds that everyone holding
   * `Bookkeeping:create` sees every job in the company. Granting create here
   * would silently make that entry false.
   */
  accountant_readonly: {
    Bookkeeping: ["read", "export"],
  },
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
