import { describe, it, expect } from "vitest";
import {
  metresPerPixel,
  panelSizeM,
  fitBlock,
  panelCount,
  panelCorners,
  metresToImagePx,
  parseLayoutBlocks,
  blockLocalToGround,
  groundToBlockLocal,
  blockSpanM,
  PANEL_GAP_M,
  MODULE_FALLBACK_MM,
  absorbPanel,
  blockPanelCount,
  detachPanel,
  type LayoutBlock,
  type ModuleMm,
} from "@/lib/solar-layout";

const block = (over: Partial<LayoutBlock> = {}): LayoutBlock => ({
  id: "b1",
  originE: 0,
  originN: 0,
  rotationDeg: 0,
  cols: 4,
  rows: 3,
  orientation: "portrait",
  omitted: [],
  ...over,
});

describe("ground scale", () => {
  it("is the documented Web Mercator resolution at the equator", () => {
    expect(metresPerPixel(0, 0, 1)).toBeCloseTo(156543.034, 2);
  });

  it("halves with each zoom level, and again at scale 2", () => {
    expect(metresPerPixel(32, 21, 1) / metresPerPixel(32, 20, 1)).toBeCloseTo(0.5, 6);
    expect(metresPerPixel(32, 20, 2)).toBeCloseTo(metresPerPixel(32, 20, 1) / 2, 9);
  });

  it("shrinks with latitude, because Mercator stretches", () => {
    expect(metresPerPixel(60, 20, 1)).toBeLessThan(metresPerPixel(0, 20, 1));
  });
});

describe("filling a dragged rectangle", () => {
  it("fits whole panels only, never a partial one", () => {
    // 4.0m x 6.0m at 1.134m x 1.762m portrait, 20mm gap:
    //   cols = floor((4.00 + .02) / 1.154) = 3
    //   rows = floor((6.00 + .02) / 1.782) = 3
    expect(fitBlock({ widthM: 4.0, heightM: 6.0 }, MODULE_FALLBACK_MM, "portrait")).toEqual({
      cols: 3,
      rows: 3,
    });
  });

  it("charges for the rail gap, so a span does not fit one more panel than it can", () => {
    // 5.7m of roof: at a 1.134m panel with a 20mm gap the pitch is 1.154m and
    // four fit. Ignore the gap and the maths says five — one panel of overhang
    // per row, which is how a layout that cannot be built gets quoted.
    expect(fitBlock({ widthM: 5.7, heightM: 2 }, MODULE_FALLBACK_MM, "portrait").cols).toBe(4);
  });

  it("returns nothing for a rectangle smaller than one panel", () => {
    expect(fitBlock({ widthM: 0.5, heightM: 0.5 }, MODULE_FALLBACK_MM, "portrait")).toEqual({
      cols: 0,
      rows: 0,
    });
  });

  it("swaps the sides in landscape", () => {
    const p = panelSizeM(MODULE_FALLBACK_MM, "portrait");
    const l = panelSizeM(MODULE_FALLBACK_MM, "landscape");
    expect(l.w).toBeCloseTo(p.h, 9);
    expect(l.h).toBeCloseTo(p.w, 9);
  });

  it("fits more columns across the same span in landscape than portrait", () => {
    const wide = { widthM: 8, heightM: 8 };
    expect(fitBlock(wide, MODULE_FALLBACK_MM, "landscape").cols).toBeLessThan(
      fitBlock(wide, MODULE_FALLBACK_MM, "portrait").cols
    );
  });
});

describe("counting what is actually on the roof", () => {
  it("is rows times columns", () => {
    expect(panelCount([block()])).toBe(12);
  });

  it("excludes knocked-out cells", () => {
    expect(panelCount([block({ omitted: [0, 5] })])).toBe(10);
  });

  it("ignores out-of-range and duplicate omissions rather than going negative", () => {
    expect(panelCount([block({ omitted: [0, 0, 99, -1] })])).toBe(11);
  });

  it("sums across blocks", () => {
    expect(panelCount([block(), block({ id: "b2", cols: 2, rows: 2 })])).toBe(16);
  });

  it("is zero for an empty drawing", () => {
    expect(panelCount([])).toBe(0);
    expect(panelCount([block({ cols: 0, rows: 0 })])).toBe(0);
  });
});

