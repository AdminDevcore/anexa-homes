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
    key: "company_signers",
    label: "Authorised signers",
    href: "/portal/settings/signers",
    // Blocking, unlike its neighbours, because this one does not fail quietly:
    // createSignaturePackage refuses the send outright rather than posting a
    // contract with an empty signature block. Somebody finds out by being
    // unable to send.
    hint: "A template here has fields for whoever signs on the company's behalf, but nobody is set up to sign them — those documents cannot be sent at all.",
    severity: "blocking",
    /**
     * Only a gap where it bites.
     *
     * A workspace whose templates are all customer-signed needs no authorised
     * signer, and warning it would be a warning nobody can ever clear — the
     * same reasoning as the commission-rules note above. So: no template needs
     * one, no gap (return 1); otherwise the answer is how many there are.
     *
     * The template count runs through the scoped client, so it answers for the
     * workspace being viewed. The signer count deliberately does not — signers
     * are company-wide, and one added from Roofing clears Solar's gap too.
     */
    count: async (companyId) => {
      const needing = await prisma.documentTemplate.count({
        where: { companyId, active: true, fields: { some: { signerRole: "company_rep" } } },
      });
      if (needing === 0) return 1;
      return prisma.companySigner.count({ where: { companyId, active: true } });
    },
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
  // RETIRED: "Backup load profiles" was a gap while a runtime came from a list
  // a company had to fill in — an empty list blocked every storage proposal and
  // said nothing until a rep hit it. Whole-home backup derives the runtime from
  // the deal's own usage against a factor that always has a value, so there is
  // no longer a company-level setting that can be silently absent. The per-deal
  // fact that CAN be missing is the home's usage, which readiness blocks on
  // where a rep can see and fix it — see `storage.no_usage`.
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
    /**
     * THE GUARD RAIL THAT IS OFF BY DEFAULT.
     *
     * `SolarSettings.minOffsetPct` ships at 0, and zero is not a minimum — it
     * is the absence of one. Validation says so on every deal, as a warning,
     * which is the right severity: a company that has not configured a guard
     * rail should be told, not stopped from quoting. But a warning on a deal is
     * seen by a rep who cannot change the setting, so it never reaches anybody
     * who can.
     *
     * DELIBERATELY NOT A BLOCK, and deliberately not defaulted to a business
     * value. Blocking generation would make a brand-new workspace unable to
     * quote anything until somebody guessed a number, and picking one here —
     * 80%, say — would be this file inventing a sizing policy on a company's
     * behalf and then enforcing it silently. What a system may be undersized to
     * is the company's call; the product's job is to make sure the question
     * gets asked of somebody who can answer it.
     */
    /**
     * KEYED TO THE CARD, not to the check. The Settings hub highlights a card
     * by matching its own key against the gap's, so a gap pointing at the Solar
     * Settings card has to be called what that card is called — see
     * `workspace-health.test.ts`, which pins the rule.
     */
    key: "solar_settings",
    label: "Minimum system offset",
    href: "/portal/settings/solar",
    hint: "No minimum offset is set, so nothing catches a system quoted far too small for the home. Reps see a warning they cannot act on.",
    severity: "silent",
    verticals: ["solar"],
    count: (companyId) =>
      prisma.solarSettings.count({ where: { companyId, minOffsetPct: { gt: 0 } } }),
  },
  {
    // The one check with no settings card behind it. Both rates are per rep, on
    // their own Team profile, so there is no screen in Settings to key this to —
    // a "Rep Pay" card was tried as a signpost and removed for pretending to be
    // one. `settings-overview.tsx` keeps a gap whose key names no card, which is
    // what stops this warning from vanishing along with it.
    key: "solar_pay",
    label: "Per-battery rep pay",
    href: "/portal/team",
    // The specific failure, because "no commission" and "a commission of zero"
    // are the two things this whole feature was careful to keep apart.
    hint: "No rep can be paid on a storage deal — no commission line is written at all, silently. Neither per-watt rate applies to a job with no watts.",
    severity: "silent",
    verticals: ["solar"],
    // EITHER rate clears it. Which of the two a given deal needs is the
    // lender's call (SolarLender.batteryPayMode), so a company running one
    // partner on flat battery pay is correctly set up with only flat rates set.
    count: (companyId) =>
      prisma.user.count({
        where: {
          companyId,
          OR: [
            { solarRedlinePerBatteryCents: { not: null } },
            { solarPerBatteryFlatCents: { not: null } },
          ],
        },
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
