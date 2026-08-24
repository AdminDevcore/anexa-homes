import { describe, it, expect } from "vitest";
import {
  bestFitBlock,
  detachPanel,
  blockPanelCount,
  panelCount,
  panelCorners,
  parseLayoutBlocks,
  MODULE_FALLBACK_MM,
  type LayoutBlock,
} from "../solar-layout";
import { systemTotals, arrayBreakdown } from "../solar-arrays";
import { PRODUCTION_MARGIN_FACTOR } from "../solar-money";

const M = MODULE_FALLBACK_MM; // 1.134 m x 1.762 m
const DFW = 32.9;
const ASSUMPTIONS = { kwhPerKwYear: 1450, derateFactor: 0.85 };

const block = (over: Partial<LayoutBlock> = {}): LayoutBlock => ({
  id: "a",
  originE: 0,
  originN: 0,
  rotationDeg: 0,
  cols: 2,
  rows: 2,
  orientation: "portrait",
  omitted: [],
  ...over,
});

describe("bestFitBlock", () => {
  it("turns the panel sideways when that is the only way it fits", () => {
    // A shallow band along a ridge: 6 m across, 1.3 m deep. Portrait needs
    // 1.76 m of depth and fits nothing; landscape needs 1.13 m and fits five.
    // This exact rectangle used to be rejected as "too small for a panel".
    const fit = bestFitBlock({ widthM: 6, heightM: 1.3 }, M);
    expect(fit.orientation).toBe("landscape");
    expect(fit.cols).toBeGreaterThan(0);
    expect(fit.rows).toBe(1);
  });

  it("prefers portrait when the rectangle holds more that way", () => {
    const fit = bestFitBlock({ widthM: 4, heightM: 8 }, M);
    expect(fit.orientation).toBe("portrait");
    expect(fit.cols * fit.rows).toBeGreaterThan(0);
  });

  it("still refuses a rectangle no panel fits in, either way round", () => {
    const fit = bestFitBlock({ widthM: 0.9, heightM: 0.9 }, M);
    expect(fit.cols * fit.rows).toBe(0);
  });
});

describe("detachPanel", () => {
  it("leaves the count unchanged and the panel where it was", () => {
    const blocks = [block({ cols: 3, rows: 2 })];
    const before = panelCount(blocks);
    const cornersBefore = panelCorners(blocks[0], M);

    const res = detachPanel(blocks, "a", 4, M, "loose")!;
    expect(res).not.toBeNull();
    expect(panelCount(res.blocks)).toBe(before);

    // Cell 4 is row 1, col 1. The loose block's single panel must sit exactly
    // on top of where the grid one was — a detach that shifts the panel by a
    // rail gap is a detach that silently moves the array.
    const loose = res.blocks.find((b) => b.id === "loose")!;
    const looseCorner = panelCorners(loose, M)[0][0];
    expect(looseCorner.e).toBeCloseTo(cornersBefore[4][0].e, 9);
    expect(looseCorner.n).toBeCloseTo(cornersBefore[4][0].n, 9);
  });

  it("inherits the parent's rotation, orientation and facing", () => {
    const blocks = [
      block({ cols: 2, rows: 2, rotationDeg: 37, orientation: "landscape", azimuthDeg: 210, tiltDeg: 22 }),
    ];
    const loose = detachPanel(blocks, "a", 1, M, "loose")!.blocks.find((b) => b.id === "loose")!;
    expect(loose.rotationDeg).toBe(37);
    expect(loose.orientation).toBe("landscape");
    expect(loose.azimuthDeg).toBe(210);
    expect(loose.tiltDeg).toBe(22);
    expect(blockPanelCount(loose)).toBe(1);
  });

  it("puts the panel back exactly on a ROTATED parent's cell too", () => {
    const blocks = [block({ cols: 3, rows: 3, rotationDeg: 63.5 })];
    const cornersBefore = panelCorners(blocks[0], M);
    const res = detachPanel(blocks, "a", 7, M, "loose")!;
    const loose = res.blocks.find((b) => b.id === "loose")!;
    const looseCorner = panelCorners(loose, M)[0][0];
    expect(looseCorner.e).toBeCloseTo(cornersBefore[7][0].e, 9);
    expect(looseCorner.n).toBeCloseTo(cornersBefore[7][0].n, 9);
  });

  it("is a no-op on a cell that is already knocked out, or out of range", () => {
    const blocks = [block({ omitted: [1] })];
    expect(detachPanel(blocks, "a", 1, M, "x")).toBeNull();
    expect(detachPanel(blocks, "a", 99, M, "x")).toBeNull();
    expect(detachPanel(blocks, "nope", 0, M, "x")).toBeNull();
  });

  it("leaves a lone panel alone rather than making a second one", () => {
    const blocks = [block({ cols: 1, rows: 1 })];
    const res = detachPanel(blocks, "a", 0, M, "loose")!;
    expect(res.blocks).toHaveLength(1);
    expect(res.detachedId).toBe("a");
  });
});

