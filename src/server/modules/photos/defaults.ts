import type { PhotoTemplateKind } from "@prisma/client";
import type { ActiveVertical } from "@/lib/vertical";

/**
 * The two photo checklists every job has, and the starter slots each one gets.
 *
 * PhotoTemplate rows are vertical-isolated, so the pair seeded for roofing in
 * 2026 is invisible from the Solar workspace — solar had to be able to build its
 * own, and the shots a solar site survey needs (panel, meter, attic, shading)
 * have nothing to do with hail hits and ridge caps. Hence one default list per
 * kind PER vertical rather than one shared list.
 *
 * These are only a starting point: the admin edits, adds and removes slots in
 * Settings → Photo Templates afterwards. Nothing reads this file at runtime
 * except the "start from the standard list" button.
 */

export type DefaultItem = { label: string; required: boolean };

export const KIND_LABEL: Record<PhotoTemplateKind, Record<ActiveVertical, string>> = {
  site: { roofing: "Site / Inspection Photos", solar: "Site Survey Photos" },
  install: { roofing: "Install Photos", solar: "Installation Photos" },
};

export const KIND_BLURB: Record<PhotoTemplateKind, Record<ActiveVertical, string>> = {
  site: {
    roofing: "What the rep captures at the inspection, before anything is sold.",
    solar: "What the surveyor captures at the site survey, before design is finalised.",
  },
  install: {
    roofing: "What the crew captures on install day, from tear-off to final sweep.",
    solar: "What the crew captures on install day, from mounting to final commissioning.",
  },
};

const ROOFING_SITE: DefaultItem[] = [
  { label: "Front of house", required: true },
  { label: "Address / house number", required: false },
  { label: "Full roof — each slope", required: true },
  { label: "Roof damage — close-up", required: true },
  { label: "Hail hits / test square", required: false },
  { label: "Gutters & downspouts", required: false },
  { label: "Soft metals (vents, flashing)", required: false },
  { label: "Collateral damage (fence, AC, screens)", required: false },
  { label: "Interior damage (if any)", required: false },
];

const ROOFING_INSTALL: DefaultItem[] = [
  { label: "Before — full roof", required: true },
  { label: "Tear-off in progress", required: true },
  { label: "Decking / wood replacement", required: false },
  { label: "Underlayment / ice & water", required: true },
  { label: "Flashing & valleys", required: false },
  { label: "Ridge vent", required: false },
  { label: "Final — full roof", required: true },
  { label: "Cleanup / magnet sweep", required: false },
  { label: "Yard sign placed", required: false },
];

const SOLAR_SITE: DefaultItem[] = [
  { label: "Front of house", required: true },
  { label: "Address / house number", required: false },
  { label: "Full roof — each plane", required: true },
  { label: "Roof surface condition — close-up", required: true },
  { label: "Roof penetrations & obstructions", required: false },
  { label: "Attic — rafter / truss spacing", required: true },
  { label: "Main service panel — door open, full view", required: true },
  { label: "Main breaker & panel label — close-up", required: true },
  { label: "Utility meter & meter number", required: true },
  { label: "Proposed inverter / equipment location", required: true },
  { label: "Conduit run path", required: false },
  { label: "Shading obstructions (trees, chimney, vents)", required: false },
];

const SOLAR_INSTALL: DefaultItem[] = [
  { label: "Before — full roof", required: true },
  { label: "Mounts & flashing installed", required: true },
  { label: "Racking rails installed", required: false },
  { label: "Modules installed — full array", required: true },
  { label: "Module serial numbers / scan sheet", required: true },
  { label: "Inverter(s) installed", required: true },
  { label: "Conduit run — exterior", required: true },
  { label: "Rapid shutdown device & labels", required: true },
  { label: "Panel interconnection / backfed breaker", required: true },
  { label: "Meter & disconnect labels", required: false },
  { label: "Final — full array", required: true },
  { label: "Site cleanup", required: false },
];

const DEFAULTS: Record<ActiveVertical, Record<PhotoTemplateKind, DefaultItem[]>> = {
  roofing: { site: ROOFING_SITE, install: ROOFING_INSTALL },
  solar: { site: SOLAR_SITE, install: SOLAR_INSTALL },
};

export function defaultItems(vertical: ActiveVertical, kind: PhotoTemplateKind): DefaultItem[] {
  return DEFAULTS[vertical][kind];
}

export function defaultName(vertical: ActiveVertical, kind: PhotoTemplateKind): string {
  return KIND_LABEL[kind][vertical];
}
