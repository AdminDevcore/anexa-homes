import { describe, it, expect } from "vitest";
import {
  staticMapUrl,
  parseGoogleGeocode,
  geocodeStatusReason,
  satelliteConfigured,
  DEFAULT_ZOOM,
} from "@/server/modules/property/satellite";

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
