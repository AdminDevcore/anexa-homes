import { describe, it, expect } from "vitest";
import { monthlyProduction, type ArrayBreakdown } from "@/lib/solar-arrays";
import { PRODUCTION_MARGIN_FACTOR } from "@/lib/solar-money";

/**
 * The rule: a monthly curve is drawn only when every array on the roof was
 * really simulated. The annual figure may mix a simulation with a market
 * average and say so; a chart of months cannot, because the market-average
 * model has no months in it.
 */

const YEAR = [120, 130, 160, 175, 185, 190, 195, 188, 168, 150, 122, 110];

const arr = (o: Partial<ArrayBreakdown> = {}): ArrayBreakdown => ({
  id: "a1",
  panels: 10,
  kwDc: 4,
  azimuthDeg: 180,
  tiltDeg: 20,
  orientationFactor: 1,
  shadeFactor: 1,
  shadePct: null,
  factor: 1,
  unoriented: false,
  compass: "S",
  measuredKwhPerKwYear: 1500,
  ...o,
});

describe("the shape of the year", () => {
  it("scales a plane's per-kW year by the array's size", () => {
    const out = monthlyProduction([arr()], () => YEAR)!;
    expect(out).toEqual(YEAR.map((m) => Math.round(m * 4 * PRODUCTION_MARGIN_FACTOR)));
  });

  it("adds two planes together", () => {
    const out = monthlyProduction([arr(), arr({ id: "a2", kwDc: 2 })], () => YEAR)!;
    expect(out[0]).toBe(Math.round(YEAR[0] * 6 * PRODUCTION_MARGIN_FACTOR));
  });

  it("takes shading off, exactly as the annual figure does", () => {
    const out = monthlyProduction([arr({ shadeFactor: 0.8, shadePct: 20 })], () => YEAR)!;
    expect(out[0]).toBe(Math.round(YEAR[0] * 4 * 0.8 * PRODUCTION_MARGIN_FACTOR));
  });

  it("draws nothing when one array on the roof was never simulated", () => {
    const lookup = (p: { azimuthDeg: number | null }) => (p.azimuthDeg === 180 ? YEAR : null);
    expect(monthlyProduction([arr(), arr({ id: "a2", azimuthDeg: 0 })], lookup)).toBeNull();
  });

  it("ignores an empty rectangle rather than being disqualified by it", () => {
    const lookup = (p: { azimuthDeg: number | null }) => (p.azimuthDeg === 180 ? YEAR : null);
    const out = monthlyProduction(
      [arr(), arr({ id: "empty", panels: 0, kwDc: 0, azimuthDeg: 0 })],
      lookup
    );
    expect(out).not.toBeNull();
  });

  it("refuses a cache row that answered with a short or empty year", () => {
    expect(monthlyProduction([arr()], () => [1, 2, 3])).toBeNull();
    expect(monthlyProduction([arr()], () => [])).toBeNull();
    expect(monthlyProduction([arr()], () => new Array(12).fill(0))).toBeNull();
  });

  it("draws nothing for a roof with nothing on it", () => {
    expect(monthlyProduction([], () => YEAR)).toBeNull();
    expect(monthlyProduction([arr({ panels: 0, kwDc: 0 })], () => YEAR)).toBeNull();
  });
});
