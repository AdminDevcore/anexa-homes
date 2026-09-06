/**
 * The window onto the roof: where the picture is centred, how big a metre is,
 * and which pieces of imagery cover it.
 *
 * WHY THIS EXISTS. The panel designer used to draw on ONE photograph: a single
 * Static Maps image, 1280 px square, hard-centred on the deal's geocoded
 * coordinate, at one of two zooms. Forty metres of world, take it or leave it.
 * Three complaints fall out of that one decision:
 *
 *   - "I can't move the map." There was nothing to move. Panning was a CSS
 *     scroll over a fixed photograph, so the edge of the picture was the edge
 *     of what existed.
 *   - "It's showing the wrong house." The centre WAS the geocode, and in a new
 *     subdivision Google has only the street to interpolate along, so the photo
 *     framed a neighbour or the road.
 *   - "New houses aren't there." One vendor, one flight date, no alternative.
 *
 * All three are the same missing idea: a VIEW, separate from the imagery that
 * happens to fill it. That is what this module is.
 *
 * THE COORDINATE SYSTEM IS UNCHANGED, deliberately. Panels are stored in ground
 * metres east/north of the deal's coordinate and always have been; that is what
 * lets a layout reopen at any zoom with every module where it was left. This
 * module adds one thing to it — a centre that may sit somewhere other than the
 * origin — and nothing else. `mpp` (metres per CSS pixel) replaces the old
 * fixed zoom-and-scale pair as the one source of truth about size.
 *
 * WHAT WAS MEASURED RATHER THAN ASSUMED (2026-09-05, key on GCP 1048785747692):
 *
 *   - The Map Tiles API is DISABLED on this project. `createSession` answers
 *     403 for every map type, which is also why the Field Map's two Google
 *     basemap buttons draw nothing. So the pannable Google layer here is built
 *     from Static Maps, which is enabled and already paid for.
 *   - Static Maps CLAMPS ZOOM AT 21. A zoom=22 request came back byte-identical
 *     to zoom=21 — same MD5, same 1280x1280 — with HTTP 200 and no warning.
 *     Asking deeper does not fail, it silently lies about scale, which on this
 *     screen means every panel drawn at the wrong size. Hence GOOGLE_MAX_ZOOM.
 *   - Esri World Imagery runs out at 20 in this market. z21 and deeper return a
 *     grey "Map data not yet available" JPEG, again with HTTP 200. Hence
 *     ESRI_MAX_ZOOM.
 *
 * Past a source's last real zoom the view keeps going and the imagery is drawn
 * magnified. That is honest — it is the same picture the old screen showed when
 * a rep scaled a fixed photograph up — and it beats a grey square.
 */

import { metresPerPixel, zoomForMetresPerPixel } from "./web-mercator";

/** A point on the ground, in metres east and north of the deal's coordinate. */
export type Vec = { e: number; n: number };

/**
 * What the canvas is showing.
 *
 * `mpp` is metres per CSS pixel, NOT per device pixel. Everything drawn on this
 * screen — handle sizes, line widths, the grab radius of the facing arrow — is
 * authored in CSS pixels, so the geometry has to be too or a retina laptop and
 * an external monitor disagree about how big a grab target is.
 */
export type MapView = {
  centreE: number;
  centreN: number;
  mpp: number;
  widthPx: number;
  heightPx: number;
};

/** Where the deal is, which is the origin every stored panel is measured from. */
export type Origin = { lat: number; lng: number };

/** One piece of imagery, and the rectangle of canvas it covers. In CSS pixels. */
export type TileDraw = {
  /** Stable across pans at the same zoom, so the cache survives a drag. */
  key: string;
  url: string;
  /**
   * Esri is fetched straight from the browser and must be requested as a CORS
   * image, or drawing it TAINTS THE CANVAS and `toBlob` throws — which would
   * silently cost the customer their layout picture on save. Google goes
   * through our own proxy and is same-origin, where `crossOrigin` is noise.
   */
  cors: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
};

/** The imagery a rep can put behind the panels. */
export type BasemapSource = "satellite" | "hybrid" | "esri" | "road";

export const BASEMAP_SOURCES: BasemapSource[] = ["satellite", "hybrid", "esri", "road"];

export const BASEMAP_LABEL: Record<BasemapSource, string> = {
  satellite: "Satellite",
  hybrid: "Hybrid",
  esri: "Esri",
  road: "Road",
};

