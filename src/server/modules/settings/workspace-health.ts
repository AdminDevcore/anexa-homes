import { prisma } from "@/server/db/client";
import type { ActiveVertical } from "@/lib/vertical";

/**
 * "What has this workspace never been configured with?"
 *
 * Per-vertical config is vertical-isolated, so standing up a second workspace
 * does NOT inherit the first one's setup: Roofing's 15 notification rules, its
 * lead sources and its photo checklists are invisible from Solar, and a table
 * with no rows for the active vertical is indistinguishable from a feature
 * nobody uses. Every one of these fails the same quiet way — a `findMany`
 * returns nothing, a loop body never runs, and no error is raised.
 *
 * That is the bug class behind the blank Photo Templates page: not the missing
 * create button, but the fact that "empty here, full over there" never
 * announced itself. This makes it announce itself.
 *
 * Every count runs through the scoped client with no `vertical` filter of its
 * own, so it answers for whichever workspace the viewer has open — the same
 * isolation that caused the problem is what measures it.
 */

/**
 * blocking — the workspace cannot do its job until this is set up.
 * silent   — the feature exists but does nothing, with no error to notice.
 */
export type GapSeverity = "blocking" | "silent";

export type SetupGap = {
  key: string;
  label: string;
  href: string;
  /** What actually goes wrong today, in the user's terms — not "no rows found". */
  hint: string;
  severity: GapSeverity;
};

type Check = Omit<SetupGap, "key"> & {
  key: string;
  /** Absent = every workspace. */
  verticals?: ActiveVertical[];
  count: (companyId: string) => Promise<number>;
};

export const SETUP_CHECKS: Check[] = [
  {
    key: "pipeline",
    label: "Pipeline stages",
    href: "/portal/settings/pipeline",
    hint: "Deals in this workspace have no stages to move through.",
    severity: "blocking",
    count: (companyId) => prisma.pipeline.count({ where: { companyId } }),
  },
  {
    key: "solar_equipment",
    label: "Solar equipment",
    href: "/portal/settings/solar-equipment",
    hint: "The layout designer has no modules or inverters to place, so a system cannot be sized.",
    severity: "blocking",
    verticals: ["solar"],
    count: (companyId) => prisma.solarEquipment.count({ where: { companyId } }),
  },
  {
    key: "photo_templates",
    label: "Photo checklists",
    href: "/portal/settings/photo-templates",
    hint: "Crews get a bare uploader instead of a checklist, and no photo is ever marked required.",
    severity: "silent",
    count: (companyId) => prisma.photoTemplate.count({ where: { companyId } }),
  },
  {
    key: "notification_rules",
    label: "Notification rules",
    href: "/portal/settings/notifications",
    hint: "No alert of any kind fires in this workspace — nobody is told when anything changes.",
    severity: "silent",
    count: (companyId) => prisma.notificationRule.count({ where: { companyId } }),
  },
  {
    key: "document_templates",
    label: "Document templates",
    href: "/portal/documents",
    hint: "There is nothing to send for signature on a deal in this workspace.",
    severity: "silent",
    count: (companyId) => prisma.documentTemplate.count({ where: { companyId } }),
  },
  {
    key: "lead_sources",
    label: "Lead sources",
    href: "/portal/settings/lead-sources",
    hint: "The lead source dropdown is empty, so where deals come from goes unrecorded.",
    severity: "silent",
    count: (companyId) => prisma.leadSource.count({ where: { companyId } }),
  },
  {
    key: "commission_rules",
    label: "Commission rules",
    href: "/portal/settings/commissions",
    // Worth stating precisely: the rules drive ONLY the crew/PM lines in
    // payroll/engine.ts. A rep's own split comes from their profile, so payroll
    // looks like it is working while installers quietly earn nothing.
    hint: "Installer and project-manager commissions never generate. Rep commissions are unaffected — those come from each rep's own terms.",
    severity: "silent",
    // Roofing's, like the settings card it links to. Solar has no rule-paid
    // crew or PM line, so "no commission rules" is that workspace's normal
    // state — reporting it as a gap would be a warning nobody can ever clear.
    verticals: ["roofing"],
    count: (companyId) => prisma.commissionRule.count({ where: { companyId } }),
  },
  /**
   * Storage-only deals.
   *
   * Every one of these fails the way this module exists to catch: a `findMany`
   * comes back empty, a price prices at nothing, a commission line is never
   * written — and none of them raises an error. A company can ship the feature
   * and discover months later that no rep ever managed to quote a battery.
   *
   * They are NOT `blocking`: a workspace that only sells panels is correctly
   * configured with none of this, and a warning nobody can ever clear is a
   * warning everybody learns to ignore. See the commission-rules note above.
   */
  {
    // KEYED TO ITS CARD, not to what it counts. The hub finds a gap's card by
    // key and drops any gap whose key names no card, so all three of these
    // shipped invisible: named `solar_backup_profiles`, `solar_storage_lenders`
    // and `solar_storage_redline`, they were filtered out of the grid AND out
    // of the "N settings have never been set up" count — a warning about silent
    // failure, failing silently. The key is the card; the label says what it is.
    key: "solar_storage",
    label: "Backup load profiles",
    href: "/portal/settings/solar-storage",
    hint: "A storage proposal cannot say how long the battery lasts, so readiness blocks it from generating at all.",
    severity: "silent",
    verticals: ["solar"],
    count: (companyId) =>
      prisma.solarBackupProfile.count({ where: { companyId, isActive: true } }),
  },
  {
    key: "solar_lenders",
    label: "Lenders that fund storage",
    href: "/portal/settings/solar-lenders",
    hint: "No loan product is marked as funding a battery with no array, so a storage-only deal is offered no financing at all.",
    severity: "silent",
    verticals: ["solar"],
    count: (companyId) =>
      prisma.solarLenderProduct.count({
        where: { companyId, product: "loan", isActive: true, financesStorageOnly: true },
      }),
  },
  {
    key: "solar_pay",
    label: "Per-battery rep redline",
    // Team, not a settings page: the redline is per rep, on their own profile.
    // The Rep Pay card is the signpost to it — see settings-sections.ts.
    href: "/portal/team",
    // The specific failure, because "no commission" and "a commission of zero"
    // are the two things this whole feature was careful to keep apart.
    hint: "No rep can be paid on a storage deal — no commission line is written at all, silently. Their per-watt redline does not apply to a job with no watts.",
    severity: "silent",
    verticals: ["solar"],
    count: (companyId) =>
      prisma.user.count({
        where: { companyId, solarRedlinePerBatteryCents: { not: null } },
      }),
  },
  {
    key: "scope_template",
    label: "Scope of work catalog",
    href: "/portal/settings/scope-template",
    hint: "Estimates have no line items to build from.",
    severity: "silent",
    verticals: ["roofing"],
    count: (companyId) => prisma.scopeTemplateItem.count({ where: { companyId } }),
  },
];

/** The checks that apply to a workspace. */
export function checksFor(vertical: ActiveVertical): Check[] {
  return SETUP_CHECKS.filter((c) => !c.verticals || c.verticals.includes(vertical));
}

/**
 * Everything this workspace has none of. Empty array = nothing to report, which
 * is the state the panel should be in almost all the time.
 */
export async function workspaceSetupGaps(
  companyId: string,
  vertical: ActiveVertical
): Promise<SetupGap[]> {
  const checks = checksFor(vertical);
  const counts = await Promise.all(checks.map((c) => c.count(companyId)));
  return checks
    .filter((_, i) => counts[i] === 0)
    .map(({ key, label, href, hint, severity }) => ({ key, label, href, hint, severity }));
}
