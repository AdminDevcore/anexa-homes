import {
  KanbanSquare,
  SlidersHorizontal,
  FileSignature,
  DollarSign,
  Palette,
  ShieldCheck,
  Bell,
  Camera,
  ListChecks,
  Calculator,
  Megaphone,
  Star,
  CloudLightning,
  Sun,
  PanelsTopLeft,
  Landmark,
  Zap,
} from "lucide-react";
import type { ActiveVertical } from "./vertical";

/**
 * The Settings hub's cards, and which workspace each one belongs to.
 *
 * Two distinct kinds of per-vertical difference live here, and conflating them
 * is what made the hub wrong for Solar:
 *
 *   `verticals` — the card is about a concept the other vertical does not have.
 *                 An insurance-restoration line-item catalog has no meaning in
 *                 solar; a module/inverter list has none in roofing. Hidden.
 *
 *   `labels`    — the same underlying setting, different vocabulary. Both
 *                 workspaces photograph a job; solar shoots a site survey and
 *                 an install, roofing a roof. Same screen, renamed, because
 *                 hiding it would leave a live control uneditable.
 */

/**
 * The bands the hub is laid out in, in display order. A band with no visible
 * card in this workspace is skipped, which is how the solar-only and
 * roofing-only bands disappear without a second list to keep in sync.
 */
export const SETTINGS_GROUPS = [
  { key: "pipeline", label: "Sales pipeline", body: "How a lead moves and what reps record along the way." },
  { key: "field", label: "Field & production", body: "What crews capture on site and the checks a job passes." },
  { key: "solar", label: "Solar", body: "Design assumptions, hardware, and who finances the system." },
  { key: "insurance", label: "Insurance & scope", body: "Carrier claim tracking and the restoration line-item catalog." },
  { key: "money", label: "Documents & money", body: "What gets signed, and who gets paid on it." },
  { key: "company", label: "Company & access", body: "Brand, permissions, alerts, and your public reviews." },
] as const;

export type SettingsGroupKey = (typeof SETTINGS_GROUPS)[number]["key"];

