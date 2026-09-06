import { describe, it, expect } from "vitest";
import {
  staticMapUrl,
  satelliteConfigured,
  parseZoomParam,
  DEFAULT_ZOOM,
  clampSide,
  staticMapPixelSize,
  STATIC_MAP_MAX_PX,
  MAX_STATIC_ZOOM,
  MIN_STATIC_ZOOM,
  parseMapType,
  parseSupertile,
  supertileCentre,
} from "@/server/modules/property/satellite";
import { SUPERTILE_PX, SUPERTILE_RADIUS, latLngToMetres } from "@/lib/map-view";
import { metresPerPixel } from "@/lib/web-mercator";
// Geocoding moved to geo/ — it answers "where is this house" for the canvassing
// map and the skip-trace too, not just for this picture.
import { parseGoogleGeocode, geocodeStatusReason } from "@/server/modules/geo/google";

describe("zoom query parameter", () => {
  // The regression this exists for: an ABSENT param used to become zoom 1 and
  // every deal showed a picture of the whole planet. `Number(null)` is 0, not
  // NaN, so the old `Number.isFinite()` fallback never fired.
  it("falls back to the roof-framing default when the param is absent", () => {
    expect(parseZoomParam(null)).toBe(DEFAULT_ZOOM);
    expect(parseZoomParam(undefined)).toBe(DEFAULT_ZOOM);
  });

  it("falls back for blank and non-numeric values", () => {
    for (const raw of ["", "   ", "abc", "NaN"]) {
      expect(parseZoomParam(raw)).toBe(DEFAULT_ZOOM);
    }
  });

  it("never returns a whole-planet zoom by accident", () => {
    for (const raw of [null, undefined, "", "abc"]) {
      expect(parseZoomParam(raw)).toBeGreaterThanOrEqual(19);
    }
  });

  it("honours an explicit zoom, clamped to what Google will serve", () => {
    expect(parseZoomParam("18")).toBe(18);
    expect(parseZoomParam("19.6")).toBe(20);
    expect(parseZoomParam("0")).toBe(1); // explicit 0 IS a request; clamp it
    expect(parseZoomParam("-5")).toBe(1);
    expect(parseZoomParam("99")).toBe(21);
  });
});

describe("static map URL", () => {
  const url = (over = {}) =>
    new URL(staticMapUrl("TESTKEY", { lat: 32.7767, lng: -96.797, ...over }));

  it("centres on the deal's coordinates and defaults to satellite", () => {
    const u = url();
    expect(u.searchParams.get("center")).toBe("32.7767,-96.797");
    expect(u.searchParams.get("maptype")).toBe("satellite");
  });

  it("defaults to a zoom that frames a roof, not a neighbourhood", () => {
    expect(url().searchParams.get("zoom")).toBe(String(DEFAULT_ZOOM));
    expect(DEFAULT_ZOOM).toBeGreaterThanOrEqual(19);
  });

  it("switches to roadmap for the Map half of the toggle", () => {
    expect(url({ type: "roadmap" }).searchParams.get("maptype")).toBe("roadmap");
  });

  it("requests HiDPI so the roof is not a blurry mess on a laptop screen", () => {
    expect(url().searchParams.get("scale")).toBe("2");
  });

  // If this ever regresses, the key ends up in an <img src> in the browser.
  it("carries the key — which is why this URL is only ever built server-side", () => {
    expect(url().searchParams.get("key")).toBe("TESTKEY");
    expect(staticMapUrl("TESTKEY", { lat: 1, lng: 2 })).toContain("maps.googleapis.com");
  });
});