describe("systemTotals", () => {
  const roof = (over: Partial<LayoutBlock>): LayoutBlock =>
    block({ cols: 5, rows: 2, ...over }); // 10 panels

  it("prices a north roof below a south roof of the same size", () => {
    const south = systemTotals([roof({ id: "s", azimuthDeg: 180, tiltDeg: 18.4 })], {
      lat: DFW,
      moduleRatingW: 400,
      assumptions: ASSUMPTIONS,
    });
    const north = systemTotals([roof({ id: "n", azimuthDeg: 0, tiltDeg: 18.4 })], {
      lat: DFW,
      moduleRatingW: 400,
      assumptions: ASSUMPTIONS,
    });

    // Same panels, same kW — this is the whole point of the model.
    expect(north.systemSizeKwDc).toBe(south.systemSizeKwDc);
    expect(north.year1ProductionKwh).toBeLessThan(south.year1ProductionKwh * 0.8);
  });

  it("blends two planes by their share of the system", () => {
    const totals = systemTotals(
      [
        roof({ id: "s", azimuthDeg: 180, tiltDeg: 18.4 }),
        roof({ id: "n", azimuthDeg: 0, tiltDeg: 18.4 }),
      ],
      { lat: DFW, moduleRatingW: 400, assumptions: ASSUMPTIONS }
    );
    const [s, n] = totals.arrays;
    expect(totals.blendedFactor).toBeCloseTo((s.factor + n.factor) / 2, 6);
    expect(totals.panels).toBe(20);
    expect(totals.systemSizeKwDc).toBeCloseTo(8, 6);
  });

  it("prices an undescribed array exactly as it did before orientation existed", () => {
    // 10 x 400 W = 4 kW; 4 x 1450 x 0.85 = 4930, less the 5% production
    // margin every quoted kWh is held back by.
    const totals = systemTotals([roof({ id: "u" })], {
      lat: DFW,
      moduleRatingW: 400,
      assumptions: ASSUMPTIONS,
    });
    expect(totals.year1ProductionKwh).toBe(Math.round(4930 * PRODUCTION_MARGIN_FACTOR));
    expect(totals.unorientedArrays).toBe(1);
    expect(totals.blendedFactor).toBe(1);
  });

  it("counts an array as described only when BOTH facing and pitch are set", () => {
    const half = systemTotals([roof({ id: "h", azimuthDeg: 180 })], {
      lat: DFW,
      moduleRatingW: 400,
      assumptions: ASSUMPTIONS,
    });
    expect(half.unorientedArrays).toBe(1);
    expect(half.arrays[0].factor).toBe(1);
  });

  it("keeps everything at zero when the catalogue has no panel", () => {
    const totals = systemTotals([roof({ id: "s", azimuthDeg: 180, tiltDeg: 18.4 })], {
      lat: DFW,
      moduleRatingW: null,
      assumptions: ASSUMPTIONS,
    });
    // The panels are real; the WATTS are not known. Inventing a wattage here is
    // how a proposal gets a system size nobody chose.
    expect(totals.panels).toBe(10);
    expect(totals.systemSizeKwDc).toBe(0);
    expect(totals.year1ProductionKwh).toBe(0);
  });

  it("ignores an array that has been entirely knocked out", () => {
    const empty = block({ cols: 2, rows: 1, omitted: [0, 1], azimuthDeg: 180, tiltDeg: 20 });
    const totals = systemTotals([empty], {
      lat: DFW,
      moduleRatingW: 400,
      assumptions: ASSUMPTIONS,
    });
    expect(totals.panels).toBe(0);
    expect(totals.unorientedArrays).toBe(0);
  });

  it("names the compass point for each array", () => {
    const [a] = arrayBreakdown([roof({ azimuthDeg: 225, tiltDeg: 20 })], {
      lat: DFW,
      moduleRatingW: 400,
    });
    expect(a.compass).toBe("SW");
  });
});

describe("parseLayoutBlocks", () => {
  it("reads a block saved before orientation existed, without inventing one", () => {
    const raw = [
      {
        id: "old",
        originE: 1,
        originN: 2,
        rotationDeg: 0,
        cols: 2,
        rows: 2,
        orientation: "portrait",
        omitted: [],
      },
    ];
    const [b] = parseLayoutBlocks(raw);
    expect(b.azimuthDeg).toBeNull();
    expect(b.tiltDeg).toBeNull();
  });

  it("carries a saved orientation through, and drops a corrupt one", () => {
    const base = {
      id: "x",
      originE: 0,
      originN: 0,
      rotationDeg: 0,
      cols: 1,
      rows: 1,
      orientation: "portrait",
      omitted: [],
    };
    const [good] = parseLayoutBlocks([{ ...base, azimuthDeg: 215, tiltDeg: 26.6 }]);
    expect(good.azimuthDeg).toBe(215);
    expect(good.tiltDeg).toBe(26.6);

    // NaN reaching the irradiance sum would make the whole system's production
    // NaN, and a NaN kWh renders as an empty cell on a customer's proposal.
    const [bad] = parseLayoutBlocks([{ ...base, azimuthDeg: "south", tiltDeg: NaN }]);
    expect(bad.azimuthDeg).toBeNull();
    expect(bad.tiltDeg).toBeNull();
  });
});
