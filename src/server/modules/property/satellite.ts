import { addressQuery, cleanAddressLine, type AddressParts } from "@/server/modules/geo/geocode";

/**
 * Property imagery for the solar deal detail: a satellite view of the roof,
 * centred on the deal's address.
 *
 * The API key NEVER reaches the browser. A Static Maps URL carries the key as a
 * query parameter, so putting one in an <img src> publishes it to anyone who
 * opens devtools — and a key that can be lifted can be billed. Every image is
 * therefore fetched server-side and proxied through our own route; the browser
 * only ever sees /api/property/satellite?leadId=…
 *
 * That choice has a consequence worth knowing when provisioning the key: it is
 * called from our server, not from a page, so an HTTP-referrer restriction will
 * REJECT every request. Restrict by IP (or leave unrestricted and rely on the
 * API allow-list) instead.
 */

export type MapType = "satellite" | "roadmap";

/** Zoom that frames a single suburban roof. 20 is Google's max for most areas. */
export const DEFAULT_ZOOM = 20;

/**
 * Read a `?zoom=` query parameter, falling back to DEFAULT_ZOOM.
 *
 * A pure function with tests rather than three lines inline in the route,
 * because the inline version shipped a bug that put a picture of the whole
 * planet on every deal: `searchParams.get()` returns `null` for an absent
 * param, `Number(null)` is `0` (not NaN), so `Number.isFinite` was true, the
 * fallback never fired, and the clamp floored it to 1. `Number("")` is also 0,
 * so a blank param needs the same guard.
 *
 * Out-of-range values are clamped, not rejected: Google answers an impossible
 * zoom with a grey tile and HTTP 200, which reads as a broken feature.
 */
export function parseZoomParam(raw: string | null | undefined): number {
  if (raw === null || raw === undefined || raw.trim() === "") return DEFAULT_ZOOM;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_ZOOM;
  return Math.min(21, Math.max(1, Math.round(n)));
}

export type StaticMapOptions = {
  lat: number;
  lng: number;
  type?: MapType;
  zoom?: number;
  width?: number;
  height?: number;
  /** 2 on HiDPI; Google bills scale=2 as one extra request, not four. */
  scale?: 1 | 2;
};

/**
 * Build the Google Static Maps URL. Pure and unit-tested — it is the piece most
 * likely to break silently, since a malformed URL returns a grey "sorry" tile
 * with HTTP 200 rather than an error.
 */
export function staticMapUrl(key: string, o: StaticMapOptions): string {
  const {
    lat,
    lng,
    type = "satellite",
    zoom = DEFAULT_ZOOM,
    width = 1280,
    height = 720,
    scale = 2,
  } = o;
  const params = new URLSearchParams({
    center: `${lat},${lng}`,
    zoom: String(zoom),
    size: `${width}x${height}`,
    scale: String(scale),
    maptype: type,
    format: "png",
    key,
  });
  // A PIN on the exact point. Without one the image is six roofs and a street
  // and no way to tell which one the deal is about — and when Google can only
  // interpolate an address along the road (RANGE_INTERPOLATED, common on newer
  // subdivisions), the centre IS the road, so the picture looks plain wrong.
  // The marker at least says "here, as well as Google knows".
  params.append("markers", `color:0xF4631E|${lat},${lng}`);
  return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
}

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
 * Parse a Google Geocoding response. Pure so the failure modes are testable:
 * Google answers HTTP 200 for ZERO_RESULTS and for REQUEST_DENIED (a bad or
 * unenabled key), so the `status` field — not the HTTP code — is the real
 * signal. Treating 200 as success is the classic way to ship a silently broken
 * integration.
 */
/**
 * Google's precision tiers, best first. ROOFTOP is an actual building;
 * RANGE_INTERPOLATED is a guess along the street between two known house
 * numbers, which on a newer subdivision lands the pin on the ROAD rather than
 * the roof. Picking the best available result matters when Google returns
 * several — taking `results[0]` blindly can hand back a postcode centroid while
 * a rooftop match sits at index 1.
 */
const PRECISION_ORDER = [
  "ROOFTOP",
  "RANGE_INTERPOLATED",
  "GEOMETRIC_CENTER",
  "APPROXIMATE",
] as const;

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
    if (!point) console.warn("[satellite] geocode failed:", geocodeStatusReason(data));
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

/** Is the integration configured at all? Drives the placeholder vs the image. */
export function satelliteConfigured(
  key: string | undefined = process.env.GOOGLE_MAPS_API_KEY
): boolean {
  return !!key && key.trim().length > 0;
}