describe("rotation is rigid", () => {
  it("moves panels without changing how many there are or how big they are", () => {
    const flat = panelCorners(block(), MODULE_FALLBACK_MM);
    const tilted = panelCorners(block({ rotationDeg: 37 }), MODULE_FALLBACK_MM);
    expect(tilted.length).toBe(flat.length);

    const side = (q: { e: number; n: number }[]) => Math.hypot(q[1].e - q[0].e, q[1].n - q[0].n);
    expect(side(tilted[0])).toBeCloseTo(side(flat[0]), 9);
  });

  it("turns east into south at 90 degrees clockwise", () => {
    const [first] = panelCorners(
      block({ cols: 1, rows: 1, rotationDeg: 90 }),
      MODULE_FALLBACK_MM
    );
    // The corner one panel-width east of the origin is now one width south.
    expect(first[1].e).toBeCloseTo(0, 6);
    expect(first[1].n).toBeCloseTo(-panelSizeM(MODULE_FALLBACK_MM, "portrait").w, 6);
  });

  it("spaces neighbouring panels by exactly one gap", () => {
    const q = panelCorners(block({ cols: 2, rows: 1 }), MODULE_FALLBACK_MM);
    const { w } = panelSizeM(MODULE_FALLBACK_MM, "portrait");
    // Left edge of panel 2 minus left edge of panel 1 is one pitch: w + gap.
    expect(q[1][0].e - q[0][0].e).toBeCloseTo(w + PANEL_GAP_M, 9);
    // And the panels do not overlap: panel 1's right edge is a gap short of it.
    expect(q[1][0].e - q[0][1].e).toBeCloseTo(PANEL_GAP_M, 9);
  });

  it("emits four corners per present panel, and skips the omitted ones", () => {
    const q = panelCorners(block({ omitted: [1] }), MODULE_FALLBACK_MM);
    expect(q).toHaveLength(11);
    expect(q.every((c) => c.length === 4)).toBe(true);
  });
});

describe("metres survive a change of zoom", () => {
  // What the imagery route actually serves.
  const IMG = { widthPx: 1280, heightPx: 720 };

  it("moves a ground point twice as far from centre when the zoom doubles", () => {
    const a = metresToImagePx(10, -4, metresPerPixel(32.7, 20, 2), IMG);
    const b = metresToImagePx(10, -4, metresPerPixel(32.7, 21, 2), IMG);
    expect(b.x - IMG.widthPx / 2).toBeCloseTo((a.x - IMG.widthPx / 2) * 2, 6);
    expect(b.y - IMG.heightPx / 2).toBeCloseTo((a.y - IMG.heightPx / 2) * 2, 6);
  });

  it("puts north above centre and east to the right", () => {
    const px = metresToImagePx(10, 10, metresPerPixel(32.7, 20, 2), IMG);
    expect(px.x).toBeGreaterThan(IMG.widthPx / 2);
    expect(px.y).toBeLessThan(IMG.heightPx / 2);
  });

  it("centres on the image it was given, not on a square guess", () => {
    // 1280x720 halves to (640, 360). Assuming a square would put the origin at
    // (640, 640) and drop the whole array 280px below the roof.
    const px = metresToImagePx(0, 0, metresPerPixel(32.7, 20, 2), IMG);
    expect(px).toEqual({ x: 640, y: 360 });
  });
});

describe("reading a stored layout", () => {
  it("keeps well-formed blocks", () => {
    expect(parseLayoutBlocks([block()])).toHaveLength(1);
  });

  it("drops anything malformed rather than letting it reach the canvas", () => {
    // A design row is JSON: it can hold whatever an old version, a bad migration
    // or a hand edit put there, and a NaN origin would draw a panel nowhere.
    expect(parseLayoutBlocks([{ ...block(), originE: "x" }])).toEqual([]);
    expect(parseLayoutBlocks([{ ...block(), originN: NaN }])).toEqual([]);
    expect(parseLayoutBlocks([{ ...block(), cols: 1.5 }])).toEqual([]);
    expect(parseLayoutBlocks([{ ...block(), orientation: "diagonal" }])).toEqual([]);
    expect(parseLayoutBlocks([null, undefined, 3, "block"])).toEqual([]);
  });

  it("reads a missing or non-array value as an empty drawing", () => {
    expect(parseLayoutBlocks(undefined)).toEqual([]);
    expect(parseLayoutBlocks({})).toEqual([]);
  });
});

