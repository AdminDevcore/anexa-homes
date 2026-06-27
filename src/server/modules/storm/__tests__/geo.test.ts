import { describe, it, expect } from "vitest";
import { haversineMiles, boundingBox, circlePolygon, DALLAS } from "../geo";

describe("storm geo", () => {
  it("haversine: Dallas -> Fort Worth is ~32 miles", () => {
    const ftWorth = { lat: 32.7555, lng: -97.3308 };
    const d = haversineMiles(DALLAS, ftWorth);
    expect(d).toBeGreaterThan(28);
    expect(d).toBeLessThan(36);
  });

  it("haversine: zero distance to self", () => {
    expect(haversineMiles(DALLAS, DALLAS)).toBeCloseTo(0, 5);
  });

  it("bounding box brackets the center", () => {
    const bb = boundingBox(DALLAS, 100);
    expect(bb.minLat).toBeLessThan(DALLAS.lat);
    expect(bb.maxLat).toBeGreaterThan(DALLAS.lat);
    expect(bb.minLng).toBeLessThan(DALLAS.lng);
    expect(bb.maxLng).toBeGreaterThan(DALLAS.lng);
    // ~100mi north edge should be within Haversine range of the box corner.
    expect(haversineMiles(DALLAS, { lat: bb.maxLat, lng: DALLAS.lng })).toBeGreaterThan(95);
  });

  it("circlePolygon returns a closed-ish ring near the radius", () => {
    const ring = circlePolygon(DALLAS, 5, 16);
    expect(ring).toHaveLength(16);
    for (const [lat, lng] of ring) {
      const d = haversineMiles(DALLAS, { lat, lng });
      expect(d).toBeGreaterThan(3.5);
      expect(d).toBeLessThan(6.5);
    }
  });
});
