import { prisma } from "@/server/db/client";
import type { ActiveVertical } from "@/lib/vertical";
import { parseDispositions, DEFAULT_SOLAR_APPOINTMENT_DISPOSITIONS } from "@/lib/dispositions";
import {
  parseLabelList,
  DEFAULT_INSPECTION_OUTCOMES,
  DEFAULT_QC_CHECKLIST,
  DEFAULT_SOLAR_INSPECTION_OUTCOMES,
  DEFAULT_SOLAR_QC_CHECKLIST,
} from "@/lib/job-settings";
import { parseClaimStatuses } from "@/lib/claim-status";
import { readVerticalConfig } from "@/lib/vertical-config";
import { applyVerticalOverrides } from "@/lib/vertical-settings";
import type { SettingsSectionKey } from "@/lib/settings-sections";

/**
 * "What is actually in each of these settings right now?"
 *
 * The hub used to be a menu: twenty doors, no idea what was behind any of them,
 * so finding out whether lead sources had ever been filled in meant opening the
 * page. Every card now carries its own count, which turns the same grid into a
 * status board — and makes the empty ones impossible to miss without a separate
 * panel restating them.
 *
 * Everything here reads through the scoped client, so the numbers answer for the
 * workspace the viewer has open. One deliberate exception is labelled as such
 * in the UI: the role matrix is company-wide (one roster), which is exactly how
 * it is registered in server/vertical/models.ts.
 *
 * Counts are totals, not active-only, matching workspaceSetupGaps — a card that
 * says "3 rules" next to a gap warning saying there are none would be worse than
 * either alone.
 */

export type StatusTone = "neutral" | "attention";

export type SectionStatus = {
  /** Short, human: "12 sources", "Using defaults", "3 awaiting approval". */
  label: string;
  /** Absent = ordinary. "attention" is amber: something is waiting on someone. */
  tone?: StatusTone;
  /** Set when this count is company-wide rather than this workspace's. */
  companyWide?: boolean;
};

export type SettingsInventory = Partial<Record<SettingsSectionKey, SectionStatus>>;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * A row count for a card footer. Zero reads as "None yet" rather than "0
 * providers" — the number nobody wants is the one the sentence is built around,
 * and an empty list is a state, not a quantity.
 */
const countLabel = (n: number, one: string, many?: string): SectionStatus =>
  n === 0 ? { label: "None yet" } : { label: plural(n, one, many) };

/**
 * A count of rows this workspace owns. Zero is left to the caller: a zero that
 * `workspaceSetupGaps` already knows about becomes "Not set up" in amber, and a
 * zero it does not is an ordinary empty list.
 */
