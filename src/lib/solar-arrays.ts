/**
 * The join between what was drawn on the roof and what it will produce.
 *
 * Three modules meet here and none of them should know about the other two:
 * `solar-layout` knows rectangles and ground metres, `solar-orientation` knows
 * where the sun is, `solar-money` knows yields and money. This is the only
 * place that holds all three, so the designer's live preview and the server
 * action that saves the design cannot drift apart — which they would, being on
 * opposite sides of the wire, if each did the sum itself.
 */

import { blockPanelCount, clampShade, type LayoutBlock } from "./solar-layout";
import { orientationFactor, compassLabel } from "./solar-orientation";
import {
  year1ProductionFromArrays,
  blendedOrientationFactor,
  type YieldAssumptions,
} from "./solar-money";

/**
 * What one plane makes, when somebody has actually measured it.
 *
 * Returns kWh per kW-DC per year for a plane, or null when nothing is known
 * about it — a lookup into the PVWatts cache, passed in rather than imported so
 * this module keeps knowing nothing about the network. Null falls the array
 * back to the company's market-average yield, which is what every figure was
 * built on before PVWatts existed.
 */
export type PlaneYieldLookup = (plane: {
  tiltDeg: number | null;
  azimuthDeg: number | null;
}) => number | null;

export type ArrayBreakdown = {
  id: string;
  panels: number;
  kwDc: number;
  azimuthDeg: number | null;
  tiltDeg: number | null;
  /**
   * What the PLANE does, 0..1 against this site's best one. 1 when the
   * orientation is unknown. Geometry only — nothing standing in front of it.
   */
  orientationFactor: number;
  /** What the surroundings take away, 0..1. 1 is a clear roof. */
  shadeFactor: number;
  /** 0..100 as recorded, or null when nobody has looked. */
  shadePct: number | null;
  /**
   * The two multiplied: the share of ideal this array actually earns, and the
   * only one of the three that production is allowed to be built on. Kept
   * beside its parts rather than instead of them so a UI can say WHY an array
   * is at 54% — a north roof and a clear sky is a different conversation from
   * a south roof under an oak.
   */
  factor: number;
  /** True when nobody has said which way this array faces. */
  unoriented: boolean;
  /** "SW", or null when there is no azimuth to name. */
  compass: string | null;
  /**
   * kWh per kW-year for this plane, when a real simulation answered for it.
   *
   * Null means the array is priced on the company's market average scaled by
   * the clear-sky ratio — the old model. Kept per array rather than per system
   * because one roof can have a measured plane and an undescribed one on it,
   * and a proposal that says "modelled" should mean it.
   */
  measuredKwhPerKwYear: number | null;
};

/**
 * One array per drawn block, with the orientation penalty already applied.
 *
 * `moduleRatingW` null — an empty equipment catalogue — leaves every kW at
 * zero rather than inventing a wattage. The system is then unsized, which is
 * the true state of it, and the UI says so.
 */
export function arrayBreakdown(
  blocks: LayoutBlock[],
  opts: {
    lat: number | null;
    moduleRatingW: number | null;
    /** Optional. Absent means every array uses the old market-average model. */
    planeYield?: PlaneYieldLookup;
  }
): ArrayBreakdown[] {
  return blocks.map((b) => {
    const panels = blockPanelCount(b);
    const azimuthDeg = b.azimuthDeg ?? null;
    const tiltDeg = b.tiltDeg ?? null;
    const unoriented = azimuthDeg == null || tiltDeg == null;
    const orientation = orientationFactor({ lat: opts.lat, tiltDeg, azimuthDeg });
    // Null shade is a clear roof, NOT a missing measurement that has to be
    // defended against: an array with no tree recorded near it is the normal
    // case, and every design saved before shading existed is one.
    const shadePct = clampShade(b.shadePct);
    const shadeFactor = 1 - (shadePct ?? 0) / 100;
    return {
      id: b.id,
      panels,
      kwDc: opts.moduleRatingW ? (panels * opts.moduleRatingW) / 1000 : 0,
      azimuthDeg,
      tiltDeg,
      orientationFactor: orientation,
      shadePct,
      shadeFactor,
      factor: orientation * shadeFactor,
      unoriented,
      compass: azimuthDeg == null ? null : compassLabel(azimuthDeg),
      measuredKwhPerKwYear: opts.planeYield?.({ tiltDeg, azimuthDeg }) ?? null,
    };
  });
}

