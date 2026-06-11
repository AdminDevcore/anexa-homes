// Appointment outcomes ("dispositions") a rep records after running an
// inspection/appointment. Each outcome can belong to a GROUP (e.g. Insurance,
// Retail, No Sale) so the picker shows them under headers. Fully customizable
// per company in Settings → Appointment Outcomes (stored on CompanySettings).

export type Disposition = { group: string | null; label: string };

export const DEFAULT_APPOINTMENT_DISPOSITIONS: Disposition[] = [
  { group: "Insurance", label: "Hail Damage" },
  { group: "Insurance", label: "Wind Damage" },
  { group: "Insurance", label: "Mixed Storm Damage" },
  { group: "Insurance", label: "Adjuster Needed" },
  { group: "Retail", label: "Retail Roof" },
  { group: "Retail", label: "Retail Gutters" },
  { group: "Retail", label: "Retail Exterior" },
  { group: "No Sale", label: "No Damage" },
  { group: "No Sale", label: "Too New" },
  { group: "No Sale", label: "Existing Contractor" },
  { group: "No Sale", label: "Homeowner Not Interested" },
  { group: "No Sale", label: "Bad Lead" },
];

// Normalize whatever is stored (JSON) into a clean, de-duped Disposition list.
// Accepts both the legacy string[] format and the grouped object[] format.
// Falls back to the defaults when nothing valid is stored.
export function parseDispositions(value: unknown): Disposition[] {
  if (Array.isArray(value)) {
    const seen = new Set<string>();
    const list: Disposition[] = [];
    for (const item of value) {
      let label = "";
      let group: string | null = null;
      if (typeof item === "string") {
        label = item.trim();
      } else if (item && typeof item === "object") {
        const o = item as { group?: unknown; label?: unknown };
        label = typeof o.label === "string" ? o.label.trim() : "";
        group = typeof o.group === "string" && o.group.trim() ? o.group.trim() : null;
      }
      if (!label) continue;
      const key = label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({ group, label });
    }
    if (list.length) return list;
  }
  return DEFAULT_APPOINTMENT_DISPOSITIONS.map((d) => ({ ...d }));
}

// Just the labels, in order — what gets stored on a lead and matched against.
export function dispositionLabels(list: Disposition[]): string[] {
  return list.map((d) => d.label);
}

// Group into optgroup-friendly buckets, preserving first-seen group order.
// Items with no group land in a leading bucket with `group: null`.
export function groupDispositions(list: Disposition[]): { group: string | null; items: string[] }[] {
  const order: string[] = [];
  const map = new Map<string, string[]>();
  for (const d of list) {
    const key = d.group ?? "";
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push(d.label);
  }
  return order.map((key) => ({ group: key || null, items: map.get(key)! }));
}