describe("geocode parsing", () => {
  const ok = {
    status: "OK",
    results: [
      {
        formatted_address: "500 Test Ave, Dallas, TX 75201, USA",
        geometry: { location: { lat: 32.7767, lng: -96.797 } },
      },
    ],
  };

  it("reads the first result", () => {
    expect(parseGoogleGeocode(ok)).toEqual({
      lat: 32.7767,
      lng: -96.797,
      formatted: "500 Test Ave, Dallas, TX 75201, USA",
      // Google omits location_type on this fixture; null, not undefined, so the
      // "we don't know how precise this is" case is explicit.
      precision: null,
    });
  });

  it("prefers a ROOFTOP match over a coarser one, whatever the order", () => {
    const mixed = {
      status: "OK",
      results: [
        {
          formatted_address: "75201, USA",
          geometry: { location: { lat: 1, lng: 1 }, location_type: "APPROXIMATE" },
        },
        {
          formatted_address: "500 Test Ave, Dallas, TX 75201, USA",
          geometry: { location: { lat: 2, lng: 2 }, location_type: "ROOFTOP" },
        },
      ],
    };
    // Taking results[0] blindly would centre the map on a postcode.
    expect(parseGoogleGeocode(mixed)).toMatchObject({ lat: 2, lng: 2, precision: "ROOFTOP" });
  });

  it("still returns an interpolated match when that is all Google has", () => {
    // The real 267 Big Bear Drive case: a new subdivision Google has not mapped
    // to a rooftop, so the point lands on the ROAD. Usable, but the caller needs
    // to know it is an estimate — hence `precision`.
    const interpolated = {
      status: "OK",
      results: [
        {
          formatted_address: "267 Big Bear Dr, Melissa, TX 75454, USA",
          geometry: {
            location: { lat: 33.2798313, lng: -96.5898469 },
            location_type: "RANGE_INTERPOLATED",
          },
        },
      ],
    };
    expect(parseGoogleGeocode(interpolated)).toMatchObject({
      precision: "RANGE_INTERPOLATED",
    });
  });

  // Google answers HTTP 200 for these. Trusting the HTTP code instead of the
  // status field is the classic way to ship a silently broken integration —
  // every one of these would otherwise look like a successful empty response.
  it("rejects ZERO_RESULTS despite the 200", () => {
    expect(parseGoogleGeocode({ status: "ZERO_RESULTS", results: [] })).toBeNull();
  });

  it("rejects REQUEST_DENIED — the shape of a bad or unenabled key", () => {
    expect(parseGoogleGeocode({ status: "REQUEST_DENIED", results: [] })).toBeNull();
  });

  it("rejects OVER_QUERY_LIMIT rather than treating it as no match", () => {
    expect(parseGoogleGeocode({ status: "OVER_QUERY_LIMIT" })).toBeNull();
  });

  it("survives junk instead of throwing", () => {
    for (const junk of [null, undefined, "", 42, [], { results: [{}] }]) {
      expect(parseGoogleGeocode(junk)).toBeNull();
    }
  });

  it("rejects a result whose coordinates are not numbers", () => {
    expect(
      parseGoogleGeocode({ status: "OK", results: [{ geometry: { location: { lat: "x", lng: 1 } } }] })
    ).toBeNull();
  });
});

describe("failure diagnosis", () => {
  // The two failures are indistinguishable in the UI but need different fixes,
  // so the server log has to tell them apart.
  it("names an unenabled key separately from an unmatched address", () => {
    expect(geocodeStatusReason({ status: "REQUEST_DENIED" })).toMatch(/Geocoding API/i);
    expect(geocodeStatusReason({ status: "ZERO_RESULTS" })).toMatch(/did not match/i);
    expect(geocodeStatusReason({ status: "OVER_QUERY_LIMIT" })).toMatch(/quota|billing/i);
  });
});

describe("graceful degradation when the key is absent", () => {
  // The feature must be inert, not broken, before the key is provisioned.
  it("reports unconfigured for missing or blank keys", () => {
    expect(satelliteConfigured(undefined)).toBe(false);
    expect(satelliteConfigured("")).toBe(false);
    expect(satelliteConfigured("   ")).toBe(false);
  });

  it("reports configured once a key is set", () => {
    expect(satelliteConfigured("AIza-whatever")).toBe(true);
  });
});

describe("the design canvas gets an unmarked image", () => {
  it("drops the pin when asked, so it cannot sit on the array", () => {
    const url = staticMapUrl("k", { lat: 32.7, lng: -96.8, marker: false });
    expect(url).not.toContain("markers");
  });

  it("still pins by default, because every other surface needs it", () => {
    expect(staticMapUrl("k", { lat: 32.7, lng: -96.8 })).toContain("markers");
  });
});

describe("Google's undocumented size clamp", () => {
  /**
   * The bug this guards. `size=1280x720` came back 200 OK as a 1280x1280
   * image: Google clamps EACH side to 640 independently, then scale=2 doubles
   * both. The designer drew that square into a 16:9 canvas, so every roof was
   * stretched 1.78x wide and the metres-per-pixel the panels were sized by was
   * wrong on both axes. Nothing in the response says it happened, so the only
   * defence is never to ask for more than will be given.
   */
  it("never asks for a side Google will silently shrink", () => {
    // BOTH sides of the old 1280x720 request are over the cap, which is why
    // the answer came back square: 640x640, doubled by scale=2 to 1280x1280.
    // Asking for it outright is the same picture, minus the surprise.
    const url = staticMapUrl("k", { lat: 32.7, lng: -96.8, width: 1280, height: 720 });
    expect(url).toContain(`size=${STATIC_MAP_MAX_PX}x${STATIC_MAP_MAX_PX}`);
  });

  it("passes a size within the cap through untouched", () => {
    const url = staticMapUrl("k", { lat: 32.7, lng: -96.8, width: 640, height: 640 });
    expect(url).toContain("size=640x640");
  });

  it("clamps a side rather than rejecting it", () => {
    expect(clampSide(2000)).toBe(STATIC_MAP_MAX_PX);
    expect(clampSide(400)).toBe(400);
    expect(clampSide(0)).toBe(1);
    expect(clampSide(Number.NaN)).toBe(STATIC_MAP_MAX_PX);
  });

  it("predicts the DEVICE pixels that will come back", () => {
    // The designer sizes its canvas and its ground scale from this, before the
    // picture has loaded.
    expect(staticMapPixelSize({ width: 640, height: 640, scale: 2 })).toEqual({
      widthPx: 1280,
      heightPx: 1280,
    });
    // The shape Google actually served for the designer's old request.
    expect(staticMapPixelSize({ width: 1280, height: 720, scale: 2 })).toEqual({
      widthPx: 1280,
      heightPx: 1280,
    });
    expect(staticMapPixelSize({ width: 400, height: 300, scale: 1 })).toEqual({
      widthPx: 400,
      heightPx: 300,
    });
  });
});