/**
 * What each one is FOR, in the words of the problem it solves. These are the
 * button tooltips, and they are the only place a rep is told that flipping
 * vendors is how you deal with a house too new to be photographed.
 */
export const BASEMAP_HINT: Record<BasemapSource, string> = {
  satellite: "Google's aerial photo, no labels. This is what the customer's layout picture is drawn on.",
  hybrid: "Google's photo with street names and house numbers over it — how you check you are on the right roof.",
  esri: "A different vendor, flown on a different schedule. Worth a look when Google's photo predates the house.",
  road: "The street map. A new subdivision is platted here long before any aerial shows the houses.",
};

/** Google's deepest Static Maps imagery. Asking for 22 returns 21 in disguise. */
export const GOOGLE_MAX_ZOOM = 21;
/** Esri's deepest real World Imagery here; above it comes the grey "not yet available" tile. */
export const ESRI_MAX_ZOOM = 20;
/** Wide enough to see the subdivision and where it sits on the road network. */
export const MIN_ZOOM = 15;

/** A Static Maps supertile, in CSS pixels: 640 logical at scale=2. */
export const SUPERTILE_PX = 1280;

/**
 * How far from the deal a rep may pan, in supertiles.
 *
 * This is a SECURITY bound, not a usability one. The imagery route takes a
 * lead id and derives the coordinate server-side precisely so that it cannot be
 * used as a general-purpose satellite proxy billed to this company; accepting a
 * free lat/lng from the browser would throw that away. A bounded offset from
 * the deal's own point keeps the property and still covers a quarter of a
 * kilometre in every direction, which is more than enough to find a house the
 * geocoder put on the wrong side of the street.
 */
export const SUPERTILE_RADIUS = 6;

/** Metres per degree of latitude. Good to a part in a thousand anywhere. */
const M_PER_DEG_LAT = 111_320;

/**
 * How far a rep may drag the pin, in metres.
 *
 * Correcting a geocode means moving across a street or along a block; it never
 * means moving to the next town. The bound is what keeps a mis-drag, or a
 * malicious payload, from quietly relocating a deal — and with it the weather
 * station its production is simulated against and the roof its picture is of.
 */
export const MAX_PIN_MOVE_M = 400;

/**
 * May the deal's coordinate be moved from `from` to `to`?
 *
 * Pure, and shared by the server action that enforces it, so the rule is stated
 * once rather than as a second copy of the trigonometry inside a "use server"
 * module where nothing can reach it to test.
 */
export function pinMoveAllowed(from: Origin, to: Origin): boolean {
  const d = latLngToMetres(from, to);
  return Number.isFinite(d.e) && Number.isFinite(d.n) && Math.hypot(d.e, d.n) <= MAX_PIN_MOVE_M;
}

/** Ground metres from the origin → a real coordinate. */
export function metresToLatLng(origin: Origin, v: Vec): Origin {
  return {
    lat: origin.lat + v.n / M_PER_DEG_LAT,
    lng: origin.lng + v.e / (M_PER_DEG_LAT * Math.cos((origin.lat * Math.PI) / 180)),
  };
}

/** A real coordinate → ground metres from the origin. The inverse of the above. */
export function latLngToMetres(origin: Origin, p: Origin): Vec {
  return {
    e: (p.lng - origin.lng) * M_PER_DEG_LAT * Math.cos((origin.lat * Math.PI) / 180),
    n: (p.lat - origin.lat) * M_PER_DEG_LAT,
  };
}

/** Ground metres → a pixel on the canvas. North is up; east is right. */
export function groundToCanvas(view: MapView, v: Vec): { x: number; y: number } {
  return {
    x: view.widthPx / 2 + (v.e - view.centreE) / view.mpp,
    y: view.heightPx / 2 - (v.n - view.centreN) / view.mpp,
  };
}

/** A pixel on the canvas → ground metres. The inverse of the above. */
export function canvasToGround(view: MapView, p: { x: number; y: number }): Vec {
  return {
    e: view.centreE + (p.x - view.widthPx / 2) * view.mpp,
    n: view.centreN - (p.y - view.heightPx / 2) * view.mpp,
  };
}

