import type { Industry, ServiceType } from "@prisma/client";

// The three isolated portal workspaces.
export const INDUSTRIES: Industry[] = ["roofing", "solar", "water"];

export const INDUSTRY_LABEL: Record<Industry, string> = {
  roofing: "Roofing",
  solar: "Solar",
  water: "Water",
};

// A distinct accent per industry so each workspace reads as its own "vibe".
export const INDUSTRY_ACCENT: Record<Industry, string> = {
  roofing: "#F4631E", // orange
  solar: "#F59E0B", // amber
  water: "#0EA5E9", // sky blue
};

export const DEFAULT_INDUSTRY: Industry = "roofing";

// Industry ↔ the granular ServiceType used by reports/roof-report/etc.
export const INDUSTRY_SERVICE_TYPE: Record<Industry, ServiceType> = {
  roofing: "roofing",
  solar: "solar",
  water: "water_filtration",
};

export function isIndustry(v: unknown): v is Industry {
  return v === "roofing" || v === "solar" || v === "water";
}

/** A user's accessible industries — empty list means all three. */
export function allowedIndustries(industries: Industry[] | null | undefined): Industry[] {
  return industries && industries.length > 0 ? industries : [...INDUSTRIES];
}
