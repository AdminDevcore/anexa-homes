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

import { metresPerPixel } from "@/lib/web-mercator";
import { SUPERTILE_PX, SUPERTILE_RADIUS, metresToLatLng } from "@/lib/map-view";

/**
 * `hybrid` is the satellite photo with street names and house numbers drawn
 * over it. It exists here because a rep on a new subdivision needs to check
 * WHICH roof the deal is about, and the labels are the only thing on the
 * picture that can answer that.
 */
export type MapType = "satellite" | "roadmap" | "hybrid";

/** Read a `?type=` query parameter down to something Google will accept. */
export function parseMapType(raw: string | null | undefined): MapType {
  return raw === "roadmap" || raw === "hybrid" ? raw : "satellite";
}

/** Zoom that frames a single suburban roof. 20 is Google's max for most areas. */
export const DEFAULT_ZOOM = 20;

/**
 * Google's hard cap on EACH side of a Static Maps image, in logical pixels.
 *
 * Discovered the expensive way. This module used to ask for `size=1280x720`
 * and Google answered 200 OK with a 1280x1280 image: it clamps each dimension
 * to 640 independently — 640x640 — and `scale=2` doubles both. Nothing in the
 * response says it happened.
 *
 * The panel designer then drew that square into a 16:9 canvas, so every roof
 * on it was stretched 1.78x wide, and the metres-per-pixel the panels were
 * sized by was wrong on both axes: half the true value across, an eighth out
 * down. Panels laid on a distorted roof at the wrong scale cannot be made to
 * line up, however carefully a rep drags them.
 *
 * Clamping here rather than trusting the caller keeps the returned image the
 * shape that was asked for, which is the property the designer's geometry
 * rests on.
 */
export const STATIC_MAP_MAX_PX = 640;

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
  /**
   * Draw the "this house" pin. Default true.
   *
   * The panel-layout designer turns it OFF: the pin sits exactly where the
   * array goes, hiding the roof a rep is drawing on — and it would be baked
   * into the layout picture the customer is sent.
   */
  marker?: boolean;
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
    marker = true,
  } = o;
  const params = new URLSearchParams({
    center: `${lat},${lng}`,
    zoom: String(zoom),
    size: `${clampSide(width)}x${clampSide(height)}`,
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
  if (marker) params.append("markers", `color:0xF4631E|${lat},${lng}`);
  return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
}

/** One side of a Static Maps request, inside Google's limits. See STATIC_MAP_MAX_PX. */
export function clampSide(px: number): number {
  if (!Number.isFinite(px)) return STATIC_MAP_MAX_PX;
  return Math.max(1, Math.min(STATIC_MAP_MAX_PX, Math.round(px)));
}

/**
 * The image Google will actually return for a request, in DEVICE pixels.
 *
 * The designer needs this before the picture arrives, because its canvas and
 * its metres-per-pixel both depend on it — and asking for one shape and being
 * silently handed another is exactly the bug this exists to prevent.
 */
export function staticMapPixelSize(o: {
  width?: number;
  height?: number;
  scale?: 1 | 2;
}): { widthPx: number; heightPx: number } {
  const scale = o.scale ?? 2;
  return {
    widthPx: clampSide(o.width ?? 1280) * scale,
    heightPx: clampSide(o.height ?? 720) * scale,
  };
}

/** Is the integration configured at all? Drives the placeholder vs the image. */
export function satelliteConfigured(
  key: string | undefined = process.env.GOOGLE_MAPS_API_KEY
): boolean {
  return !!key && key.trim().length > 0;
}

/**
 * Google's deepest Static Maps imagery.
 *
 * MEASURED, and it is the second thing on this endpoint that fails by lying.
 * A `zoom=22` request answers 200 with an image byte-identical to `zoom=21` —
 * same MD5, same 1280x1280 — so a caller that asked for 22 and computed its
 * metres-per-pixel as though it had received 22 draws every panel at half the
 * size of the roof underneath it. The clamp belongs here, beside the size one,
 * for the same reason: what the caller gets back should be what it asked for.
 */
export const MAX_STATIC_ZOOM = 21;

/** Wide enough to show a subdivision and the road network around it. */
export const MIN_STATIC_ZOOM = 15;

/**
 * One address in the pannable grid the roof designer draws on.
 *
 * A SUPERTILE IS ADDRESSED AS AN OFFSET FROM A DEAL, never as a coordinate.
 * That is the whole security design of the pannable map: this route resolves
 * the centre itself, from the lead the caller is already entitled to read, so
 * no browser can hand it a latitude and turn an authenticated session into a
 * general-purpose satellite-imagery proxy billed to this company. The radius
 * bound is what keeps that promise finite.
 */
export type Supertile = { zoom: number; tx: number; ty: number };

/**
 * TILE OFFSETS MAY BE FRACTIONAL, and the reason is Google's own watermark.
 *
 * Every Static Maps image carries "Google" and its imagery credit baked into
 * the bottom corners. That is fine on one picture and awful on a mosaic: the
 * designer draws four of them across a screen, so the roof gets four logos —
 * and the customer's layout picture, rendered from the same mosaic, would carry
 * them too. Cropping them off is not an option; the attribution is a condition
 * of using the imagery.
 *
 * So the export asks for ONE image, centred exactly on the array rather than on
 * a grid point, which needs a fractional offset. It widens nothing: the bound
 * below is unchanged, so the reachable ground is exactly what it was. Only the
 * centring within it is free.
 */

/** The grid is anchored on the deal: tile (0,0) is centred on the house. */
export function supertileCentre(
  origin: { lat: number; lng: number },
  tile: Supertile
): { lat: number; lng: number } {
  const sideM = SUPERTILE_PX * metresPerPixel(origin.lat, tile.zoom, 2);
  return metresToLatLng(origin, { e: tile.tx * sideM, n: -tile.ty * sideM });
}

/**
 * Read a supertile out of a query string, or null when this is not a tile
 * request at all.
 *
 * Returns null rather than throwing for an ABSENT tile so the one route can go
 * on serving the deal-detail card its single framed image; anything present but
 * out of bounds is a hard reject, because a caller reaching past the bound is
 * either broken or probing.
 */
export function parseSupertile(sp: URLSearchParams): Supertile | null | "invalid" {
  const rawX = sp.get("tx");
  const rawY = sp.get("ty");
  if (rawX === null && rawY === null) return null;

  /**
   * BLANK IS NOT ZERO, and this is the third time that has bitten this file —
   * see `parseZoomParam`. `Number("")` is 0 and `Number.isInteger(0)` is true,
   * so `?tx=0&ty=` read as "the tile the house is on" and served a picture of
   * the wrong ground with a 200. A caller that sends half a coordinate is
   * broken; say so rather than guessing which half it meant.
   */
  const nums = [rawX, rawY, sp.get("zoom")].map((raw) =>
    raw === null || raw.trim() === "" ? NaN : Number(raw)
  );
  const [tx, ty, zoom] = nums;
  if (!nums.every(Number.isFinite)) return "invalid";
  if (!Number.isInteger(zoom)) return "invalid";
  if (Math.abs(tx) > SUPERTILE_RADIUS || Math.abs(ty) > SUPERTILE_RADIUS) return "invalid";
  if (zoom < MIN_STATIC_ZOOM || zoom > MAX_STATIC_ZOOM) return "invalid";
  return { zoom, tx, ty };
}