describe("the block's own frame", () => {
  it("round-trips a point through ground metres at any rotation", () => {
    // The resize grip converts a pointer BACK into the block frame. If the two
    // directions disagree, dragging a rotated block resizes it along north
    // instead of along its own rows.
    for (const rotationDeg of [0, 37, 90, -128, 355]) {
      const b = block({ rotationDeg, originE: 3, originN: -7 });
      const g = blockLocalToGround(b, 2.5, 1.25);
      const back = groundToBlockLocal(b, g.e, g.n);
      expect(back.x).toBeCloseTo(2.5, 9);
      expect(back.y).toBeCloseTo(1.25, 9);
    }
  });

  it("puts the block's own origin at its origin", () => {
    const b = block({ rotationDeg: 61, originE: 4, originN: 9 });
    const g = blockLocalToGround(b, 0, 0);
    expect(g.e).toBeCloseTo(4, 9);
    expect(g.n).toBeCloseTo(9, 9);
  });

  it("agrees with the panel corners it positions", () => {
    // The grips are placed with blockLocalToGround and the panels with
    // panelCorners. This is the assertion that keeps them on the same roof.
    const b = block({ rotationDeg: 24, cols: 3, rows: 2 });
    const corners = panelCorners(b, MODULE_FALLBACK_MM);
    const { spanX, spanY } = blockSpanM(b, MODULE_FALLBACK_MM);
    const bottomRight = blockLocalToGround(b, spanX, spanY);
    const lastPanelBottomRight = corners[corners.length - 1][2];
    expect(bottomRight.e).toBeCloseTo(lastPanelBottomRight.e, 9);
    expect(bottomRight.n).toBeCloseTo(lastPanelBottomRight.n, 9);
  });

  it("measures a span as panels plus the gaps between them", () => {
    const { w, h } = panelSizeM(MODULE_FALLBACK_MM, "portrait");
    const { spanX, spanY } = blockSpanM(block({ cols: 3, rows: 2 }), MODULE_FALLBACK_MM);
    expect(spanX).toBeCloseTo(3 * w + 2 * PANEL_GAP_M, 9);
    expect(spanY).toBeCloseTo(2 * h + 1 * PANEL_GAP_M, 9);
  });
});

// ---------------------------------------------------------------------------
// Putting a panel back
// ---------------------------------------------------------------------------

describe("absorbPanel", () => {
  const M: ModuleMm = { widthMm: 1000, heightMm: 1000 };

  /** A 3 x 2 array at the origin, pointing north, with nothing knocked out. */
  const grid = (): LayoutBlock => ({
    id: "grid",
    originE: 0,
    originN: 0,
    rotationDeg: 0,
    cols: 3,
    rows: 2,
    orientation: "portrait",
    omitted: [],
  });

  it("puts a panel back in the hole it came out of", () => {
    const pulled = detachPanel([grid()], "grid", 4, M, "loose")!;
    expect(pulled.blocks).toHaveLength(2);

    const back = absorbPanel(pulled.blocks, "loose", M);
    expect(back).not.toBeNull();
    expect(back!.blocks).toHaveLength(1);
    expect(back!.blocks[0].id).toBe("grid");
    expect(blockPanelCount(back!.blocks[0])).toBe(6);
    expect(back!.blocks[0].omitted).toHaveLength(0);
  });

  it("leaves a panel dragged well clear of the array alone", () => {
    const pulled = detachPanel([grid()], "grid", 4, M, "loose")!;
    const moved = pulled.blocks.map((b) =>
      b.id === "loose" ? { ...b, originE: b.originE + 9, originN: b.originN - 9 } : b
    );
    expect(absorbPanel(moved, "loose", M)).toBeNull();
  });

  it("takes a panel nudged a few centimetres as meant for its own cell", () => {
    const pulled = detachPanel([grid()], "grid", 4, M, "loose")!;
    // Eight centimetres off — a hand that did not quite land, not a decision.
    const nudged = pulled.blocks.map((b) =>
      b.id === "loose" ? { ...b, originE: b.originE + 0.08, originN: b.originN + 0.05 } : b
    );
    const back = absorbPanel(nudged, "loose", M)!;
    expect(back.blocks).toHaveLength(1);
    expect(blockPanelCount(back.blocks[0])).toBe(6);
  });

  it("grows the array when the panel is dropped just off its edge", () => {
    const pulled = detachPanel([grid()], "grid", 4, M, "loose")!;
    // One whole cell to the right of the array's last column.
    const out = pulled.blocks.map((b) =>
      b.id === "loose" ? { ...b, originE: 3 * (1 + PANEL_GAP_M) } : b
    );
    const back = absorbPanel(out, "loose", M)!;
    expect(back.blocks).toHaveLength(1);
    expect(back.blocks[0].cols).toBe(4);
    expect(blockPanelCount(back.blocks[0])).toBe(6);
  });

  it("refuses to stack a panel on one already there", () => {
    const pulled = detachPanel([grid()], "grid", 4, M, "loose")!;
    // Back onto cell 0, which still has its panel.
    const onTop = pulled.blocks.map((b) =>
      b.id === "loose" ? { ...b, originE: 0, originN: 0 } : b
    );
    expect(absorbPanel(onTop, "loose", M)).toBeNull();
  });

  it("will not fold a panel into an array lying at another angle", () => {
    const pulled = detachPanel([grid()], "grid", 4, M, "loose")!;
    const turned = pulled.blocks.map((b) =>
      b.id === "loose" ? { ...b, rotationDeg: 35 } : b
    );
    expect(absorbPanel(turned, "loose", M)).toBeNull();
  });

  it("does nothing to an array that is not a lone panel", () => {
    expect(absorbPanel([grid()], "grid", M)).toBeNull();
  });
});
