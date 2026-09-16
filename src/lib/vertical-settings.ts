import type { Vertical } from "@prisma/client";

/**
 * Per-vertical overrides for the SCALAR CompanySettings fields.
 *
 * Anexa runs two brands out of one legal entity — Roofing as Anexa Homes, Solar
 * as Prime Solar — so branding and customer-facing identity are per vertical,
 * while the things that identify the *business* (locale, currency, books, role
 * permissions, business hours) stay shared.
 *
 * The model is base + deviation, not two parallel copies:
 *
 *   resolved(field, vertical) = overrides[vertical]?.[field] ?? settings[field]
 *
 * Two properties fall out of that, both of them requirements rather than
 * conveniences:
 *
 *   1. Roofing is byte-for-byte unchanged. With no "roofing" key present, every
 *      read returns the same column it read before this existed.
 *   2. Solar starts empty and INHERITS. Nothing renders blank while Prime
 *      Solar's real values are still being filled in — a half-configured brand
 *      shows the company's, not an empty logo and black text on black.
 *
 * JSON settings (emailTemplates, requiredDocuments, appointmentDispositions…)
 * are deliberately NOT handled here — they already carry per-vertical keys
 * inside their own column via lib/vertical-config.
 */

/** Branding + customer-facing identity. Two brands, one company. */
export const BRANDING_FIELDS = [
  // Not a CompanySettings column — it exists ONLY as an override, and falls
  // back to Company.name. Without it "two brands" is only half true: Solar
  // would show Prime Solar's logo above text still reading "Anexa Homes".
  // Roofing sets no override, so it keeps the company name exactly as today.
  "brandName",
  "logoUrl",
  "faviconUrl",
  "primaryColor",
  "accentColor",
  "fontFamily",
  "removePoweredBy",
  "supportPhone",
  "supportEmail",
  "emailFromName",
  "customDomain",
] as const;

/** Workflow / ops knobs that differ per vertical. */
export const WORKFLOW_FIELDS = [
  "recordPrefix",
  "weeklyTaskRemindersEnabled",
  "overdueDigestEnabled",
  "emailSignedCopyToSigners",
  "stormCenterLat",
  "stormCenterLng",
  "stormRadiusMiles",
] as const;

export const OVERRIDABLE_FIELDS = [...BRANDING_FIELDS, ...WORKFLOW_FIELDS] as const;
export type OverridableField = (typeof OVERRIDABLE_FIELDS)[number];

const OVERRIDABLE = new Set<string>(OVERRIDABLE_FIELDS);

/**
 * Fields that must NEVER be per-vertical. Asserted by a test: this is one legal
 * entity, so splitting the role matrix or the isolation levers in two would be
 * a data-integrity bug, not a feature.
 *
 * `bookkeepingProvider` and `bookkeepingApiKey` were here and are gone with the
 * columns themselves — a fake connection picker that no sync ever read. The
 * books stay shared for a better reason than a credential: one legal entity has
 * one general ledger, which is what `isolateBooks` is the documented lever for.
 */
export const SHARED_ONLY_FIELDS = [
  "businessHours",
  "currencyCode",
  "locale",
  "rolePermissions",
  "isolateBooks",
  "isolateTeam",
] as const;

/**
 * FileAsset category tag for a vertical's branding logo.
 *
 * The default vertical keeps the bare "branding_logo" tag it has always used —
 * so every logoUrl already stored in the wild keeps resolving to the same asset
 * and Roofing's logo does not need re-uploading. Other verticals get a suffixed
 * tag, which is what makes "a solar logo is a solar asset" true at the storage
 * layer rather than only in the settings row.
 */
export const BRANDING_LOGO_CATEGORY = "branding_logo";

export function brandingLogoCategory(vertical: Vertical | null | undefined): string {
  if (!vertical || vertical === "roofing") return BRANDING_LOGO_CATEGORY;
  return `${BRANDING_LOGO_CATEGORY}:${vertical}`;
}

type Overrides = Record<string, Record<string, unknown>>;

function parse(raw: unknown): Overrides {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as Overrides;
}

/**
 * Merge a vertical's overrides onto the base settings row.
 *
 * `null` in an override is treated as "not set" and inherits, so clearing a
 * Solar field falls back to the company value rather than blanking the brand.
 * Only `OVERRIDABLE_FIELDS` are honoured — an unknown or shared-only key in the
 * JSON is ignored rather than trusted, since this column is user-writable.
 */
export function applyVerticalOverrides<T extends Record<string, unknown>>(
  settings: T | null,
  vertical: Vertical | null | undefined
): T | null {
  if (!settings) return settings;
  if (!vertical) return settings;
  const forVertical = parse(settings.verticalOverrides)[vertical];
  if (!forVertical) return settings;

  const merged: Record<string, unknown> = { ...settings };
  for (const [key, value] of Object.entries(forVertical)) {
    if (!OVERRIDABLE.has(key)) continue;
    if (value === null || value === undefined) continue;
    merged[key] = value;
  }
  return merged as T;
}

/**
 * Produce the next `verticalOverrides` value with `patch` applied to one
 * vertical. Keys set to null/"" are REMOVED, so "clear this" means "inherit"
 * rather than "store an empty string" — otherwise clearing Solar's logo would
 * render a blank brand instead of falling back.
 */
export function writeVerticalOverrides(
  raw: unknown,
  vertical: Vertical,
  patch: Record<string, unknown>
): Overrides {
  const all = { ...parse(raw) };
  const next: Record<string, unknown> = { ...(all[vertical] ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (!OVERRIDABLE.has(key)) continue;
    if (value === null || value === undefined || value === "") delete next[key];
    else next[key] = value;
  }
  if (Object.keys(next).length === 0) delete all[vertical];
  else all[vertical] = next;
  return all;
}
