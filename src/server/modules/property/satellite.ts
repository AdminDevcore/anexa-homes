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
  return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
}

export type GeoPoint = { lat: number; lng: number; formatted: string };

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
      geometry?: { location?: { lat?: number; lng?: number } };
    }>;
  };
  if (d.status !== "OK") return null;
  const first = d.results?.[0];
  const loc = first?.geometry?.location;
  if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) return null;
  return {
    lat: loc.lat as number,
    lng: loc.lng as number,
    formatted: first?.formatted_address ?? "",
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
