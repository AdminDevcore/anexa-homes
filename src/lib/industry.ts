import type { Industry, ServiceType } from "@prisma/client";

// The three isolated portal workspaces. "Others" is a catch-all for any
// non-roofing/solar leads (e.g. windows, gutters, HVAC) to sub out.
export const INDUSTRIES: Industry[] = ["roofing", "solar", "others"];

export const INDUSTRY_LABEL: Record<Industry, string> = {
  roofing: "Roofing",
  solar: "Solar",
  others: "Others",
};

// A distinct accent per industry so each workspace reads as its own "vibe".
export const INDUSTRY_ACCENT: Record<Industry, string> = {
  roofing: "#F4631E", // orange
  solar: "#F59E0B", // amber
  others: "#64748B", // slate — a neutral catch-all
};

export const DEFAULT_INDUSTRY: Industry = "roofing";

// Industry ↔ the granular ServiceType used by reports/roof-report/etc.
export const INDUSTRY_SERVICE_TYPE: Record<Industry, ServiceType> = {
  roofing: "roofing",
  solar: "solar",
  others: "other",
};

export function isIndustry(v: unknown): v is Industry {
  return v === "roofing" || v === "solar" || v === "others";
}

/**
 * Single-workspace build: Anexa runs one Roofing workspace. Every user works
 * Roofing, and all leads (whatever service the homeowner picked on the website)
 * land here — non-roofing trades are forwarded to partner companies off-platform.
 * The `industry` column and enum stay in the schema for historical data; this is
 * the single lever that collapses active workspace, the switcher, and the
 * empty-workspace hint to Roofing only. Restore the old body to re-enable
 * multi-workspace.
 */
export function allowedIndustries(_industries?: Industry[] | null): Industry[] {
  return [DEFAULT_INDUSTRY];
}
