/**
 * The insurance claim's status — a per-company, customizable list.
 *
 * This was a fixed Postgres enum. It is now free-form text on `Lead.claimStatus`
 * backed by a company-editable list in Settings → Claim Statuses, because every
 * restoration office runs its carriers slightly differently ("depreciation
 * released", "re-inspection requested", "appraisal invoked"…).
 *
 * Each option carries a STABLE KEY as well as a label. The key is what a lead
 * stores and what code keys off (see `isScopeReady`); the label is what the
 * office sees and may rename freely. Renaming "Scope Received" to "ITEL
 * Received" therefore does not silently break scope gating — the key stays
 * `scope_received`. New options a company invents get a slug key derived from
 * their first label, and that key is likewise frozen after creation.
 */

export type ClaimStatusOption = { key: string; label: string };

/** The nine statuses that shipped as the original `ClaimStatus` enum. */
export const DEFAULT_CLAIM_STATUSES: ClaimStatusOption[] = [
  { key: "not_filed", label: "Not Filed" },
  { key: "filed", label: "Filed" },
  { key: "adjuster_scheduled", label: "Adjuster Scheduled" },
  { key: "scope_received", label: "Scope Received" },
  { key: "supplement_needed", label: "Supplement Needed" },
  { key: "approved", label: "Approved" },
  { key: "paid", label: "Paid" },
  { key: "denied", label: "Denied" },
  { key: "closed", label: "Closed" },
];

/** What a lead starts on, matching the old column default. */
export const DEFAULT_CLAIM_STATUS_KEY = "not_filed";

const BUILT_IN_KEYS = new Set(DEFAULT_CLAIM_STATUSES.map((s) => s.key));

/** True for the nine original statuses, whose keys code still reasons about. */
export function isBuiltInClaimStatus(key: string): boolean {
  return BUILT_IN_KEYS.has(key);
}

/**
 * Does putting a deal on this status mean a claim EXISTS?
 *
 * Setting the status is now the only way to open a claim — there is no separate
 * "Open claim" button — so this is the rule that decides whether picking a
 * status creates the Claim row and unlocks the worksheet.
 *
 * Every status except "Not Filed" means the office has something on file with a
 * carrier. Note this is deliberately not `key === "filed"`: an office that
 * back-fills a deal already at "Approved" or "Denied" has a claim too.
 */
export function claimStatusOpensClaim(key: string): boolean {
  return key !== DEFAULT_CLAIM_STATUS_KEY;
}

/**
 * Derive a storage key from a label. Only ever called when an option is FIRST
 * created — renaming keeps the original key, which is the whole point.
 */
export function claimStatusKey(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "status";
}

/** Turn a bare key back into something readable, for keys no longer in the list. */
function prettifyKey(key: string): string {
  return key
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Coerce the stored JSON into a clean option list, de-duped by key AND by
 * label, falling back to the defaults when nothing usable is stored.
 *
 * Bare strings are accepted so a hand-edited or legacy value still reads.
 */
export function parseClaimStatuses(
  value: unknown,
  fallback: ClaimStatusOption[] = DEFAULT_CLAIM_STATUSES
): ClaimStatusOption[] {
  if (!Array.isArray(value)) return fallback;
  const seenKeys = new Set<string>();
  const seenLabels = new Set<string>();
  const out: ClaimStatusOption[] = [];
  for (const raw of value) {
    let label = "";
    let key = "";
    if (typeof raw === "string") {
      label = raw.trim();
      key = claimStatusKey(label);
    } else if (raw && typeof raw === "object") {
      const r = raw as { key?: unknown; label?: unknown };
      label = typeof r.label === "string" ? r.label.trim() : "";
      key = typeof r.key === "string" ? r.key.trim() : "";
      if (!key) key = claimStatusKey(label);
    }
    if (!label || !key) continue;
    if (seenKeys.has(key) || seenLabels.has(label.toLowerCase())) continue;
    seenKeys.add(key);
    seenLabels.add(label.toLowerCase());
    out.push({ key, label });
  }
  return out.length ? out : fallback;
}

/** The label for a stored key, degrading to the prettified key if it was removed. */
export function claimStatusLabel(key: string, options: ClaimStatusOption[]): string {
  return options.find((o) => o.key === key)?.label ?? prettifyKey(key);
}

/**
 * The list to render in a picker for a lead currently on `key`.
 *
 * A deal that was set to a status the office has since deleted must not show a
 * blank dropdown, and re-opening the picker must not silently rewrite its
 * status — so the orphaned value is appended rather than dropped.
 */
export function claimStatusOptionsFor(
  key: string,
  options: ClaimStatusOption[]
): ClaimStatusOption[] {
  if (options.some((o) => o.key === key)) return options;
  return [...options, { key, label: prettifyKey(key) }];
}
