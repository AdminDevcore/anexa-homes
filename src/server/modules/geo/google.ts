import { addressQuery, cleanAddressLine, type AddressParts } from "./geocode";

/**
 * Google Geocoding — the only geocoder we have that returns ROOFTOP precision.
 *
 * This lives in geo/ rather than property/ because it is not a picture: the
 * canvassing map, the deal's aerial view and the skip-trace all want the same
 * answer to "where is this house", and they were quietly getting three
 * different ones.
 *
 * The key never reaches the browser. Every call is server-side; a page that
 * needs coordinates asks one of our own routes for them.
 */

export type GeoPoint = {
  lat: number;
  lng: number;
  formatted: string;
  /**
   * Google's `location_type`. ROOFTOP means an actual building;
   * RANGE_INTERPOLATED means "somewhere along this street between number X and
   * number Y", which is why a brand-new subdivision can centre on the road.
   */
  precision?: string | null;
};

/**
 * Google's precision tiers, best first. ROOFTOP is an actual building;
 * RANGE_INTERPOLATED is a guess along the street between two known house
 * numbers, which on a newer subdivision lands the pin on the ROAD rather than
 * the roof. Picking the best available result matters when Google returns
 * several — taking `results[0]` blindly can hand back a postcode centroid while
 * a rooftop match sits at index 1.
 */
export const PRECISION_ORDER = [
  "ROOFTOP",
  "RANGE_INTERPOLATED",
  "GEOMETRIC_CENTER",
  "APPROXIMATE",
] as const;

/**
 * Parse a Google Geocoding response. Pure so the failure modes are testable:
 * Google answers HTTP 200 for ZERO_RESULTS and for REQUEST_DENIED (a bad or
 * unenabled key), so the `status` field — not the HTTP code — is the real
 * signal. Treating 200 as success is the classic way to ship a silently broken
 * integration.
 */
export function parseGoogleGeocode(data: unknown): GeoPoint | null {
  if (!data || typeof data !== "object") return null;
  const d = data as {
    status?: string;
    results?: Array<{
      formatted_address?: string;
      geometry?: { location?: { lat?: number; lng?: number }; location_type?: string };
    }>;
  };
  if (d.status !== "OK") return null;

  const usable = (d.results ?? []).filter((r) => {
    const loc = r.geometry?.location;
    return loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng);
  });
  if (usable.length === 0) return null;

  const rank = (r: (typeof usable)[number]) => {
    const i = PRECISION_ORDER.indexOf(
      (r.geometry?.location_type ?? "") as (typeof PRECISION_ORDER)[number]
    );
    return i === -1 ? PRECISION_ORDER.length : i;
  };
  // Stable: equal precision keeps Google's own ordering.
  const best = usable.reduce((a, b) => (rank(b) < rank(a) ? b : a));
  const loc = best.geometry!.location!;

  return {
    lat: loc.lat as number,
    lng: loc.lng as number,
    formatted: best.formatted_address ?? "",
    precision: best.geometry?.location_type ?? null,
  };
}

/** Human-readable reason a geocode failed, for the server log (never the UI). */
export function geocodeStatusReason(data: unknown): string {
  const status = (data as { status?: string; error_message?: string } | null)?.status;
  const detail = (data as { error_message?: string } | null)?.error_message;
  switch (status) {
    case "ZERO_RESULTS":
      return "address did not match any location";
    case "REQUEST_DENIED":
      return `key rejected — is the Geocoding API enabled? ${detail ?? ""}`.trim();
    case "OVER_QUERY_LIMIT":
      return "quota or billing limit reached";
    case "INVALID_REQUEST":
      return "malformed request (empty address?)";
    default:
      return status ? `unexpected status ${status}` : "unparseable response";
  }
}

/** Is a Google key configured at all? Drives rooftop-vs-fallback routing. */
export function googleGeocodeConfigured(
  key: string | undefined = process.env.GOOGLE_MAPS_API_KEY
): boolean {
  return !!key && key.trim().length > 0;
}

/**
 * Geocode an address with Google. Returns null rather than throwing: a missing
 * key or an unmatchable address is an expected state that renders a placeholder,
 * not an error page.
 */
export async function googleGeocode(
  parts: AddressParts,
  key: string | undefined = process.env.GOOGLE_MAPS_API_KEY
): Promise<GeoPoint | null> {
  if (!key) return null;
  const query = addressQuery(parts);
  if (!query.trim()) return null;

  const attempt = async (q: string): Promise<GeoPoint | null> => {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&key=${key}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    const point = parseGoogleGeocode(data);
    if (!point) console.warn("[geo] google geocode failed:", geocodeStatusReason(data));
    return point;
  };

  const direct = await attempt(query);
  if (direct) return direct;

  // Same fallback the Nominatim path uses: unit/lot designators are the usual
  // reason a clean-looking address won't resolve.
  const cleaned = cleanAddressLine(parts.address);
  if (cleaned && cleaned !== (parts.address ?? "").trim()) {
    return attempt(addressQuery({ ...parts, address: cleaned }));
  }
  return null;
}
