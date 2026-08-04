import type { ActiveVertical } from "./vertical";

/**
 * Which *domain concepts* a vertical actually works in.
 *
 * `lib/vertical.ts` answers "which workspaces exist"; `lib/vertical-config.ts`
 * answers "where does this vertical's config live". This file answers the third
 * question — "does this line of business even have hail?" — and it is the only
 * place that question is decided.
 *
 * Without it the answer gets re-derived as an inline `vertical === "solar"` at
 * every render site, and the ones nobody remembers drift: a solar rep opens the
 * Field Map and is offered a hail layer, a storm score and an NWS warning
 * overlay for a product that is sold on a utility bill, not a roof claim.
 *
 * Adding a third vertical means adding it to these functions — a compile error
 * if it is ever forgotten, since `ActiveVertical` is a closed union.
 */

/**
 * Hail radar swaths, NOAA/SPC storm reports, NWS warnings, storm scores and the
 * whole storm-targeting toolset.
 *
 * Roofing prospects off storms: a hail swath IS the lead list. Solar sells on a
 * utility bill and a roof plane's sun exposure — a storm map is not a weaker
 * signal there, it is a meaningless one.
 */
export function stormEnabled(vertical: ActiveVertical): boolean {
  return vertical === "roofing";
}

/**
 * Insurance restoration: carriers, adjusters, deductibles and the scope-of-work
 * line-item catalog that a supplement is built from.
 *
 * Solar has a cash or financed contract and no third party paying for it, so
 * there is nothing for a restoration catalog to price.
 */
export function insuranceEnabled(vertical: ActiveVertical): boolean {
  return vertical === "roofing";
}
