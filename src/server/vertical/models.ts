/**
 * The registry that decides, for every Prisma model, how the vertical-isolation
 * extension treats it. This file is the single place the isolation boundary is
 * defined — if a model is not listed here it is shared, on purpose.
 *
 * Three classes:
 *
 *  SCOPED  — reads are filtered to the active vertical and writes are stamped
 *            with it. Cross-vertical access is a hard error. This is the
 *            isolation guarantee: deals, pipelines, config, templates, catalogs.
 *
 *  SCOPED_OPTIONAL
 *          — same as SCOPED, except a NULL vertical means "company-level" and
 *            stays visible from every workspace. Reads match the active vertical
 *            OR NULL; writes stamp the active vertical only when the caller did
 *            not say otherwise, so a caller can deliberately create a
 *            company-scoped row by passing `vertical: null`. This is what lets a
 *            task be "Company" instead of "Roofing" without leaving isolation.
 *
 *  TAGGED  — writes are stamped with the active vertical, reads are NOT
 *            filtered. One company, one general ledger: every transaction and
 *            commission carries its vertical so the P&L breaks out by
 *            department and still rolls up to a consolidated total. The column
 *            is nullable because genuinely company-level rows (office rent) do
 *            not belong to a vertical.
 *
 *            ActivityLog is here for a different reason with the same shape: it
 *            has ~18 write sites and will grow, so stamping belongs in one place
 *            rather than in every caller. Its reads are filtered by PERMISSION
 *            (see server/vertical/visibility.ts), not by the active workspace —
 *            an auditor granted both workspaces should not have to toggle to
 *            reconstruct what happened.
 *
 *  SHARED  — untouched. One legal entity: one employee roster, one login per
 *            person, one chat, one payroll run, one set of website reviews.
 *
 * Child tables are absent by design: they carry no companyId and are always
 * reached through a scoped parent (PipelineStage via Pipeline, ClaimLineItem
 * via Claim, PayrollItem via PayrollRun, FileAsset/Note via Lead or Project).
 * Scoping the parent scopes them.
 */

/** Reads filtered + writes stamped. Cross-vertical access throws. */
export const SCOPED_MODELS = [
  // Deals and production
  "Lead",
  "Project",
  "Claim",
  // Pipeline + workflow config
  "Pipeline",
  // Per-vertical configuration
  "LeadSource",
  "CustomFieldDef",
  "PhotoTemplate",
  "CommissionRule",
  "NotificationRule",
  "DocumentTemplate",
  "KnowledgeCategory",
  // Product / scope catalog
  "ScopeOfWork",
  "Estimate",
  "ScopeTemplateItem",
  "ScopeCatalogItem",
  "ScopeCostTemplate",
  "ScopeSupplementTemplate",
  // Customer-facing artifacts
  "Proposal",
  "DocumentPackage",
  // Field operations
  "Territory",
  "Knock",
  // Solar domain. Inherently solar, but registered anyway so the guarantee is
  // uniform: a roofing session cannot read or write them even by mistake.
  "SolarEquipment",
  "SolarDesign",
  "SolarFinance",
  "SolarMilestone",
  "CreditApplication",
] as const;

/**
 * Reads match the active vertical OR NULL; writes stamp only when the caller did
 * not supply a vertical. NULL means company-level and is visible everywhere.
 */
export const SCOPED_OPTIONAL_MODELS = ["Task"] as const;

/** Writes stamped, reads never filtered — consolidated books, segmented reporting. */
export const TAGGED_MODELS = [
  "Transaction",
  "Commission",
  // Money owed to the crew, tagged for the same reason money owed to the rep
  // is: the departmental P&L must be able to tell a solar install's labour from
  // a roofing one, while the consolidated books stay whole.
  "ContractorPay",
  "Invoice",
  "ProjectCost",
  // Deliberately NOT given a TAGGED_PROVENANCE entry: activity rows are written
  // on nearly every action, so a per-write lookup of the parent job would be a
  // real cost for no gain. Every call site already runs inside the action that
  // resolved the workspace, so the ambient value is the provenance.
  "ActivityLog",
] as const;

export type ScopedModel = (typeof SCOPED_MODELS)[number];
export type ScopedOptionalModel = (typeof SCOPED_OPTIONAL_MODELS)[number];
export type TaggedModel = (typeof TAGGED_MODELS)[number];

const SCOPED = new Set<string>(SCOPED_MODELS);
const SCOPED_OPTIONAL = new Set<string>(SCOPED_OPTIONAL_MODELS);
const TAGGED = new Set<string>(TAGGED_MODELS);

export type ModelClass = "scoped" | "scopedOptional" | "tagged" | "shared";

export function classify(model: string | undefined): ModelClass {
  if (!model) return "shared";
  if (SCOPED.has(model)) return "scoped";
  if (SCOPED_OPTIONAL.has(model)) return "scopedOptional";
  if (TAGGED.has(model)) return "tagged";
  return "shared";
}

/** True for both isolation classes — anything whose reads are vertical-filtered. */
export function isScoped(model: string | undefined): boolean {
  const cls = classify(model);
  return cls === "scoped" || cls === "scopedOptional";
}