export type SystemTotals = {
  /** Per-array, so a UI can show one plane's figure without recomputing it and
   *  risking a percentage that disagrees with the system's. */
  arrays: ArrayBreakdown[];
  panels: number;
  systemSizeKwDc: number;
  year1ProductionKwh: number;
  /**
   * The whole system as a share of ideal, or null when nothing is drawn.
   * Orientation AND shade — it is what the production figure was built on, so
   * printing anything narrower beside that figure would not explain it.
   */
  blendedFactor: number | null;
  /** How many arrays still have no orientation recorded. */
  unorientedArrays: number;
  /**
   * How many arrays are priced on a real PVWatts simulation rather than on the
   * company's market average. Zero means every figure here is an estimate of
   * the old kind, and a proposal built on it should not imply otherwise.
   */
  measuredArrays: number;
};

/**
 * Twelve months of what a plane makes, per kW-DC. See PlaneYieldLookup.
 *
 * Separate from the annual lookup because they fail separately: PVWatts can
 * answer with an annual total and no monthly breakdown, and a caller that
 * assumed one implied the other would draw a year out of nothing.
 */
export type PlaneMonthlyLookup = (plane: {
  tiltDeg: number | null;
  azimuthDeg: number | null;
}) => number[] | null;

/**
 * The shape of the system's year: twelve months of production, Jan..Dec, kWh.
 *
 * NULL UNLESS EVERY ARRAY WAS SIMULATED. This is the rule the whole function
 * exists for. A roof with a measured south plane and an undescribed north one
 * has an annual figure that adds a simulation to a market average — which is
 * fine, because an annual figure is one number and the document says how it was
 * built. A monthly CURVE is different: the market-average model has no seasonal
 * shape at all, so the only way to draw those months is to invent them, and an
 * invented January sitting next to a metered one is indistinguishable by eye.
 *
 * An array with no panels on it is skipped rather than disqualifying the year —
 * an empty block is a rectangle somebody drew and did not fill, not a plane
 * nobody simulated.
 */
export function monthlyProduction(
  arrays: ArrayBreakdown[],
  planeMonthly: PlaneMonthlyLookup
): number[] | null {
  const live = arrays.filter((a) => a.panels > 0 && a.kwDc > 0);
  if (live.length === 0) return null;

  const total = new Array(12).fill(0) as number[];
  for (const a of live) {
    const perKw = planeMonthly({ tiltDeg: a.tiltDeg, azimuthDeg: a.azimuthDeg });
    if (!perKw || perKw.length !== 12) return null;
    if (!perKw.every((m) => typeof m === "number" && Number.isFinite(m) && m >= 0)) return null;
    for (let i = 0; i < 12; i++) total[i] += a.kwDc * perKw[i] * a.shadeFactor;
  }

  const rounded = total.map((n) => Math.round(n));
  // Twelve zeros is a cache row that answered with an empty year, not a system
  // that makes nothing.
  return rounded.some((n) => n > 0) ? rounded : null;
}

/**
 * Everything the design step, the proposal and the save action all need to
 * agree on, computed once from the geometry.
 */
export function systemTotals(
  blocks: LayoutBlock[],
  opts: {
    lat: number | null;
    moduleRatingW: number | null;
    assumptions: YieldAssumptions;
    /** Optional. Absent means the whole system uses the market-average model. */
    planeYield?: PlaneYieldLookup;
  }
): SystemTotals {
  const arrays = arrayBreakdown(blocks, opts);
  const forMoney = arrays.map((a) => ({ kwDc: a.kwDc, orientationFactor: a.factor }));

  /**
   * Production, array by array, from whichever model can answer for each.
   *
   * A MEASURED plane is `size × its own yield × (1 − shade)` and owes nothing to
   * `kwhPerKwYear` or to the clear-sky ratio — both of those exist to guess at
   * what PVWatts has now actually simulated. An undescribed plane still has no
   * simulation to draw on, so it keeps the market average exactly as before.
   *
   * The two can therefore sit on one roof, and the totals add up regardless.
   */
  const year1ProductionKwh = arrays.reduce((sum, a) => {
    if (a.measuredKwhPerKwYear == null) {
      return (
        sum +
        year1ProductionFromArrays([{ kwDc: a.kwDc, orientationFactor: a.factor }], opts.assumptions)
      );
    }
    return sum + Math.round(a.kwDc * a.measuredKwhPerKwYear * a.shadeFactor);
  }, 0);

  return {
    arrays,
    panels: arrays.reduce((n, a) => n + a.panels, 0),
    // Rounded to the watt: floating-point kW sums print as 9.860000000000001
    // on a proposal otherwise.
    systemSizeKwDc: Math.round(arrays.reduce((n, a) => n + a.kwDc, 0) * 1000) / 1000,
    year1ProductionKwh,
    blendedFactor: blendedOrientationFactor(forMoney),
    unorientedArrays: arrays.filter((a) => a.unoriented && a.panels > 0).length,
    /** How many arrays are priced on a real simulation rather than an average. */
    measuredArrays: arrays.filter((a) => a.measuredKwhPerKwYear != null && a.panels > 0).length,
  };
}