/**
 * The pannable grid the roof designer draws on.
 *
 * These tests are about ONE property above all: this route resolves the
 * coordinate itself, from a lead the caller already has access to. It is what
 * stops an authenticated session from becoming a general-purpose satellite
 * imagery proxy billed to this company, and it is only a property as long as
 * nothing in a request can name a place.
 */
describe("supertiles", () => {
  const origin = { lat: 33.0335, lng: -96.73 };
  const q = (o: Record<string, string>) => new URLSearchParams(o);

  it("is not a tile request at all when no tile is named", () => {
    expect(parseSupertile(q({ zoom: "21" }))).toBeNull();
  });

  it("reads a tile inside the bound", () => {
    expect(parseSupertile(q({ tx: "-2", ty: "3", zoom: "20" }))).toEqual({
      zoom: 20,
      tx: -2,
      ty: 3,
    });
  });

  it("refuses a tile past the pan bound rather than clamping it", () => {
    // Clamping would quietly serve a DIFFERENT piece of ground than was asked
    // for, which the designer would then draw panels onto at the wrong place.
    for (const bad of [
      { tx: String(SUPERTILE_RADIUS + 1), ty: "0", zoom: "21" },
      { tx: "0", ty: String(-SUPERTILE_RADIUS - 1), zoom: "21" },
      { tx: "9999", ty: "9999", zoom: "21" },
    ]) {
      expect(parseSupertile(q(bad))).toBe("invalid");
    }
  });

  it("refuses a zoom outside what Google will actually serve", () => {
    expect(parseSupertile(q({ tx: "0", ty: "0", zoom: String(MAX_STATIC_ZOOM + 1) }))).toBe("invalid");
    expect(parseSupertile(q({ tx: "0", ty: "0", zoom: String(MIN_STATIC_ZOOM - 1) }))).toBe("invalid");
  });

  it("refuses anything that is not a number, or a fractional zoom", () => {
    for (const bad of [
      { tx: "abc", ty: "0", zoom: "21" },
      { tx: "0", ty: "0", zoom: "" },
      { tx: "0", ty: "", zoom: "21" },
      { tx: "0", ty: "0", zoom: "20.5" },
      { tx: "Infinity", ty: "0", zoom: "21" },
    ]) {
      expect(parseSupertile(q(bad))).toBe("invalid");
    }
  });

  /**
   * The customer's layout picture is ONE image centred on the array, not a
   * mosaic — otherwise it carries a Google watermark per tile. That needs a
   * centre between grid points, and it must still be inside the bound.
   */
  it("allows a fractional offset, so one image can be centred on the array", () => {
    expect(parseSupertile(q({ tx: "0.37", ty: "-1.8", zoom: "21" }))).toEqual({
      zoom: 21,
      tx: 0.37,
      ty: -1.8,
    });
  });

  it("bounds a fractional offset exactly as tightly as a whole one", () => {
    expect(parseSupertile(q({ tx: String(SUPERTILE_RADIUS + 0.01), ty: "0", zoom: "21" }))).toBe(
      "invalid"
    );
  });

  it("centres tile (0,0) on the deal itself", () => {
    expect(supertileCentre(origin, { zoom: 21, tx: 0, ty: 0 })).toEqual(origin);
  });

  it("steps one whole supertile of ground per index, east and south", () => {
    const zoom = 21;
    const sideM = SUPERTILE_PX * metresPerPixel(origin.lat, zoom, 2);
    const east = latLngToMetres(origin, supertileCentre(origin, { zoom, tx: 1, ty: 0 }));
    const south = latLngToMetres(origin, supertileCentre(origin, { zoom, tx: 0, ty: 1 }));
    expect(east.e).toBeCloseTo(sideM, 3);
    expect(east.n).toBeCloseTo(0, 6);
    // ty counts DOWN the screen, so it goes south.
    expect(south.n).toBeCloseTo(-sideM, 3);
    expect(south.e).toBeCloseTo(0, 6);
  });

  it("covers less ground per tile the deeper the zoom", () => {
    const wide = latLngToMetres(origin, supertileCentre(origin, { zoom: 18, tx: 1, ty: 0 })).e;
    const close = latLngToMetres(origin, supertileCentre(origin, { zoom: 21, tx: 1, ty: 0 })).e;
    expect(close).toBeCloseTo(wide / 8, 3);
  });
});

describe("map type", () => {
  it("takes the three Google actually serves and nothing else", () => {
    expect(parseMapType("satellite")).toBe("satellite");
    expect(parseMapType("roadmap")).toBe("roadmap");
    // The labelled photo — how a rep checks WHICH roof the deal is about.
    expect(parseMapType("hybrid")).toBe("hybrid");
  });

  it("falls back to the photograph for anything else", () => {
    for (const junk of [null, undefined, "", "terrain", "../../etc/passwd"]) {
      expect(parseMapType(junk)).toBe("satellite");
    }
  });
});
