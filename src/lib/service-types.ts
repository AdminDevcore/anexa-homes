import type { ServiceType } from "@prisma/client";

// Full label map — covers EVERY ServiceType for display, including RETIRED
// products we no longer sell (storm_restoration) so historical deals still
// render with their real name instead of a raw enum value. Never delete an
// entry here; retire it below instead.
const ALL_SERVICE_LABELS: Record<ServiceType, string> = {
  roofing: "Roofing",
  storm_restoration: "Storm Restoration",
  solar: "Solar",
  hvac: "HVAC",
  water_filtration: "Water Filtration",
  windows: "Windows",
  other: "Other",
};

// Products we no longer sell. They stay in the enum and in the label map for
// existing records, but must not be offered as a NEW choice anywhere.
// storm_restoration was retired 2026-07-27 when solar took its place on the
// marketing site.
const RETIRED_SERVICE_TYPES: ServiceType[] = ["storm_restoration"];

/** Service types a user may pick today — everything except retired products. */
export const SELECTABLE_SERVICE_TYPES: { value: ServiceType; label: string }[] = (
  Object.keys(ALL_SERVICE_LABELS) as ServiceType[]
)
  .filter((v) => !RETIRED_SERVICE_TYPES.includes(v))
  .map((value) => ({ value, label: ALL_SERVICE_LABELS[value] }));

/**
 * Options for an edit form, given the record's CURRENT value. A record still
 * holding a retired product keeps it as a visible option — otherwise the
 * `<select>` falls back to its first option and silently reassigns the record
 * on save.
 */
export function serviceTypeOptions(current: ServiceType | string | null | undefined) {
  const opts = [...SELECTABLE_SERVICE_TYPES];
  if (current && !opts.some((o) => o.value === current)) {
    opts.unshift({ value: current as ServiceType, label: serviceTypeLabel(current as ServiceType) });
  }
  return opts;
}

export function serviceTypeLabel(value: ServiceType): string {
  return ALL_SERVICE_LABELS[value] ?? value;
}

/** Maps a marketing service slug (e.g. "water-filtration") to a ServiceType. */
export function serviceTypeFromSlug(slug: string | null | undefined): ServiceType {
  switch (slug) {
    case "roofing":
      return "roofing";
    case "solar":
      return "solar";
    case "hvac":
      return "hvac";
    case "water-filtration":
      return "water_filtration";
    case "windows":
      return "windows";
    // Retired page — still mapped so any stale bookmark/referrer that reaches
    // intake lands on the right historical type rather than "other".
    case "storm-restoration":
      return "storm_restoration";
    // Gutters and insurance-claim leads have no dedicated ServiceType column;
    // captured as "other" with the interest noted on the lead.
    case "gutters":
    case "insurance-claims":
    default:
      return "other";
  }
}