export async function settingsInventory(
  companyId: string,
  vertical: ActiveVertical
): Promise<SettingsInventory> {
  const solar = vertical === "solar";
  const roofing = vertical === "roofing";

  const [
    pipelines,
    customFields,
    leadSources,
    documentTemplates,
    companySigners,
    commissionRules,
    notificationRules,
    automationRules,
    photoTemplates,
    scopeItems,
    solarEquipment,
    solarLenders,
    solarProviders,
    solarSettings,
    settings,
  ] = await Promise.all([
    // Stages hang off the pipeline, so they are counted through it — the parent
    // query is what carries the vertical filter (a nested `_count` on Company
    // would not be filtered at all).
    prisma.pipeline.findMany({
      where: { companyId },
      select: { _count: { select: { stages: true } } },
    }),
    prisma.customFieldDef.count({ where: { companyId } }),
    prisma.leadSource.count({ where: { companyId } }),
    prisma.documentTemplate.count({ where: { companyId } }),
    // Company-wide, like the role matrix below: a signer is a person, not a
    // workspace setting, so this number is the same in both workspaces.
    prisma.companySigner.count({ where: { companyId, active: true } }),
    prisma.commissionRule.count({ where: { companyId } }),
    prisma.notificationRule.count({ where: { companyId } }),
    prisma.automationRule.count({ where: { companyId } }),
    prisma.photoTemplate.count({ where: { companyId } }),
    roofing ? prisma.scopeTemplateItem.count({ where: { companyId } }) : Promise.resolve(0),
    solar ? prisma.solarEquipment.count({ where: { companyId } }) : Promise.resolve(0),
    solar ? prisma.solarLender.count({ where: { companyId } }) : Promise.resolve(0),
    solar ? prisma.solarProvider.count({ where: { companyId } }) : Promise.resolve(0),
    solar
      ? prisma.solarSettings.findUnique({ where: { companyId }, select: { id: true } })
      : Promise.resolve(null),
    prisma.companySettings.findUnique({
      where: { companyId },
      select: {
        logoUrl: true,
        rolePermissions: true,
        appointmentDispositions: true,
        inspectionOutcomes: true,
        qcChecklistTemplate: true,
        claimStatuses: true,
        stormRadiusMiles: true,
        verticalOverrides: true,
      },
    }),
  ]);

  const stages = pipelines.reduce((n, p) => n + p._count.stages, 0);

  // The JSON lists all fall back to a code default when this workspace has never
  // saved its own, and "10 outcomes" reads identically either way — so the ones
  // that are still the shipped list say so. That is the difference between a
  // list somebody chose and one nobody has looked at.
  const stored = <T>(raw: unknown, parse: (v: unknown) => T[]): { items: T[]; custom: boolean } => {
    const forVertical = readVerticalConfig(raw, vertical);
    const custom = Array.isArray(forVertical) && forVertical.length > 0;
    return { items: parse(forVertical), custom };
  };

  const dispositions = stored(settings?.appointmentDispositions, (v) =>
    parseDispositions(v, solar ? DEFAULT_SOLAR_APPOINTMENT_DISPOSITIONS : undefined)
  );
  const inspection = stored(settings?.inspectionOutcomes, (v) =>
    parseLabelList(v, solar ? DEFAULT_SOLAR_INSPECTION_OUTCOMES : DEFAULT_INSPECTION_OUTCOMES)
  );
  const checklist = stored(settings?.qcChecklistTemplate, (v) =>
    parseLabelList(v, solar ? DEFAULT_SOLAR_QC_CHECKLIST : DEFAULT_QC_CHECKLIST)
  );
  const claimStatuses = stored(settings?.claimStatuses, (v) => parseClaimStatuses(v));

  const listLabel = (
    { items, custom }: { items: unknown[]; custom: boolean },
    noun: string,
    many?: string
  ) => {
    const n = plural(items.length, noun, many);
    return custom ? n : `${n} · default`;
  };

  // Branding is per-vertical by override, so Solar reports Solar's logo.
  const branding = applyVerticalOverrides(settings, vertical);
  const customRoles = Object.keys(
    (settings?.rolePermissions as Record<string, unknown> | null) ?? {}
  ).length;

  const inventory: SettingsInventory = {
    pipeline:
      stages > 0
        ? { label: `${plural(pipelines.length, "pipeline")} · ${plural(stages, "stage")}` }
        : { label: "No stages", tone: "attention" },
    appointment_outcomes: { label: listLabel(dispositions, "outcome") },
    custom_fields: countLabel(customFields, "field"),
    lead_sources: countLabel(leadSources, "source"),
    document_templates: countLabel(documentTemplates, "template"),
    company_signers: { ...countLabel(companySigners, "signer"), companyWide: true },
    commission_rules: countLabel(commissionRules, "rule"),
    notification_rules: countLabel(notificationRules, "rule"),
    automations: countLabel(automationRules, "automation"),
    photo_templates: countLabel(photoTemplates, "checklist"),
    inspection_outcomes: { label: listLabel(inspection, "outcome") },
    production_checklist: { label: listLabel(checklist, "step") },
    roles: {
      label: customRoles > 0 ? `${plural(customRoles, "role")} customized` : "Standard permissions",
      companyWide: true,
    },
    branding: { label: branding?.logoUrl ? "Logo set" : "No logo yet" },
  };

  if (roofing) {
    inventory.claim_statuses = { label: listLabel(claimStatuses, "status", "statuses") };
    inventory.scope_template = countLabel(scopeItems, "line item");
    inventory.storm_homeowner = {
      label: settings?.stormRadiusMiles
        ? `${settings.stormRadiusMiles} mi search area`
        : "Default search area",
    };
  }

  if (solar) {
    inventory.solar_settings = {
      label: solarSettings ? "Assumptions saved" : "Using defaults",
    };
    inventory.solar_equipment = countLabel(solarEquipment, "item");
    inventory.solar_lenders = countLabel(solarLenders, "lender");
    inventory.solar_providers = countLabel(solarProviders, "provider");
  }

  return inventory;
}
