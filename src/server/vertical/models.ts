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
 *  TAGGED  — writes are stamped with the active vertical, reads are NOT
 *            filtered. One company, one general ledger: every transaction and
 *            commission carries its vertical so the P&L breaks out by
 *            department and still rolls up to a consolidated total. The column
 *            is nullable because genuinely company-level rows (office rent) do
 *            not belong to a vertical.
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
  "Task",
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
  "ScopeTemplateItem",
  "ScopeCatalogItem",
  "ScopeCostTemplate",
  "ScopeSupplementTemplate",
  // Customer-facing artifacts
  "Proposal",
  "CashBid",
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

/** Writes stamped, reads never filtered — consolidated books, segmented reporting. */
export const TAGGED_MODELS = [
  "Transaction",
  "Commission",
  "Invoice",
  "ProjectCost",
] as const;

export type ScopedModel = (typeof SCOPED_MODELS)[number];
export type TaggedModel = (typeof TAGGED_MODELS)[number];

const SCOPED = new Set<string>(SCOPED_MODELS);
const TAGGED = new Set<string>(TAGGED_MODELS);

export type ModelClass = "scoped" | "tagged" | "shared";

export function classify(model: string | undefined): ModelClass {
  if (!model) return "shared";
  if (SCOPED.has(model)) return "scoped";
  if (TAGGED.has(model)) return "tagged";
  return "shared";
}

export function isScoped(model: string | undefined): boolean {
  return classify(model) === "scoped";
}
