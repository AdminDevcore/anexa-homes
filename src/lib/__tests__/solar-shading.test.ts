import { describe, expect, it } from "vitest";
import { arrayBreakdown, systemTotals } from "../solar-arrays";
import type { LayoutBlock } from "../solar-layout";

const ASSUMPTIONS = { kwhPerKwYear: 1500, derateFactor: 0.85 };
// Austin, so the sun model has a real latitude to work from.
const LAT = 30.3;

const block = (over: Partial<LayoutBlock> = {}): LayoutBlock => ({
  id: "b1",
  originE: 0,
  originN: 0,
  rotationDeg: 0,
  cols: 5,
  rows: 2,
  orientation: "portrait",
  omitted: [],
  azimuthDeg: 180,
  tiltDeg: 20,
  ...over,
});

describe("shading", () => {
  it("takes exactly its percentage off the array's factor", () => {
    const [clear] = arrayBreakdown([block()], { lat: LAT, moduleRatingW: 400 });
    const [half] = arrayBreakdown([block({ shadePct: 50 })], { lat: LAT, moduleRatingW: 400 });
    expect(half.shadeFactor).toBeCloseTo(0.5, 6);
    expect(half.factor).toBeCloseTo(clear.factor * 0.5, 6);
    // The plane itself has not moved, so its orientation figure must not have.
    expect(half.orientationFactor).toBeCloseTo(clear.orientationFactor, 6);
  });

  it("an unrecorded shade prices exactly as it did before shading existed", () => {
    const [none] = arrayBreakdown([block()], { lat: LAT, moduleRatingW: 400 });
    expect(none.shadeFactor).toBe(1);
    expect(none.shadePct).toBeNull();
    expect(none.factor).toBeCloseTo(none.orientationFactor, 10);
  });

  it("drops the year's production by the shaded share", () => {
    const clear = systemTotals([block()], { lat: LAT, moduleRatingW: 400, assumptions: ASSUMPTIONS });
    const shaded = systemTotals([block({ shadePct: 50 })], {
      lat: LAT,
      moduleRatingW: 400,
      assumptions: ASSUMPTIONS,
    });
    expect(shaded.year1ProductionKwh).toBeCloseTo(clear.year1ProductionKwh / 2, 0);
    // Panel count and kW are physical: a tree does not remove a module.
    expect(shaded.panels).toBe(clear.panels);
    expect(shaded.systemSizeKwDc).toBeCloseTo(clear.systemSizeKwDc, 6);
  });

  it("shades one array without touching its neighbour", () => {
    const totals = systemTotals(
      [block({ id: "a" }), block({ id: "b", shadePct: 100 })],
      { lat: LAT, moduleRatingW: 400, assumptions: ASSUMPTIONS }
    );
    const a = totals.arrays.find((x) => x.id === "a")!;
    const b = totals.arrays.find((x) => x.id === "b")!;
    expect(a.factor).toBeGreaterThan(0);
    expect(b.factor).toBe(0);
    // Half the system is dark, so the blend is half of the clear array's.
    expect(totals.blendedFactor).toBeCloseTo(a.factor / 2, 6);
  });

  it("a fully shaded roof makes nothing, rather than going negative", () => {
    const totals = systemTotals([block({ shadePct: 100 })], {
      lat: LAT,
      moduleRatingW: 400,
      assumptions: ASSUMPTIONS,
    });
    expect(totals.year1ProductionKwh).toBe(0);
  });

  it("clamps a shade that arrived out of range", () => {
    const [over] = arrayBreakdown([block({ shadePct: 250 })], { lat: LAT, moduleRatingW: 400 });
    expect(over.shadePct).toBe(100);
    expect(over.factor).toBe(0);
  });

  it("still reports an unoriented array as unoriented when it is shaded", () => {
    const totals = systemTotals([block({ azimuthDeg: null, tiltDeg: null, shadePct: 30 })], {
      lat: LAT,
      moduleRatingW: 400,
      assumptions: ASSUMPTIONS,
    });
    expect(totals.unorientedArrays).toBe(1);
    // Unknown plane still weighs 1; only the shade comes off.
    expect(totals.arrays[0].factor).toBeCloseTo(0.7, 6);
  });
});
