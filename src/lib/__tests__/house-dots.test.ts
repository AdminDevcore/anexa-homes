import { describe, it, expect } from "vitest";
import { interiorPoint } from "@/server/modules/canvassing/addresses";
import { pointInPolygon, type LatLng } from "@/lib/canvassing";

/**
 * House dots have to land ON the roof. These are the two failures that put them
 * elsewhere: catastrophic cancellation in the shoelace sums (which pushed the
 * "centroid" clean off the building), and the concave-footprint fallback that
 * used to snap to an outline vertex — a corner of the house.
 *
 * Real neighbourhood coordinates matter here: the cancellation only shows up at
 * lng ~ -96, which is exactly why it survived a review at the origin.
 */

const R = 6371000;
const rad = (x: number) => (x * Math.PI) / 180;
function meters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** A w × h metre rectangle with its south-west corner at (lat, lng). */
function house(lat: number, lng: number, w: number, h: number) {
  const dLat = h / 111320;
  const dLng = w / (111320 * Math.cos(rad(lat)));
  return {
    ring: [
      { lat, lng },
      { lat, lng: lng + dLng },
      { lat: lat + dLat, lng: lng + dLng },
      { lat: lat + dLat, lng },
    ],
    center: { lat: lat + dLat / 2, lng: lng + dLng / 2 },
  };
}

describe("interiorPoint", () => {
  it("centres a Dallas house within a metre of true centre", () => {
    const { ring, center } = house(32.83671, -96.79842, 18, 12);
    expect(meters(interiorPoint(ring), center)).toBeLessThan(1);
  });

  it("stays centred across a whole neighbourhood of houses and sizes", () => {
    let worst = 0;
    for (let i = 0; i < 200; i++) {
      const lat = 32.82 + (i % 20) * 0.0015;
      const lng = -96.81 + Math.floor(i / 20) * 0.0015;
      const { ring, center } = house(lat, lng, 9 + (i % 23), 8 + (i % 19));
      worst = Math.max(worst, meters(interiorPoint(ring), center));
    }
    // Was a median of 11.5 m — wider than the houses themselves.
    expect(worst).toBeLessThan(1);
  });

  it("puts a courtyard house's dot on roof, not in the yard or on a corner", () => {
    // A U-shaped block: two wings off a base. Its true centroid sits in the
    // courtyard between the wings — outside the building — so this is the case
    // that used to snap the pin to a corner vertex.
    const lat = 32.8367, lng = -96.7984;
    const d = (m: number) => m / 111320;
    const e = (m: number) => m / (111320 * Math.cos(rad(lat)));
    const ring = [
      { lat, lng },
      { lat, lng: lng + e(20) },
      { lat: lat + d(16), lng: lng + e(20) },
      { lat: lat + d(16), lng: lng + e(14) },
      { lat: lat + d(6), lng: lng + e(14) },
      { lat: lat + d(6), lng: lng + e(6) },
      { lat: lat + d(16), lng: lng + e(6) },
      { lat: lat + d(16), lng },
    ];
    const poly: LatLng[] = ring.map((p) => [p.lat, p.lng]);

    // Confirm the premise: the plain centroid really is off the building.
    const centroid = { lat: lat + d(7), lng: lng + e(10) };
    expect(pointInPolygon([centroid.lat, centroid.lng], poly)).toBe(false);

    const p = interiorPoint(ring);
    expect(pointInPolygon([p.lat, p.lng], poly)).toBe(true);
    // And not parked on a corner: at least 2 m clear of every vertex.
    for (const v of ring) expect(meters(p, v)).toBeGreaterThan(2);
  });

  it("survives a degenerate outline instead of returning NaN", () => {
    const lat = 32.8367, lng = -96.7984;
    const p = interiorPoint([
      { lat, lng },
      { lat, lng: lng + 0.0001 },
      { lat, lng: lng + 0.0002 },
    ]);
    expect(Number.isFinite(p.lat)).toBe(true);
    expect(Number.isFinite(p.lng)).toBe(true);
  });
});
