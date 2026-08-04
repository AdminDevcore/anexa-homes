import { geocodeParts, type AddressParts } from "./geocode";
import { googleGeocode, googleGeocodeConfigured } from "./google";

/**
 * One answer to "where is this house", for every surface that asks.
 *
 * The bug this exists for: a deal's aerial view was centred 63 m — three houses
 * — from the address on the card. The coordinates had been written by the
 * nightly cron via OpenStreetMap Nominatim, and OSM has no building for that
 * street: only the TIGER-imported road (`highway=residential`,
 * `tiger:reviewed=no`). Nominatim therefore INTERPOLATED house number 536 along
 * 436 m of centreline between the block's 500–598 range and offset it 9 m to
 * the side. That is accurate to the block, never to the lot.
 *
 * Google resolves the same address to ROOFTOP precision, and the property
 * module already knew how to ask for it — but the only caller ran when
 * `lead.lat` was null, which the cron guaranteed it never was. So the good
 * geocoder was dead code behind the bad one.
 *
 * Rooftop first, Nominatim only when there is no Google key: a free coarse
 * answer is worth having when the alternative is no map at all, but it must
 * never outrank a paid exact one.
 */

export type GeoSource = "google" | "nominatim";

export type ResolvedLocation = {
  lat: number;
  lng: number;
  /** Google's `location_type` (ROOFTOP, RANGE_INTERPOLATED, …); null from OSM. */
  precision: string | null;
  source: GeoSource;
};

/**
 * Is this coordinate good enough to point a camera at a single roof?
 *
 * Only ROOFTOP is. RANGE_INTERPOLATED is the exact failure mode above — it is
 * fine for plotting a dot on a city-wide canvassing map and useless for framing
 * one house, so the distinction has to survive as far as the backfill, which
 * uses it to decide whether replacing an existing pin is an upgrade.
 */
export function isRooftop(precision: string | null | undefined): boolean {
  return precision === "ROOFTOP";
}

/**
 * A stable identity for an address, so we can tell whether stored coordinates
 * still belong to it. Case, padding and repeated whitespace are noise —
 * "536  Greenway Drive " and "536 Greenway Drive" are the same house, and
 * re-geocoding on a whitespace edit would burn a request to learn that.
 */
export function addressKey(parts: AddressParts): string {
  return [parts.address, parts.city, parts.state, parts.zip]
    .map((s) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " "))
    .join("|");
}

/** Did an edit actually move the house, as opposed to touching another field? */
export function addressChanged(before: AddressParts, after: AddressParts): boolean {
  return addressKey(before) !== addressKey(after);
}

type Deps = {
  google: typeof googleGeocode;
  nominatim: typeof geocodeParts;
  hasGoogle: typeof googleGeocodeConfigured;
};

const REAL: Deps = {
  google: googleGeocode,
  nominatim: geocodeParts,
  hasGoogle: googleGeocodeConfigured,
};

/**
 * Resolve address parts to the best coordinate available. Returns null rather
 * than throwing — an address nobody can match is an ordinary state that renders
 * a placeholder.
 *
 * Dependencies are injected so the routing logic is unit-testable without
 * stubbing global fetch; callers use the default.
 */
export async function resolveLeadLocation(
  parts: AddressParts,
  deps: Partial<Deps> = {}
): Promise<ResolvedLocation | null> {
  const { google, nominatim, hasGoogle } = { ...REAL, ...deps };

  if (hasGoogle()) {
    const hit = await google(parts);
    if (hit) {
      return { lat: hit.lat, lng: hit.lng, precision: hit.precision ?? null, source: "google" };
    }
  }

  const osm = await nominatim(parts);
  if (osm) return { lat: osm.lat, lng: osm.lng, precision: null, source: "nominatim" };
  return null;
}
