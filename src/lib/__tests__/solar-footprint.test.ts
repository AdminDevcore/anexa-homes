import { describe, it, expect } from "vitest";
import {
  readOverpassFootprint,
  ridgeFrom,
  MIN_RECTANGULARITY,
  MIN_FOOTPRINT_M2,
  applyFootprintFacing,
  type Footprint,
  type RidgeReading,
} from "@/lib/solar-footprint";
import type { LayoutBlock } from "@/lib/solar-layout";

const ORIGIN = { lat: 33.0048068, lng: -96.7178194 };
const M_PER_DEG_LAT = (Math.PI * 6378137) / 180;
const M_PER_DEG_LNG = M_PER_DEG_LAT * Math.cos((ORIGIN.lat * Math.PI) / 180);

/** Ground metres back into the lat/lng Overpass speaks. */
const at = (e: number, n: number) => ({
  lat: ORIGIN.lat + n / M_PER_DEG_LAT,
  lon: ORIGIN.lng + e / M_PER_DEG_LNG,
});

/** A closed rectangle w x h metres, centred on `centre`, turned `deg`. */
function rect(w: number, h: number, deg = 0, centre = { e: 0, n: 0 }) {
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const corners: [number, number][] = [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ];
  const pts = corners.map(([x, y]) =>
    at(centre.e + x * cos - y * sin, centre.n + x * sin + y * cos)
  );
  return [...pts, pts[0]]; // Overpass closes the way
}

const overpass = (ways: { geometry: ReturnType<typeof rect> }[]) => ({
  elements: ways.map((w, i) => ({ type: "way", id: 100 + i, geometry: w.geometry })),
});

const fp = (points: { e: number; n: number }[], areaM2 = 240): Footprint => ({
  points,
  areaM2,
});

// ---------------------------------------------------------------------------

