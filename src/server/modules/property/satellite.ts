/**
 * Property imagery for the deal detail: a satellite view of the roof, centred
 * on the deal's address.
 *
 * Turning that address into a coordinate is NOT this module's job — see
 * `@/server/modules/geo/resolve`. It used to be, and the split is the fix for a
 * real bug: the rooftop geocoder lived here, behind an `if (lat == null)` that
 * the nightly cron guaranteed was false, so every deal was framed on OSM's
 * street-interpolated guess instead. Imagery here, "where is this house" there,
 * one answer for every surface.
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

/** Is the integration configured at all? Drives the placeholder vs the image. */
export function satelliteConfigured(
  key: string | undefined = process.env.GOOGLE_MAPS_API_KEY
): boolean {
  return !!key && key.trim().length > 0;
}
