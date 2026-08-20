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
  opts: { lat: number | null; moduleRatingW: number | null }
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
};

/**
 * Everything the design step, the proposal and the save action all need to
 * agree on, computed once from the geometry.
 */
export function systemTotals(
  blocks: LayoutBlock[],
  opts: { lat: number | null; moduleRatingW: number | null; assumptions: YieldAssumptions }
): SystemTotals {
  const arrays = arrayBreakdown(blocks, opts);
  const forMoney = arrays.map((a) => ({ kwDc: a.kwDc, orientationFactor: a.factor }));
  return {
    arrays,
    panels: arrays.reduce((n, a) => n + a.panels, 0),
    // Rounded to the watt: floating-point kW sums print as 9.860000000000001
    // on a proposal otherwise.
    systemSizeKwDc: Math.round(arrays.reduce((n, a) => n + a.kwDc, 0) * 1000) / 1000,
    year1ProductionKwh: year1ProductionFromArrays(forMoney, opts.assumptions),
    blendedFactor: blendedOrientationFactor(forMoney),
    unorientedArrays: arrays.filter((a) => a.unoriented && a.panels > 0).length,
  };
}