/** The ground rectangle the view is showing, in metres from the origin. */
export function viewBounds(view: MapView): { minE: number; maxE: number; minN: number; maxN: number } {
  const halfW = (view.widthPx / 2) * view.mpp;
  const halfH = (view.heightPx / 2) * view.mpp;
  return {
    minE: view.centreE - halfW,
    maxE: view.centreE + halfW,
    minN: view.centreN - halfH,
    maxN: view.centreN + halfH,
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * The most tiles either grid will ever emit for one view.
 *
 * NOT a performance tuning knob — a fuse. A view zoomed out past the widest
 * zoom a source is offered at makes each tile smaller than the pixel budget
 * assumes, and the grid arithmetic answers that honestly by asking for tens of
 * millions of them. The first run of these tests killed the worker process
 * doing exactly that. The designer clamps its own scale so it cannot happen
 * from the UI, but a pure function that can exhaust memory on a plausible
 * argument is a landmine whoever calls it next steps on.
 *
 * Sixty-four covers any real screen with room to spare: a 4K canvas at a
 * source's native zoom needs about a dozen supertiles or fifty Esri tiles.
 */
const MAX_TILES = 64;

/**
 * Narrow a tile range to fit the budget, keeping the tiles NEAREST THE CENTRE.
 *
 * Which tiles get dropped matters: the roof being drawn on is in the middle of
 * the screen, so the edges are what can go.
 */
function budgetedRange(
  lo: number,
  hi: number,
  centre: number,
  budget: number
): { lo: number; hi: number } {
  const span = hi - lo + 1;
  if (span <= budget) return { lo, hi };
  const half = Math.floor((budget - 1) / 2);
  const c = clamp(Math.round(centre), lo, hi);
  return { lo: Math.max(lo, c - half), hi: Math.min(hi, c - half + budget - 1) };
}

/**
 * The zoom to ASK a source for, given how big the view wants a metre to be.
 *
 * Rounded rather than floored so the imagery is the nearest match to what is on
 * screen; capped at the source's last real zoom, past which the caller draws
 * what it got, magnified.
 */
export function imageryZoom(
  lat: number,
  mpp: number,
  scale: 1 | 2,
  maxZoom: number
): number {
  if (!(mpp > 0)) return maxZoom;
  return clamp(Math.round(zoomForMetresPerPixel(lat, mpp, scale)), MIN_ZOOM, maxZoom);
}

/** Is this source served by Google Static Maps (as opposed to Esri)? */
export function isGoogleSource(source: BasemapSource): boolean {
  return source !== "esri";
}

/** The Static Maps `maptype` behind each of our Google sources. */
export function staticMapType(source: BasemapSource): "satellite" | "hybrid" | "roadmap" {
  if (source === "hybrid") return "hybrid";
  if (source === "road") return "roadmap";
  return "satellite";
}

/**
 * The Google supertiles covering a view, as draw instructions.
 *
 * THE GRID IS ANCHORED ON THE DEAL, not on the world. Supertile (0,0) is
 * centred exactly on the deal's coordinate and each step is one supertile of
 * ground. Two things fall out of that, both wanted:
 *
 *   - A tile is addressed as an offset from a lead, so the imagery route never
 *     has to accept a coordinate from the browser (see SUPERTILE_RADIUS).
 *   - Static Maps centres an image on precisely the point it is given, so a
 *     grid built from tile centres aligns exactly. There is no seam to chase.
 *
 * Tiles outside the radius are simply not returned: the route would refuse them
 * anyway, and a request that is going to 400 is not worth making.
 */
export function googleSupertiles(
  view: MapView,
  origin: Origin,
  opts: { leadId: string; source: BasemapSource; zoom?: number }
): TileDraw[] {
  // An explicit zoom is how the backdrop is drawn: the previous zoom's tiles,
  // already in the cache, placed correctly for the CURRENT view, so changing
  // zoom fades between two pictures instead of flashing through black.
  const z = opts.zoom ?? imageryZoom(origin.lat, view.mpp, 2, GOOGLE_MAX_ZOOM);
  // Metres of ground per supertile pixel, then per whole supertile.
  const tileMpp = metresPerPixel(origin.lat, z, 2);
  const sideM = SUPERTILE_PX * tileMpp;
  if (!(sideM > 0)) return [];

  const b = viewBounds(view);
  // Tile tx spans e ∈ [(tx−½)·side, (tx+½)·side), so the index of a point is
  // its position shifted by half a tile and floored.
  const side = Math.floor(Math.sqrt(MAX_TILES));
  const { lo: txMin, hi: txMax } = budgetedRange(
    Math.floor(b.minE / sideM + 0.5),
    Math.floor(b.maxE / sideM + 0.5),
    view.centreE / sideM,
    side
  );
  // North is up, so ty counts DOWN as n goes up.
  const { lo: tyMin, hi: tyMax } = budgetedRange(
    Math.floor(-b.maxN / sideM + 0.5),
    Math.floor(-b.minN / sideM + 0.5),
    -view.centreN / sideM,
    side
  );

  const type = staticMapType(opts.source);
  const out: TileDraw[] = [];
  const sizePx = sideM / view.mpp;
  for (let ty = tyMin; ty <= tyMax; ty++) {
    for (let tx = txMin; tx <= txMax; tx++) {
      if (Math.abs(tx) > SUPERTILE_RADIUS || Math.abs(ty) > SUPERTILE_RADIUS) continue;
      const centre = groundToCanvas(view, { e: tx * sideM, n: -ty * sideM });
      out.push({
        key: `g:${opts.leadId}:${type}:${z}:${tx}:${ty}`,
        url: `/api/property/satellite?leadId=${encodeURIComponent(opts.leadId)}&type=${type}&zoom=${z}&tx=${tx}&ty=${ty}`,
        cors: false,
        x: centre.x - sizePx / 2,
        y: centre.y - sizePx / 2,
        w: sizePx,
        h: sizePx,
      });
    }
  }
  return out;
}

/** World pixel coordinate at a zoom, on the standard 256-pixel Web Mercator grid. */
export function worldPx(lat: number, lng: number, z: number): { x: number; y: number } {
  const n = 256 * 2 ** z;
  const rad = (Math.min(85.05112878, Math.max(-85.05112878, lat)) * Math.PI) / 180;
  return {
    x: ((lng + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n,
  };
}

/**
 * The Esri World Imagery tiles covering a view.
 *
 * Unlike the Google grid these are real XYZ tiles on the world grid, so they
 * are placed through exact Web Mercator rather than the local metres
 * approximation — the arithmetic is cheap and it removes a source of drift
 * between two layers a rep flips between while judging whether a roof is there.
 *
 * Fetched straight from arcgisonline: it needs no key and answers with
 * `Access-Control-Allow-Origin: *`, so a CORS image both draws and leaves the
 * canvas clean enough to export.
 */
export function esriTiles(view: MapView, origin: Origin, zoomOverride?: number): TileDraw[] {
  const z = zoomOverride ?? imageryZoom(origin.lat, view.mpp, 1, ESRI_MAX_ZOOM);
  const centre = metresToLatLng(origin, { e: view.centreE, n: view.centreN });
  const centreWorld = worldPx(centre.lat, centre.lng, z);
  const tileMpp = metresPerPixel(centre.lat, z, 1);
  // Canvas pixels per world pixel: 1 when the view matches the tile's own zoom.
  const k = tileMpp / view.mpp;
  const sizePx = 256 * k;
  if (!(sizePx > 0)) return [];

  const originWorldX = centreWorld.x - view.widthPx / 2 / k;
  const originWorldY = centreWorld.y - view.heightPx / 2 / k;
  const span = 2 ** z;
  const side = Math.floor(Math.sqrt(MAX_TILES));
  const { lo: txMin, hi: txMax } = budgetedRange(
    Math.floor(originWorldX / 256),
    Math.floor((originWorldX + view.widthPx / k) / 256),
    centreWorld.x / 256,
    side
  );
  const { lo: tyMin, hi: tyMax } = budgetedRange(
    Math.floor(originWorldY / 256),
    Math.floor((originWorldY + view.heightPx / k) / 256),
    centreWorld.y / 256,
    side
  );

  const out: TileDraw[] = [];
  for (let ty = tyMin; ty <= tyMax; ty++) {
    if (ty < 0 || ty >= span) continue;
    for (let tx = txMin; tx <= txMax; tx++) {
      // Wrap east–west rather than dropping tiles at the antimeridian.
      const wx = ((tx % span) + span) % span;
      out.push({
        key: `e:${z}:${wx}:${ty}`,
        // {z}/{y}/{x} — Esri's MapServer takes row before column.
        url: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${ty}/${wx}`,
        cors: true,
        x: (tx * 256 - originWorldX) * k,
        y: (ty * 256 - originWorldY) * k,
        w: sizePx,
        h: sizePx,
      });
    }
  }
  return out;
}

/** Every tile behind a view, whichever vendor is showing. */
export function tilesForView(
  view: MapView,
  origin: Origin,
  opts: { leadId: string; source: BasemapSource; zoom?: number }
): TileDraw[] {
  return opts.source === "esri"
    ? esriTiles(view, origin, opts.zoom)
    : googleSupertiles(view, origin, opts);
}

/** The credit line each vendor requires under its imagery. */
export function attribution(source: BasemapSource): string {
  return source === "esri"
    ? "Esri, Maxar, Earthstar Geographics"
    : "Google";
}

/**
 * Is the view showing imagery magnified past what the vendor actually has?
 *
 * Drives the one-line note on screen. A rep zoomed into a blur deserves to be
 * told it is a blur rather than left to wonder whether the roof is out of
 * focus or the house is.
 */
export function isUpsampled(source: BasemapSource, lat: number, mpp: number): boolean {
  const scale: 1 | 2 = source === "esri" ? 1 : 2;
  const max = source === "esri" ? ESRI_MAX_ZOOM : GOOGLE_MAX_ZOOM;
  return zoomForMetresPerPixel(lat, mpp, scale) > max + 0.5;
}

/**
 * A view framed on a set of points, with a margin — used to render the picture
 * the customer receives.
 *
 * The exported layout used to be whatever fixed frame the designer opened on,
 * which was fine while the frame could not move and wrong the moment it could:
 * a rep who panned to the real house would have sent a photograph of the
 * geocoder's guess. Framing on the ARRAY makes the export independent of wherever
 * the rep happened to leave the map.
 */
export function frameOn(
  points: Vec[],
  size: { widthPx: number; heightPx: number },
  opts: { marginM?: number; minSpanM?: number; fallback?: MapView } = {}
): MapView {
  const margin = opts.marginM ?? 6;
  const minSpan = opts.minSpanM ?? 30;
  if (points.length === 0) {
    return (
      opts.fallback ?? { centreE: 0, centreN: 0, mpp: minSpan / size.widthPx, ...size }
    );
  }
  let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity;
  for (const p of points) {
    minE = Math.min(minE, p.e); maxE = Math.max(maxE, p.e);
    minN = Math.min(minN, p.n); maxN = Math.max(maxN, p.n);
  }
  const spanE = Math.max(maxE - minE + margin * 2, minSpan);
  const spanN = Math.max(maxN - minN + margin * 2, minSpan);
  return {
    centreE: (minE + maxE) / 2,
    centreN: (minN + maxN) / 2,
    // The looser axis decides, so nothing is cropped out of the picture.
    mpp: Math.max(spanE / size.widthPx, spanN / size.heightPx),
    ...size,
  };
}


/**
 * The single Static Maps image that covers a view, for the customer's picture.
 *
 * NOT a mosaic, deliberately — see the note on fractional offsets in
 * `server/modules/property/satellite`. Each Static Maps image carries Google's
 * logo and imagery credit baked into its corners, so a picture assembled from
 * four of them carries four. One image carries one, which is both what the
 * licence asks for and what a document sent to a homeowner should look like.
 *
 * Returns the URL and the exact view it covers — the view is an OUTPUT, because
 * the image is a fixed 1280 px square at a whole zoom and the caller's requested
 * scale has to be snapped to that or the panels drawn on it are the wrong size.
 */
export function singleImageView(
  want: MapView,
  origin: Origin,
  opts: { leadId: string; source: BasemapSource }
): { url: string; view: MapView } | null {
  // Floor, not round: erring wider keeps the whole array inside the frame,
  // where erring closer would crop panels out of the customer's own picture.
  const z = clamp(
    Math.floor(zoomForMetresPerPixel(origin.lat, want.mpp, 2)),
    MIN_ZOOM,
    GOOGLE_MAX_ZOOM
  );
  const mpp = metresPerPixel(origin.lat, z, 2);
  const sideM = SUPERTILE_PX * mpp;
  if (!(sideM > 0)) return null;

  const tx = want.centreE / sideM;
  const ty = -want.centreN / sideM;
  // Outside what the imagery route will serve. The caller falls back to the
  // mosaic rather than saving a blank picture.
  if (Math.abs(tx) > SUPERTILE_RADIUS || Math.abs(ty) > SUPERTILE_RADIUS) return null;

  const type = staticMapType(opts.source);
  return {
    url: `/api/property/satellite?leadId=${encodeURIComponent(opts.leadId)}&type=${type}&zoom=${z}&tx=${tx.toFixed(6)}&ty=${ty.toFixed(6)}`,
    view: {
      centreE: want.centreE,
      centreN: want.centreN,
      mpp,
      widthPx: SUPERTILE_PX,
      heightPx: SUPERTILE_PX,
    },
  };
}