export type SettingsSection = {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  href?: string;
  /** Which band of the hub this card sits in. */
  group: SettingsGroupKey;
  /** Extra words the hub's search box should match on, beyond title and body. */
  keywords?: string[];
  /** Workspaces this card appears in. Absent = every workspace. */
  verticals?: ActiveVertical[];
  /** Per-vertical wording for the same destination. */
  labels?: Partial<Record<ActiveVertical, { title: string; body: string }>>;
};

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    icon: KanbanSquare,
    title: "Pipeline Stages",
    body: "Customize the stages appointments move through.",
    href: "/portal/settings/pipeline",
    group: "pipeline",
    keywords: ["kanban", "board", "columns", "deal stages"],
  },
  {
    icon: ListChecks,
    title: "Appointment Outcomes",
    body: "Customize the outcomes reps record after appointments.",
    href: "/portal/settings/appointment-outcomes",
    group: "pipeline",
    keywords: ["disposition", "result", "no show"],
  },
  {
    icon: SlidersHorizontal,
    title: "Custom Fields",
    body: "Add custom fields to appointments and projects.",
    href: "/portal/settings/fields",
    group: "pipeline",
    keywords: ["attributes", "properties", "required"],
  },
  {
    icon: Megaphone,
    title: "Lead Sources",
    body: "Customize where leads come from (Door Knock, Referral, Ads…).",
    href: "/portal/settings/lead-sources",
    group: "pipeline",
    keywords: ["marketing", "channel", "attribution", "referral"],
  },
  {
    icon: FileSignature,
    title: "Document Templates",
    body: "Build and edit contract templates.",
    href: "/portal/documents",
    group: "money",
    keywords: ["contract", "agreement", "e-sign", "signature", "proposal"],
  },
  {
    icon: DollarSign,
    title: "Commission Rules",
    body: "Set percentage, flat, and override rules.",
    href: "/portal/settings/commissions",
    group: "money",
    keywords: ["payout", "split", "override", "pay"],
  },
  {
    icon: Bell,
    title: "Notification Rules",
    body: "Choose triggers, recipients, and channels.",
    href: "/portal/settings/notifications",
    group: "company",
    keywords: ["alerts", "email", "sms", "push", "reminders"],
  },
  {
    icon: CloudLightning,
    title: "Storm & Homeowner Data",
    body: "Storm search area + re-verify homeowner data across houses.",
    href: "/portal/settings/storm-coverage",
    group: "field",
    keywords: ["hail", "wind", "skip trace", "county records", "owner"],
    // The storm search area is roofing's; owner re-verify and county records are
    // ordinary canvassing tooling, so solar keeps the page minus that panel.
    labels: {
      solar: {
        title: "Homeowner Data",
        body: "Re-verify homeowner data across houses and import county records.",
      },
    },
  },
  {
    icon: Camera,
    title: "Photo Templates",
    body: "Site & install photo checklists for projects.",
    href: "/portal/settings/photo-templates",
    group: "field",
    keywords: ["pictures", "checklist", "survey", "install"],
    // Same setting, different vocabulary — and a different list of shots. The
    // checklists themselves are vertical-isolated rows, so each workspace edits
    // its own.
    labels: {
      solar: {
        title: "Photo Templates",
        body: "Site survey & installation photo checklists for solar jobs.",
      },
    },
  },
  {
    icon: ListChecks,
    title: "Inspection Outcomes",
    body: "Customize the outcomes recorded after an inspection.",
    href: "/portal/settings/inspection-outcomes",
    group: "field",
    keywords: ["result", "disposition"],
    // Roofing's. Solar was offered the same list as "Site Survey Outcomes"
    // while its deal page had a dropdown to spend it on; that step is gone —
    // solar's visit ends at the appointment status — so on solar this would now
    // configure a control nobody can reach.
    verticals: ["roofing"],
  },
  {
    icon: ListChecks,
    title: "Production Checklist",
    body: "The QC checklist applied to every new job.",
    href: "/portal/settings/production-checklist",
    group: "field",
    keywords: ["qc", "quality", "punch list", "build"],
  },
  {
    icon: ShieldCheck,
    title: "Claim Statuses",
    body: "Customize the insurance claim statuses on the deal Summary.",
    href: "/portal/settings/claim-statuses",
    group: "insurance",
    keywords: ["carrier", "adjuster", "supplement"],
    // A carrier claim is insurance restoration; solar has no adjuster to track.
    verticals: ["roofing"],
  },
  {
    icon: Calculator,
    title: "Scope of Work Catalog",
    body: "Master list of insurance-restoration line items (no pricing).",
    href: "/portal/settings/scope-template",
    group: "insurance",
    keywords: ["line items", "xactimate", "estimate", "trades"],
    verticals: ["roofing"],
  },
  {
    icon: Star,
    title: "Website Reviews",
    body: "Approve, feature, hide, or remove customer reviews from the website.",
    href: "/portal/settings/reviews",
    group: "company",
    keywords: ["testimonials", "ratings", "stars", "public site"],
  },
  {
    icon: ShieldCheck,
    title: "Roles & Permissions",
    body: "Control what each role can see and do.",
    href: "/portal/settings/roles",
    group: "company",
    keywords: ["rbac", "access", "admin", "security"],
  },
  {
    icon: Palette,
    title: "Branding",
    body: "Company logo and brand colors.",
    href: "/portal/settings/branding",
    group: "company",
    keywords: ["logo", "colors", "theme", "identity"],
  },
  {
    icon: Sun,
    title: "Solar Settings",
    body: "Production and pricing assumptions, validation bounds, and stage owners.",
    href: "/portal/settings/solar",
    group: "solar",
    keywords: ["kwh", "production", "pricing", "assumptions", "pvwatts"],
    verticals: ["solar"],
  },
  {
    icon: Landmark,
    title: "Lenders",
    body: "Financing partners, the equipment each approves, and the terms they finance on.",
    href: "/portal/settings/solar-lenders",
    group: "solar",
    keywords: ["financing", "loan", "dealer fee", "apr", "bank"],
    verticals: ["solar"],
  },
  {
    icon: Zap,
    title: "Energy providers",
    body: "The utilities and retail electric providers your reps pick from when working out a customer's usage.",
    href: "/portal/settings/solar-providers",
    group: "solar",
    keywords: ["utility", "rep", "rate", "bill", "electricity"],
    verticals: ["solar"],
  },
  {
    icon: PanelsTopLeft,
    title: "Solar Equipment",
    body: "Modules, inverters, batteries and rank-ordered adders.",
    href: "/portal/settings/solar-equipment",
    group: "solar",
    keywords: ["panels", "modules", "inverter", "battery", "adders"],
    verticals: ["solar"],
  },
];

export type ResolvedSettingsSection = {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  href?: string;
  group: SettingsGroupKey;
  keywords?: string[];
};

/** The cards this workspace shows, already resolved to its own vocabulary. */
export function visibleSettingsSections(vertical: ActiveVertical): ResolvedSettingsSection[] {
  return SETTINGS_SECTIONS.filter((s) => !s.verticals || s.verticals.includes(vertical)).map((s) => {
    const label = s.labels?.[vertical];
    return {
      icon: s.icon,
      title: label?.title ?? s.title,
      body: label?.body ?? s.body,
      href: s.href,
      group: s.group,
      keywords: s.keywords,
    };
  });
}

export type SettingsGroup = {
  key: SettingsGroupKey;
  label: string;
  body: string;
  sections: ResolvedSettingsSection[];
};

/**
 * The same cards, banded for the hub. Empty bands are dropped, so a workspace
 * never renders a heading with nothing under it.
 */
export function visibleSettingsGroups(vertical: ActiveVertical): SettingsGroup[] {
  const sections = visibleSettingsSections(vertical);
  return SETTINGS_GROUPS.map((g) => ({
    key: g.key,
    label: g.label,
    body: g.body,
    sections: sections.filter((s) => s.group === g.key),
  })).filter((g) => g.sections.length > 0);
}
