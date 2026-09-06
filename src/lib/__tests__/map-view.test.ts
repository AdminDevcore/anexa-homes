import { describe, it, expect } from "vitest";
import {
  BASEMAP_SOURCES,
  ESRI_MAX_ZOOM,
  GOOGLE_MAX_ZOOM,
  SUPERTILE_PX,
  SUPERTILE_RADIUS,
  canvasToGround,
  esriTiles,
  frameOn,
  googleSupertiles,
  groundToCanvas,
  imageryZoom,
  isUpsampled,
  latLngToMetres,
  MAX_PIN_MOVE_M,
  pinMoveAllowed,
  singleImageView,
  metresToLatLng,
  staticMapType,
  tilesForView,
  viewBounds,
  worldPx,
  type MapView,
  type Origin,
} from "@/lib/map-view";
import { metresPerPixel } from "@/lib/web-mercator";

/**
 * The view the roof designer draws through.
 *
 * Every bug this file guards against costs money in the same way: a panel drawn
 * at the wrong scale or in the wrong place is a system size, a production
 * figure and a price that were never true of the roof.
 */

const PLANO: Origin = { lat: 33.0335, lng: -96.73 };

const view = (over: Partial<MapView> = {}): MapView => ({
  centreE: 0,
  centreN: 0,
  mpp: metresPerPixel(PLANO.lat, 21, 2),
  widthPx: 1200,
  heightPx: 800,
  ...over,
});

