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

describe("a measured plane outranks the market average", () => {
  /** PVWatts answers per plane; anything it has not answered for keeps the
   *  company's typed yield scaled by the clear-sky ratio, as before. */
  const measured = (kwh: number) => () => kwh;

  it("prices a measured array on its own yield, not on kwhPerKwYear", () => {
    const totals = systemTotals([block()], {
      lat: LAT,
      moduleRatingW: 400,
      assumptions: ASSUMPTIONS,
      planeYield: measured(1600),
    });
    // 10 panels × 400 W = 4 kW, at 1,600 kWh/kW.
    expect(totals.systemSizeKwDc).toBeCloseTo(4, 6);
    expect(totals.year1ProductionKwh).toBe(6400);
    expect(totals.measuredArrays).toBe(1);
  });

  it("owes nothing to the derate or the clear-sky ratio once measured", () => {
    const a = systemTotals([block()], {
      lat: LAT, moduleRatingW: 400, assumptions: ASSUMPTIONS, planeYield: measured(1600),
    });
    // A different derate and a different market yield change nothing: PVWatts
    // has already accounted for losses and for the plane.
    const b = systemTotals([block()], {
      lat: LAT,
      moduleRatingW: 400,
      assumptions: { kwhPerKwYear: 900, derateFactor: 0.5 },
      planeYield: measured(1600),
    });
    expect(b.year1ProductionKwh).toBe(a.year1ProductionKwh);
  });

  it("still takes the shade off — it was never sent to PVWatts", () => {
    const totals = systemTotals([block({ shadePct: 50 })], {
      lat: LAT, moduleRatingW: 400, assumptions: ASSUMPTIONS, planeYield: measured(1600),
    });
    expect(totals.year1ProductionKwh).toBe(3200);
  });

  it("falls back to the market average for a plane nothing has answered for", () => {
    const withLookup = systemTotals([block()], {
      lat: LAT, moduleRatingW: 400, assumptions: ASSUMPTIONS, planeYield: () => null,
    });
    const without = systemTotals([block()], {
      lat: LAT, moduleRatingW: 400, assumptions: ASSUMPTIONS,
    });
    expect(withLookup.year1ProductionKwh).toBe(without.year1ProductionKwh);
    expect(withLookup.measuredArrays).toBe(0);
  });

  /** One roof can carry a described plane and an undescribed one. The totals
   *  have to add up across both models. */
  it("adds a measured array and an unmeasured one together", () => {
    const totals = systemTotals(
      [block({ id: "known" }), block({ id: "unknown", azimuthDeg: null, tiltDeg: null })],
      {
        lat: LAT,
        moduleRatingW: 400,
        assumptions: ASSUMPTIONS,
        // Only the described plane has an answer.
        planeYield: ({ azimuthDeg }) => (azimuthDeg == null ? null : 1600),
      }
    );
    const marketOnly = systemTotals([block({ azimuthDeg: null, tiltDeg: null })], {
      lat: LAT, moduleRatingW: 400, assumptions: ASSUMPTIONS,
    });
    expect(totals.measuredArrays).toBe(1);
    expect(totals.unorientedArrays).toBe(1);
    expect(totals.year1ProductionKwh).toBe(6400 + marketOnly.year1ProductionKwh);
  });

  it("reports nothing measured when no lookup is given at all", () => {
    const totals = systemTotals([block()], {
      lat: LAT, moduleRatingW: 400, assumptions: ASSUMPTIONS,
    });
    expect(totals.measuredArrays).toBe(0);
    expect(totals.arrays[0].measuredKwhPerKwYear).toBeNull();
  });
});
