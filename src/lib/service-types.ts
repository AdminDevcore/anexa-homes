import type { ServiceType } from "@prisma/client";

// Full label map — covers EVERY ServiceType for display, including products the
// portal no longer offers as options (e.g. windows leads that come in from the
// marketing site, or legacy storm/hvac deals) so existing data still renders.
const ALL_SERVICE_LABELS: Record<ServiceType, string> = {
  roofing: "Roofing",
  storm_restoration: "Storm Restoration",
  solar: "Solar",
  hvac: "HVAC",
  water_filtration: "Water Filtration",
  windows: "Windows",
  other: "Other",
};

// The three operational products the PORTAL offers when creating/editing a deal.
// (The marketing site lists a fourth — Windows — but the portal works these three.)
export const PORTAL_SERVICE_TYPES: { value: ServiceType; label: string }[] = [
  { value: "roofing", label: ALL_SERVICE_LABELS.roofing },
  { value: "solar", label: ALL_SERVICE_LABELS.solar },
  { value: "water_filtration", label: ALL_SERVICE_LABELS.water_filtration },
];

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
    case "water-filtration":
      return "water_filtration";
    case "windows":
      return "windows";
    default:
      return "other";
  }
}