describe("readOverpassFootprint", () => {
  it("returns nothing for a response with no buildings", () => {
    expect(readOverpassFootprint({ elements: [] }, ORIGIN)).toBeNull();
    expect(readOverpassFootprint(null, ORIGIN)).toBeNull();
    expect(readOverpassFootprint({ junk: true }, ORIGIN)).toBeNull();
  });

  it("reads a building into ground metres", () => {
    const out = readOverpassFootprint(overpass([{ geometry: rect(24, 10) }]), ORIGIN);
    expect(out).not.toBeNull();
    expect(out!.areaM2).toBeCloseTo(240, 0);
    // Closed ways repeat their first node; the ring is kept closed on purpose so
    // the shoelace area and the edge walk both work without a special case.
    expect(out!.points.length).toBeGreaterThanOrEqual(4);
  });

  it("takes the building the pin is standing on, not the neighbour", () => {
    // The neighbour is bigger. Nearest must still win — a pin is on ONE house.
    const out = readOverpassFootprint(
      overpass([
        { geometry: rect(40, 20, 0, { e: 60, n: 0 }) },
        { geometry: rect(24, 10, 0, { e: 0, n: 0 }) },
      ]),
      ORIGIN
    );
    expect(out!.areaM2).toBeCloseTo(240, 0);
  });

  it("ignores a shed", () => {
    // A detached garage or shed is a building too, and its ridge says nothing
    // about the house the panels are going on.
    const out = readOverpassFootprint(overpass([{ geometry: rect(3, 3) }]), ORIGIN);
    expect(out).toBeNull();
  });

  it("ignores a way that is not a closed ring", () => {
    const open = rect(24, 10).slice(0, 2);
    expect(readOverpassFootprint(overpass([{ geometry: open }]), ORIGIN)).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("ridgeFrom", () => {
  /** The rectangle in ground metres, the shape `readOverpassFootprint` returns. */
  const box = (w: number, h: number, deg = 0) => {
    const g = rect(w, h, deg);
    return fp(
      g.map((p) => ({
        e: (p.lon - ORIGIN.lng) * M_PER_DEG_LNG,
        n: (p.lat - ORIGIN.lat) * M_PER_DEG_LAT,
      })),
      w * h
    );
  };

  it("reads an east-west ridge off a house that is wider than it is deep", () => {
    // 404 Shoreline: OSM says 24.1 x 10.0 m.
    const out = ridgeFrom(box(24, 10), ORIGIN.lat);
    expect(out).not.toBeNull();
    expect(out!.ridgeDeg).toBeCloseTo(90, 0);
    expect(out!.facings.map(Math.round).sort((a, b) => a - b)).toEqual([0, 180]);
    // Northern hemisphere: the sun is in the south.
    expect(out!.facingDeg).toBeCloseTo(180, 0);
  });

  it("turns with the house", () => {
    const out = ridgeFrom(box(24, 10, 30), ORIGIN.lat);
    // Long axis turned 30° off east-west; slopes stay square to it.
    expect(out!.ridgeDeg).toBeCloseTo(60, 0);
    expect(out!.facingDeg).toBeCloseTo(150, 0);
  });

  it("faces north below the equator", () => {
    const out = ridgeFrom(box(24, 10), -33.9);
    expect(out!.facingDeg).toBeCloseTo(0, 0);
  });

  it("refuses to guess at a square house", () => {
    // A square footprint has no long axis, so the ridge is a coin toss and the
    // honest answer is to say nothing rather than to pick one.
    expect(ridgeFrom(box(14, 14), ORIGIN.lat)).toBeNull();
    expect(ridgeFrom(box(14, 13), ORIGIN.lat)).toBeNull();
  });

  it("reports how rectangular the footprint was, so a caller can doubt it", () => {
    const out = ridgeFrom(box(24, 10), ORIGIN.lat);
    expect(out!.rectangularity).toBeCloseTo(2.4, 1);
    expect(out!.rectangularity).toBeGreaterThan(MIN_RECTANGULARITY);
    expect(out!.longM).toBeCloseTo(24, 0);
    expect(out!.shortM).toBeCloseTo(10, 0);
  });

  it("refuses a footprint too small to be a house", () => {
    expect(ridgeFrom(box(4, 2), ORIGIN.lat)).toBeNull();
    expect(MIN_FOOTPRINT_M2).toBeGreaterThan(0);
  });

  it("always reports a ridge in 0..180, since a line has no direction", () => {
    for (const deg of [0, 45, 90, 135, 200, 315]) {
      const out = ridgeFrom(box(24, 10, deg), ORIGIN.lat);
      expect(out!.ridgeDeg).toBeGreaterThanOrEqual(0);
      expect(out!.ridgeDeg).toBeLessThan(180);
    }
  });

  it("gives two facings exactly opposite each other", () => {
    const out = ridgeFrom(box(20, 9, 17), ORIGIN.lat)!;
    const [a, b] = out.facings;
    expect(((a - b + 360) % 360)).toBeCloseTo(180, 6);
    expect(out.facings).toContain(out.facingDeg);
  });
});

// ---------------------------------------------------------------------------

describe("applyFootprintFacing", () => {
  const block = (over: Partial<LayoutBlock> = {}): LayoutBlock => ({
    id: "b1",
    originE: 0,
    originN: 0,
    rotationDeg: 0,
    cols: 4,
    rows: 2,
    orientation: "portrait",
    omitted: [],
    azimuthDeg: null,
    tiltDeg: 26.6,
    facingSource: null,
    shadePct: null,
    ...over,
  });

  const reading: RidgeReading = {
    ridgeDeg: 90,
    facings: [180, 0],
    facingDeg: 180,
    longM: 24,
    shortM: 10,
    rectangularity: 2.4,
  };

  it("does nothing without a reading", () => {
    const blocks = [block()];
    expect(applyFootprintFacing(blocks, null)).toEqual({ blocks, filled: 0 });
  });

  it("gives an undescribed array the ridge's facing", () => {
    const out = applyFootprintFacing([block()], reading);
    expect(out.filled).toBe(1);
    expect(out.blocks[0].azimuthDeg).toBe(180);
    // Estimated from an outline, NOT measured off the building.
    expect(out.blocks[0].facingSource).toBe("footprint");
  });

  it("never overwrites a facing somebody already has", () => {
    const rep = block({ azimuthDeg: 205, facingSource: null });
    const roof = block({ id: "b2", azimuthDeg: 176, facingSource: "roof" });
    const out = applyFootprintFacing([rep, roof], reading);
    expect(out.filled).toBe(0);
    expect(out.blocks[0].azimuthDeg).toBe(205);
    expect(out.blocks[1].azimuthDeg).toBe(176);
    expect(out.blocks[1].facingSource).toBe("roof");
  });

  it("leaves the pitch alone", () => {
    // An outline cannot see a slope. A 4/12 and a 9/12 house look identical
    // from above, so an array with no tilt keeps none and stays unpriced.
    const out = applyFootprintFacing([block({ tiltDeg: null })], reading);
    expect(out.blocks[0].tiltDeg).toBeNull();
    expect(out.blocks[0].azimuthDeg).toBe(180);
  });

  it("skips an empty leftover rectangle", () => {
    const ghost = block({ cols: 3, rows: 2, omitted: [0, 1, 2, 3, 4, 5] });
    const out = applyFootprintFacing([ghost], reading);
    expect(out.filled).toBe(0);
    expect(out.blocks[0].azimuthDeg).toBeNull();
  });
});