describe("ground ↔ canvas", () => {
  it("puts the view's centre in the middle of the canvas", () => {
    const v = view({ centreE: 12, centreN: -7 });
    const p = groundToCanvas(v, { e: 12, n: -7 });
    expect(p.x).toBeCloseTo(600, 9);
    expect(p.y).toBeCloseTo(400, 9);
  });

  it("puts the deal's own coordinate in the middle when nothing has been panned", () => {
    const p = groundToCanvas(view(), { e: 0, n: 0 });
    expect(p).toEqual({ x: 600, y: 400 });
  });

  it("runs east to the right and north UP, which is the whole convention", () => {
    const v = view();
    const east = groundToCanvas(v, { e: 10, n: 0 });
    const north = groundToCanvas(v, { e: 0, n: 10 });
    expect(east.x).toBeGreaterThan(600);
    expect(north.y).toBeLessThan(400);
  });

  it("round-trips, so a click lands where the thing that was clicked is drawn", () => {
    const v = view({ centreE: -31.5, centreN: 88.25, mpp: 0.042 });
    for (const p of [
      { x: 0, y: 0 },
      { x: 1200, y: 800 },
      { x: 613.5, y: 220.25 },
    ]) {
      const back = groundToCanvas(v, canvasToGround(v, p));
      expect(back.x).toBeCloseTo(p.x, 9);
      expect(back.y).toBeCloseTo(p.y, 9);
    }
  });

  /**
   * The regression that motivated the whole module. Panning used to be
   * impossible, so "the centre" and "the origin" were the same point and the
   * difference between them could not be got wrong. Now it can.
   */
  it("moves the picture and NOT the panels when the view is panned", () => {
    const still = view();
    const panned = view({ centreE: 20, centreN: 0 });
    const before = groundToCanvas(still, { e: 5, n: 0 });
    const after = groundToCanvas(panned, { e: 5, n: 0 });
    // The same panel, twenty metres of view to the east: it must slide LEFT on
    // screen by exactly twenty metres' worth of pixels, not stay put.
    expect(after.x).toBeCloseTo(before.x - 20 / still.mpp, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });
});

describe("view bounds", () => {
  it("covers exactly the canvas, in metres", () => {
    const v = view({ mpp: 0.05, widthPx: 1000, heightPx: 600, centreE: 3, centreN: 4 });
    const b = viewBounds(v);
    expect(b.maxE - b.minE).toBeCloseTo(50, 9);
    expect(b.maxN - b.minN).toBeCloseTo(30, 9);
    expect((b.minE + b.maxE) / 2).toBeCloseTo(3, 9);
    expect((b.minN + b.maxN) / 2).toBeCloseTo(4, 9);
  });
});

describe("metres ↔ lat/lng", () => {
  it("round-trips over the couple of hundred metres a rep can pan", () => {
    for (const v of [
      { e: 0, n: 0 },
      { e: 240, n: -180 },
      { e: -95.5, n: 61.25 },
    ]) {
      const back = latLngToMetres(PLANO, metresToLatLng(PLANO, v));
      expect(back.e).toBeCloseTo(v.e, 6);
      expect(back.n).toBeCloseTo(v.n, 6);
    }
  });

  it("puts north above and east to the right of the origin", () => {
    const p = metresToLatLng(PLANO, { e: 100, n: 100 });
    expect(p.lat).toBeGreaterThan(PLANO.lat);
    expect(p.lng).toBeGreaterThan(PLANO.lng);
  });

  it("needs more degrees of longitude than of latitude for the same distance", () => {
    // Because a degree of longitude is shorter this far from the equator.
    const p = metresToLatLng(PLANO, { e: 100, n: 100 });
    expect(p.lng - PLANO.lng).toBeGreaterThan(p.lat - PLANO.lat);
  });
});

describe("imagery zoom", () => {
  it("asks for the zoom whose own resolution matches the view", () => {
    const z = 19;
    const mpp = metresPerPixel(PLANO.lat, z, 2);
    expect(imageryZoom(PLANO.lat, mpp, 2, GOOGLE_MAX_ZOOM)).toBe(z);
  });

  /**
   * MEASURED, not assumed: a Static Maps request at zoom 22 came back
   * byte-identical to the same request at 21 — same MD5, same dimensions, HTTP
   * 200. Google clamps and says nothing. A view that asked for 22 and did its
   * arithmetic as though it had got 22 would draw every panel at half size.
   */
  it("never asks Google for deeper than 21, which it silently refuses to serve", () => {
    const tiny = metresPerPixel(PLANO.lat, 24, 2);
    expect(imageryZoom(PLANO.lat, tiny, 2, GOOGLE_MAX_ZOOM)).toBe(GOOGLE_MAX_ZOOM);
  });

  it("never asks Esri for deeper than 20, where it returns a grey 'not yet available' tile", () => {
    const tiny = metresPerPixel(PLANO.lat, 24, 1);
    expect(imageryZoom(PLANO.lat, tiny, 1, ESRI_MAX_ZOOM)).toBe(ESRI_MAX_ZOOM);
  });

  it("stops widening at the zoom that still shows a subdivision", () => {
    expect(imageryZoom(PLANO.lat, 500, 2, GOOGLE_MAX_ZOOM)).toBe(15);
  });

  it("survives a degenerate scale rather than returning NaN into the tile maths", () => {
    expect(imageryZoom(PLANO.lat, 0, 2, GOOGLE_MAX_ZOOM)).toBe(GOOGLE_MAX_ZOOM);
  });
});

describe("google supertiles", () => {
  const origin = PLANO;

  it("covers the whole canvas, leaving no gap for the background to show through", () => {
    const v = view();
    const tiles = googleSupertiles(v, origin, { leadId: "L1", source: "satellite" });
    expect(tiles.length).toBeGreaterThan(0);
    const left = Math.min(...tiles.map((t) => t.x));
    const top = Math.min(...tiles.map((t) => t.y));
    const right = Math.max(...tiles.map((t) => t.x + t.w));
    const bottom = Math.max(...tiles.map((t) => t.y + t.h));
    expect(left).toBeLessThanOrEqual(0);
    expect(top).toBeLessThanOrEqual(0);
    expect(right).toBeGreaterThanOrEqual(v.widthPx);
    expect(bottom).toBeGreaterThanOrEqual(v.heightPx);
  });

  it("tiles edge to edge with no seam and no overlap", () => {
    const tiles = googleSupertiles(view(), origin, { leadId: "L1", source: "satellite" });
    const xs = [...new Set(tiles.map((t) => Math.round(t.x * 1e6) / 1e6))].sort((a, b) => a - b);
    const w = tiles[0].w;
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeCloseTo(w, 6);
  });

  it("centres supertile (0,0) exactly on the deal, so the house opens in the middle", () => {
    const v = view();
    const t = googleSupertiles(v, origin, { leadId: "L1", source: "satellite" }).find((t) =>
      t.key.endsWith(":0:0")
    )!;
    expect(t.x + t.w / 2).toBeCloseTo(v.widthPx / 2, 6);
    expect(t.y + t.h / 2).toBeCloseTo(v.heightPx / 2, 6);
  });

  it("draws a supertile at its native size when the view matches its zoom", () => {
    const v = view({ mpp: metresPerPixel(origin.lat, GOOGLE_MAX_ZOOM, 2) });
    const t = googleSupertiles(v, origin, { leadId: "L1", source: "satellite" })[0];
    expect(t.w).toBeCloseTo(SUPERTILE_PX, 6);
  });

  it("refuses to address imagery further out than the pan bound allows", () => {
    // A view a kilometre east of the deal: every tile it wants is out of range.
    const far = view({ centreE: 5000, mpp: metresPerPixel(origin.lat, 21, 2) });
    expect(googleSupertiles(far, origin, { leadId: "L1", source: "satellite" })).toHaveLength(0);
  });

  it("keeps every tile it does return inside the bound the route enforces", () => {
    const v = view({ mpp: 5, widthPx: 2000, heightPx: 2000 });
    for (const t of googleSupertiles(v, origin, { leadId: "L1", source: "satellite" })) {
      const [, , , , tx, ty] = t.key.split(":");
      expect(Math.abs(Number(tx))).toBeLessThanOrEqual(SUPERTILE_RADIUS);
      expect(Math.abs(Number(ty))).toBeLessThanOrEqual(SUPERTILE_RADIUS);
    }
  });

  it("addresses imagery by lead and offset, never by a coordinate from the browser", () => {
    for (const t of googleSupertiles(view(), origin, { leadId: "L1", source: "satellite" })) {
      expect(t.url).toContain("leadId=L1");
      expect(t.url).not.toMatch(/lat=|lng=|center=/);
    }
  });

  it("goes through our own proxy, so the API key stays on the server", () => {
    for (const t of googleSupertiles(view(), origin, { leadId: "L1", source: "satellite" })) {
      expect(t.url.startsWith("/api/")).toBe(true);
      expect(t.cors).toBe(false);
    }
  });

  it("keys a tile by everything that changes its picture", () => {
    const v = view();
    const a = googleSupertiles(v, origin, { leadId: "L1", source: "satellite" })[0].key;
    const b = googleSupertiles(v, origin, { leadId: "L1", source: "hybrid" })[0].key;
    const c = googleSupertiles(v, origin, { leadId: "L2", source: "satellite" })[0].key;
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it("keeps its keys stable while a rep drags, so the cache survives the pan", () => {
    const before = googleSupertiles(view(), origin, { leadId: "L1", source: "satellite" });
    const after = googleSupertiles(view({ centreE: 3, centreN: -2 }), origin, {
      leadId: "L1",
      source: "satellite",
    });
    const shared = after.filter((t) => before.some((b) => b.key === t.key));
    expect(shared.length).toBeGreaterThan(0);
  });
});

describe("esri tiles", () => {
  it("covers the whole canvas", () => {
    const v = view({ mpp: metresPerPixel(PLANO.lat, ESRI_MAX_ZOOM, 1) });
    const tiles = esriTiles(v, PLANO);
    expect(tiles.length).toBeGreaterThan(0);
    expect(Math.min(...tiles.map((t) => t.x))).toBeLessThanOrEqual(0);
    expect(Math.min(...tiles.map((t) => t.y))).toBeLessThanOrEqual(0);
    expect(Math.max(...tiles.map((t) => t.x + t.w))).toBeGreaterThanOrEqual(v.widthPx);
    expect(Math.max(...tiles.map((t) => t.y + t.h))).toBeGreaterThanOrEqual(v.heightPx);
  });

  it("lands the tile the deal sits in over the middle of the canvas", () => {
    const v = view({ mpp: metresPerPixel(PLANO.lat, ESRI_MAX_ZOOM, 1) });
    const z = ESRI_MAX_ZOOM;
    const w = worldPx(PLANO.lat, PLANO.lng, z);
    const t = esriTiles(v, PLANO).find(
      (t) => t.key === `e:${z}:${Math.floor(w.x / 256)}:${Math.floor(w.y / 256)}`
    )!;
    expect(t).toBeDefined();
    // The deal's own world pixel, placed through the tile's rectangle, has to
    // come back to the centre of the screen.
    expect(t.x + ((w.x % 256) / 256) * t.w).toBeCloseTo(v.widthPx / 2, 4);
    expect(t.y + ((w.y % 256) / 256) * t.h).toBeCloseTo(v.heightPx / 2, 4);
  });

  /**
   * Drawing a plain cross-origin image onto the canvas taints it, and a tainted
   * canvas throws on `toBlob` — which is how the customer's layout picture is
   * made. The failure would be invisible until save.
   */
  it("asks for Esri imagery as a CORS image so the canvas can still be exported", () => {
    for (const t of esriTiles(view(), PLANO)) expect(t.cors).toBe(true);
  });

  it("uses Esri's row-before-column tile path", () => {
    const t = esriTiles(view({ mpp: metresPerPixel(PLANO.lat, 20, 1) }), PLANO)[0];
    const [, z, x, y] = t.key.split(":");
    expect(t.url).toMatch(new RegExp(`/tile/${z}/${y}/${x}$`));
  });

  it("never asks for a row off the top or bottom of the world", () => {
    const arctic: Origin = { lat: 84.9, lng: 0 };
    for (const t of esriTiles(view({ mpp: 0.6 }), arctic)) {
      const ty = Number(t.key.split(":")[3]);
      expect(ty).toBeGreaterThanOrEqual(0);
    }
  });
});

/**
 * The first run of this file killed the vitest worker outright. A view scaled
 * far wider than any source is offered at makes every tile sub-pixel, and the
 * grid arithmetic answered that faithfully by asking for tens of millions of
 * them. Nothing in the designer can produce such a view — but nothing in these
 * functions said so either, and the next caller would have found out the same
 * way.
 */
describe("the tile budget", () => {
  const absurd = view({ mpp: 5000, widthPx: 4000, heightPx: 4000 });

  it("stays finite on a view no source could ever fill", () => {
    expect(googleSupertiles(absurd, PLANO, { leadId: "L1", source: "satellite" }).length)
      .toBeLessThanOrEqual(64);
    expect(esriTiles(absurd, PLANO).length).toBeLessThanOrEqual(64);
  });

  it("spends what it has on the middle of the screen, where the roof is", () => {
    const tiles = esriTiles(absurd, PLANO);
    if (tiles.length === 0) return;
    const centreX = absurd.widthPx / 2;
    const centreY = absurd.heightPx / 2;
    // Some tile has to still cover the centre pixel, or the rep is looking at
    // a blank middle with imagery only around the edges.
    expect(
      tiles.some(
        (t) => t.x <= centreX && t.x + t.w >= centreX && t.y <= centreY && t.y + t.h >= centreY
      )
    ).toBe(true);
  });

  it("still covers an ordinary screen completely, budget or no budget", () => {
    const real = view({ mpp: metresPerPixel(PLANO.lat, 21, 2), widthPx: 2560, heightPx: 1440 });
    for (const tiles of [
      googleSupertiles(real, PLANO, { leadId: "L1", source: "satellite" }),
      esriTiles(real, PLANO),
    ]) {
      expect(Math.min(...tiles.map((t) => t.x))).toBeLessThanOrEqual(0);
      expect(Math.max(...tiles.map((t) => t.x + t.w))).toBeGreaterThanOrEqual(real.widthPx);
      expect(Math.min(...tiles.map((t) => t.y))).toBeLessThanOrEqual(0);
      expect(Math.max(...tiles.map((t) => t.y + t.h))).toBeGreaterThanOrEqual(real.heightPx);
    }
  });
});

describe("choosing a vendor", () => {
  it("routes every Google-backed source through Static Maps and Esri to Esri", () => {
    for (const source of BASEMAP_SOURCES) {
      const tiles = tilesForView(view(), PLANO, { leadId: "L1", source });
      expect(tiles.length).toBeGreaterThan(0);
      const google = !tiles[0].url.includes("arcgisonline");
      expect(google).toBe(source !== "esri");
    }
  });

  it("maps our vendor-neutral names onto Google's own", () => {
    expect(staticMapType("satellite")).toBe("satellite");
    expect(staticMapType("hybrid")).toBe("hybrid");
    expect(staticMapType("road")).toBe("roadmap");
  });
});

describe("telling the rep the picture is a blur", () => {
  it("says nothing while the imagery is real", () => {
    expect(isUpsampled("satellite", PLANO.lat, metresPerPixel(PLANO.lat, 21, 2))).toBe(false);
    expect(isUpsampled("esri", PLANO.lat, metresPerPixel(PLANO.lat, 20, 1))).toBe(false);
  });

  it("owns up once the view is past what the vendor has", () => {
    expect(isUpsampled("satellite", PLANO.lat, metresPerPixel(PLANO.lat, 23, 2))).toBe(true);
    // Esri runs out a whole zoom before Google, and must say so a zoom earlier.
    expect(isUpsampled("esri", PLANO.lat, metresPerPixel(PLANO.lat, 22, 1))).toBe(true);
  });
});

describe("framing the customer's picture", () => {
  const size = { widthPx: 1280, heightPx: 1280 };

  it("centres on the array rather than on wherever the rep left the map", () => {
    const v = frameOn([{ e: 40, n: 60 }, { e: 60, n: 80 }], size);
    expect(v.centreE).toBeCloseTo(50, 9);
    expect(v.centreN).toBeCloseTo(70, 9);
  });

  it("fits the whole array in, with room around it", () => {
    const pts = [{ e: -10, n: -4 }, { e: 10, n: 4 }];
    const v = frameOn(pts, size, { marginM: 5 });
    const b = viewBounds(v);
    // Exactly the margin on the axis that decides the scale, and more than it
    // on the other — never less than it on either.
    expect(b.minE).toBeLessThanOrEqual(-15);
    expect(b.maxE).toBeGreaterThanOrEqual(15);
    expect(b.minN).toBeLessThan(-9);
    expect(b.maxN).toBeGreaterThan(9);
  });

  it("lets the tighter axis breathe rather than cropping the looser one", () => {
    // Wide and flat: width decides the scale, and the height must not crop.
    const v = frameOn([{ e: -50, n: -1 }, { e: 50, n: 1 }], size, { marginM: 0 });
    const b = viewBounds(v);
    expect(b.maxE - b.minE).toBeCloseTo(100, 6);
    expect(b.maxN - b.minN).toBeCloseTo(100, 6);
  });

  it("does not zoom into nothing when a single panel is all there is", () => {
    const v = frameOn([{ e: 0, n: 0 }], size, { minSpanM: 30 });
    expect(viewBounds(v).maxE - viewBounds(v).minE).toBeGreaterThanOrEqual(30);
  });

  it("falls back to the rep's own view when there is no array to frame", () => {
    const fallback = view();
    expect(frameOn([], size, { fallback })).toBe(fallback);
  });
});


/**
 * Correcting where the house is.
 *
 * A rep drags the pin when the geocoder framed the wrong roof — across a street,
 * along a block. The bound is what stops a mis-drag, or a crafted payload,
 * relocating a deal to another town along with the weather station its
 * production is simulated against.
 */
describe("moving the pin", () => {
  const at = (e: number, n: number) => metresToLatLng(PLANO, { e, n });

  it("allows the correction it exists for: the roof across the street", () => {
    expect(pinMoveAllowed(PLANO, at(25, -18))).toBe(true);
  });

  it("allows a move right up to the bound", () => {
    expect(pinMoveAllowed(PLANO, at(MAX_PIN_MOVE_M - 1, 0))).toBe(true);
  });

  it("refuses a move past it, in any direction", () => {
    for (const p of [
      at(MAX_PIN_MOVE_M + 10, 0),
      at(0, -MAX_PIN_MOVE_M - 10),
      at(MAX_PIN_MOVE_M, MAX_PIN_MOVE_M),
    ]) {
      expect(pinMoveAllowed(PLANO, p)).toBe(false);
    }
  });

  it("refuses another town outright", () => {
    expect(pinMoveAllowed(PLANO, { lat: 29.76, lng: -95.37 })).toBe(false);
  });

  it("refuses a coordinate that is not a number rather than letting NaN through", () => {
    // `NaN > limit` is false, so a naive bound would have ADMITTED this.
    expect(pinMoveAllowed(PLANO, { lat: NaN, lng: -96.73 })).toBe(false);
  });
});

/**
 * The customer's picture is ONE image, because every Static Maps square carries
 * Google's logo and imagery credit in its corners — and a mosaic carries one
 * set per tile, scattered across the middle of a document sent to a homeowner.
 */
describe("the single image behind the customer's layout", () => {
  const want = (over: Partial<MapView> = {}): MapView => ({
    centreE: 0,
    centreN: 0,
    mpp: metresPerPixel(PLANO.lat, 21, 2),
    widthPx: 1280,
    heightPx: 1280,
    ...over,
  });

  it("asks for exactly one image, through our own proxy", () => {
    const r = singleImageView(want(), PLANO, { leadId: "L1", source: "satellite" })!;
    expect(r.url.startsWith("/api/property/satellite?")).toBe(true);
    expect(r.url).toContain("leadId=L1");
  });

  it("centres it on the array, which needs an offset between grid points", () => {
    const r = singleImageView(want({ centreE: 17.5, centreN: -9 }), PLANO, {
      leadId: "L1",
      source: "satellite",
    })!;
    expect(r.view.centreE).toBeCloseTo(17.5, 9);
    expect(r.view.centreN).toBeCloseTo(-9, 9);
    // A whole-number offset could not express this, which is why the route
    // accepts fractions.
    const tx = Number(new URLSearchParams(r.url.split("?")[1]).get("tx"));
    expect(Number.isInteger(tx)).toBe(false);
  });

  it("snaps the scale to a zoom Google actually serves", () => {
    // The requested scale sits between two zooms; the returned view must use
    // the real one, or panels are drawn at a size the image does not match.
    const r = singleImageView(want({ mpp: 0.045 }), PLANO, { leadId: "L1", source: "satellite" })!;
    const z = Number(new URLSearchParams(r.url.split("?")[1]).get("zoom"));
    expect(Number.isInteger(z)).toBe(true);
    expect(r.view.mpp).toBeCloseTo(metresPerPixel(PLANO.lat, z, 2), 12);
  });

  it("errs WIDER, so nothing is cropped out of the customer's picture", () => {
    const asked = 0.045;
    const r = singleImageView(want({ mpp: asked }), PLANO, { leadId: "L1", source: "satellite" })!;
    expect(r.view.mpp).toBeGreaterThanOrEqual(asked);
  });

  it("never asks deeper than Google serves, however tight the array", () => {
    const r = singleImageView(want({ mpp: 0.0001 }), PLANO, { leadId: "L1", source: "satellite" })!;
    const z = Number(new URLSearchParams(r.url.split("?")[1]).get("zoom"));
    expect(z).toBe(GOOGLE_MAX_ZOOM);
  });

  it("declines rather than requesting ground the route will refuse", () => {
    expect(singleImageView(want({ centreE: 100_000 }), PLANO, { leadId: "L1", source: "satellite" }))
      .toBeNull();
  });

  it("keeps the vendor it was given", () => {
    const r = singleImageView(want(), PLANO, { leadId: "L1", source: "hybrid" })!;
    expect(r.url).toContain("type=hybrid");
  });
});
