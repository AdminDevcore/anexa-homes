// Appointment outcomes ("dispositions") a rep records after running an
// inspection/appointment. Each outcome can belong to a GROUP (e.g. Insurance,
// Retail, No Sale) so the picker shows them under headers. Fully customizable
// per company in Settings → Appointment Outcomes (stored on CompanySettings).

/**
 * What an outcome says about the visit itself: did it happen?
 *
 * Solar sorts its Appointments list by this (see appointment-status.ts).
 * Roofing carries the field in memory only. Its screens never show it and its
 * saves never write it, because the owner asked for this on solar alone.
 */
export const OUTCOME_CATEGORIES = ["ran", "not_ran", "rescheduled", "cancelled"] as const;
export type OutcomeCategory = (typeof OUTCOME_CATEGORIES)[number];

export const OUTCOME_CATEGORY_LABELS: Record<OutcomeCategory, string> = {
  ran: "Ran",
  not_ran: "Not ran",
  rescheduled: "Rescheduled",
  cancelled: "Cancelled",
};

export type Disposition = { group: string | null; label: string; countsAs: OutcomeCategory };

export function isOutcomeCategory(value: unknown): value is OutcomeCategory {
  return typeof value === "string" && (OUTCOME_CATEGORIES as readonly string[]).includes(value);
}

const NOT_RAN_WORDING = /no[\s-]?show|nobody home|no one home|not home|not ran|didn[’']?t run/;

/**
 * A best guess from the wording, for an outcome saved before categories
 * existed. Order matters: "Rescheduled — no show" is a reschedule, and
 * everything that is not obviously a missed or moved visit is one that ran
 * ("Not interested" still sat down with the homeowner).
 */
export function inferCountsAs(label: string): OutcomeCategory {
  const l = label.toLowerCase();
  if (l.includes("reschedul")) return "rescheduled";
  if (NOT_RAN_WORDING.test(l)) return "not_ran";
  if (l.includes("cancel")) return "cancelled";
  return "ran";
}

/** What a recorded outcome counts as: the configured value, else the wording's. */
export function outcomeCategory(outcome: string, list: Disposition[]): OutcomeCategory {
  const key = outcome.trim().toLowerCase();
  return list.find((d) => d.label.toLowerCase() === key)?.countsAs ?? inferCountsAs(outcome);
}

export const DEFAULT_APPOINTMENT_DISPOSITIONS: Disposition[] = [
  { group: "Insurance", label: "Hail Damage", countsAs: "ran" },
  { group: "Insurance", label: "Wind Damage", countsAs: "ran" },
  { group: "Insurance", label: "Mixed Storm Damage", countsAs: "ran" },
  { group: "Insurance", label: "Adjuster Needed", countsAs: "ran" },
  { group: "Retail", label: "Retail Roof", countsAs: "ran" },
  { group: "Retail", label: "Retail Gutters", countsAs: "ran" },
  { group: "Retail", label: "Retail Exterior", countsAs: "ran" },
  { group: "No Sale", label: "No Damage", countsAs: "ran" },
  { group: "No Sale", label: "Too New", countsAs: "ran" },
  { group: "No Sale", label: "Existing Contractor", countsAs: "ran" },
  { group: "No Sale", label: "Homeowner Not Interested", countsAs: "ran" },
  { group: "No Sale", label: "Bad Lead", countsAs: "ran" },
];

/**
 * Solar appointment outcomes.
 *
 * Solar has no adjuster, no storm damage and no insurance claim, so it shares
 * none of the roofing wording. What a solar rep records after a consult is
 * whether the home qualifies and what is blocking it, and, for a visit that
 * never happened, why.
 */
export const DEFAULT_SOLAR_APPOINTMENT_DISPOSITIONS: Disposition[] = [
  { group: "Sold", label: "Signed — proposal accepted", countsAs: "ran" },
  { group: "Sold", label: "Verbal yes — sending proposal", countsAs: "ran" },
  { group: "Pipeline", label: "Proposal presented — deciding", countsAs: "ran" },
  { group: "Pipeline", label: "Needs co-owner present", countsAs: "ran" },
  { group: "Pipeline", label: "Awaiting utility bill", countsAs: "ran" },
  { group: "Not Qualified", label: "Credit not approved", countsAs: "ran" },
  { group: "Not Qualified", label: "Roof needs replacement first", countsAs: "ran" },
  { group: "Not Qualified", label: "Too much shade", countsAs: "ran" },
  { group: "Not Qualified", label: "Usage too low to justify", countsAs: "ran" },
  { group: "Not Qualified", label: "Renter / not the owner", countsAs: "ran" },
  { group: "No Sale", label: "Not interested", countsAs: "ran" },
  { group: "No Sale", label: "Going with another installer", countsAs: "ran" },
  { group: "Didn't run", label: "No show — nobody home", countsAs: "not_ran" },
  { group: "Didn't run", label: "Rescheduled", countsAs: "rescheduled" },
  { group: "Didn't run", label: "Cancelled before arrival", countsAs: "cancelled" },
];

// Normalize whatever is stored (JSON) into a clean, de-duped Disposition list.
// Accepts both the legacy string[] format and the grouped object[] format, with
// or without a category. Falls back to the defaults when nothing valid is stored.
export function parseDispositions(
  value: unknown,
  fallback: Disposition[] = DEFAULT_APPOINTMENT_DISPOSITIONS
): Disposition[] {
  if (Array.isArray(value)) {
    const seen = new Set<string>();
    const list: Disposition[] = [];
    for (const item of value) {
      let label = "";
      let group: string | null = null;
      let countsAs: OutcomeCategory | null = null;
      if (typeof item === "string") {
        label = item.trim();
      } else if (item && typeof item === "object") {
        const o = item as { group?: unknown; label?: unknown; countsAs?: unknown };
        label = typeof o.label === "string" ? o.label.trim() : "";
        group = typeof o.group === "string" && o.group.trim() ? o.group.trim() : null;
        countsAs = isOutcomeCategory(o.countsAs) ? o.countsAs : null;
      }
      if (!label) continue;
      const key = label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({ group, label, countsAs: countsAs ?? inferCountsAs(label) });
    }
    if (list.length) return list;
  }
  return fallback.map((d) => ({ ...d }));
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
