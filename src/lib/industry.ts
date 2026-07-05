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

/** A user's accessible industries — empty list means all three. */
export function allowedIndustries(industries: Industry[] | null | undefined): Industry[] {
  return industries && industries.length > 0 ? industries : [...INDUSTRIES];
}
