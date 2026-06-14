// Customizable per-company job settings stored as simple label lists on
// CompanySettings. Each has a code default used when the company hasn't set its own.

export const DEFAULT_INSPECTION_OUTCOMES = [
  "Damage confirmed",
  "Approved — full replacement",
  "Approved — repair only",
  "Partial approval",
  "Denied",
  "No damage found",
  "Pending adjuster review",
];

export const DEFAULT_QC_CHECKLIST = [
  "Pre-install site walkthrough",
  "Materials delivered & verified",
  "Magnetic nail sweep complete",
  "Gutters cleaned of debris",
  "Final photos uploaded",
  "Customer closeout walkthrough",
];

/** Coerce a stored JSON value into a clean, de-duped list of non-empty labels. */
export function parseLabelList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value) {
    const label = typeof raw === "string" ? raw.trim() : "";
    if (!label || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    out.push(label);
  }
  return out.length ? out : fallback;
}
