import type { Vertical, ServiceType } from "@prisma/client";

/**
 * A "vertical" is an isolated line of business inside one company: its own
 * deals, pipeline, config, templates, catalog and reports. Roofing and Solar
 * are separate businesses that share one employee roster and one general ledger.
 *
 * The Prisma enum is physically still `Industry` / `industry` in Postgres (see
 * the `@map`s in schema.prisma) — the rename is code-level only, so there is no
 * DDL to coordinate with a deploy. Everything above the schema says "vertical".
 *
 * Adding a third vertical = add the enum value + one seed, nothing else.
 */

/**
 * The verticals a user can actually work in. `others` is deliberately absent:
 * it is a legacy enum value from the pre-2026-07 three-workspace build that must
 * never reach the UI, the switcher, or a query. See LEGACY_VERTICALS.
 */
export const VERTICALS = ["roofing", "solar"] as const satisfies readonly Vertical[];

/**
 * Enum values that still exist in Postgres (so historical rows keep validating)
 * but are retired from the product. Nothing may switch into one, and no config
 * or deal may be created in one.
 */
export const LEGACY_VERTICALS = ["others"] as const satisfies readonly Vertical[];

export type ActiveVertical = (typeof VERTICALS)[number];

export const VERTICAL_LABEL: Record<Vertical, string> = {
  roofing: "Roofing",
  solar: "Solar",
  others: "Others (retired)",
};

/** A distinct accent per vertical so each workspace reads as its own place. */
export const VERTICAL_ACCENT: Record<Vertical, string> = {
  roofing: "#F4631E", // orange — the Anexa brand accent
  solar: "#0EA5E9", // sky — deliberately far from orange, so a rep can never
  // mistake which workspace they are acting in at a glance
  others: "#64748B",
};

export const DEFAULT_VERTICAL: ActiveVertical = "roofing";

/** Vertical → the granular ServiceType used by reports / roof reports / intake. */
export const VERTICAL_SERVICE_TYPE: Record<Vertical, ServiceType> = {
  roofing: "roofing",
  solar: "solar",
  others: "other",
};

/** True for any value the Postgres enum accepts, including retired ones. */
export function isVertical(v: unknown): v is Vertical {
  return v === "roofing" || v === "solar" || v === "others";
}

/**
 * True only for verticals a user may actually work in. This is the check that
 * keeps `others` out of the switcher, out of the active-vertical cookie, and
 * out of every newly created row.
 */
export function isActiveVertical(v: unknown): v is ActiveVertical {
  return (VERTICALS as readonly unknown[]).includes(v);
}

/**
 * The verticals this user may open and switch between: their granted list,
 * narrowed to the ones that are live. A user with no usable grant falls back to
 * roofing rather than being locked out of the portal entirely.
 */
export function allowedVerticals(granted?: Vertical[] | null): ActiveVertical[] {
  const live = (granted ?? []).filter(isActiveVertical);
  return live.length > 0 ? live : [DEFAULT_VERTICAL];
}

/**
 * Which workspace a website enquiry lands in, from the service the homeowner
 * picked. Everything that isn't solar is roofing work (or is subbed out), which
 * matches how the marketing site is structured.
 */
export function verticalForServiceSlug(slug: string | null | undefined): ActiveVertical {
  return slug === "solar" ? "solar" : DEFAULT_VERTICAL;
}
