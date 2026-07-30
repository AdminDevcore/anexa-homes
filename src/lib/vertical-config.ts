import type { Vertical } from "@prisma/client";
import { DEFAULT_VERTICAL } from "./vertical";

/**
 * Per-vertical namespacing for the config that lives in `CompanySettings` JSON
 * columns (appointment outcomes, inspection outcomes, the production QC
 * checklist…).
 *
 * These were single shared blobs. A shared mutable config object is exactly the
 * bleed the isolation work exists to prevent: editing Solar's inspection
 * outcomes must not touch Roofing's, and must not touch a shared default that
 * both then read from.
 *
 * Storage is backwards compatible, so no data migration was needed:
 *
 *   legacy   [ "Damage confirmed", … ]                  → that IS roofing's list
 *   scoped   { roofing: [ … ], solar: [ … ] }           → per-vertical
 *
 * A legacy bare array is read as roofing's config and as *empty* for any other
 * vertical, so Solar starts from its own defaults rather than inheriting
 * roofing's. The first write to any vertical upgrades the column to the scoped
 * shape while preserving the roofing list untouched.
 */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Read one vertical's slice of a namespaced config column.
 * Returns `undefined` when that vertical has nothing stored, so the caller can
 * apply its own code default.
 */
export function readVerticalConfig(raw: unknown, vertical: Vertical): unknown {
  if (Array.isArray(raw)) {
    // Legacy single-list shape: it belongs to roofing and nobody else.
    return vertical === DEFAULT_VERTICAL ? raw : undefined;
  }
  if (isRecord(raw)) return raw[vertical];
  return undefined;
}

/**
 * Produce the new value for a namespaced config column, replacing ONLY the
 * given vertical's slice. Every other vertical's config is carried through
 * byte-for-byte — this function is the reason a settings write cannot bleed.
 */
export function writeVerticalConfig(
  raw: unknown,
  vertical: Vertical,
  value: unknown
): Record<string, unknown> {
  const base: Record<string, unknown> = Array.isArray(raw)
    ? { [DEFAULT_VERTICAL]: raw } // upgrade legacy shape, preserving roofing
    : isRecord(raw)
      ? { ...raw }
      : {};
  base[vertical] = value;
  return base;
}
