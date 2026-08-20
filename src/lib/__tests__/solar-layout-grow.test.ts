import { describe, expect, it } from "vitest";
import {
  addPanelAtCell,
  cellAt,
  cellDistance,
  growBlock,
  growGhosts,
  holeQuads,
  blockPanelCount,
  panelCorners,
  parseLayoutSetbacks,
  setbackBands,
  clampShade,
  DEFAULT_SETBACK_M,
  PANEL_GAP_M,
  panelSizeM,
  type LayoutBlock,
  type ModuleMm,
} from "../solar-layout";

const M: ModuleMm = { widthMm: 1000, heightMm: 2000 };

const block = (over: Partial<LayoutBlock> = {}): LayoutBlock => ({
  id: "b1",
  originE: 0,
  originN: 0,
  rotationDeg: 0,
  cols: 3,
  rows: 2,
  orientation: "portrait",
  omitted: [],
  ...over,
});

describe("growBlock", () => {
  it("adds a column on the right without moving the origin", () => {
    const g = growBlock(block(), "right", M);
    expect(g.cols).toBe(4);
    expect(g.rows).toBe(2);
    expect(g.originE).toBe(0);
    expect(g.originN).toBe(0);
    expect(blockPanelCount(g)).toBe(8);
  });

  it("adds a column on the left by walking the origin back one module", () => {
    const g = growBlock(block(), "left", M);
    expect(g.cols).toBe(4);
    // Unrotated, the block's +x runs east, so a new column on the left starts
    // one module plus a rail gap further west.
    expect(g.originE).toBeCloseTo(-(1 + PANEL_GAP_M), 6);
    expect(g.originN).toBeCloseTo(0, 6);
  });

  it("adds a row on top by walking the origin north one module", () => {
    const g = growBlock(block(), "top", M);
    expect(g.rows).toBe(3);
    // +y runs down the rows, which is south, so up is +north.
    expect(g.originN).toBeCloseTo(2 + PANEL_GAP_M, 6);
    expect(g.originE).toBeCloseTo(0, 6);
  });

  it("adds a row on the bottom without moving the origin", () => {
    const g = growBlock(block(), "bottom", M);
    expect(g.rows).toBe(3);
    expect(g.originN).toBe(0);
  });

  /**
   * The regression this function exists for: a hole is a row-major index, so
   * widening the grid without remapping slides every removed panel one column
   * to the left. On screen the array rearranges itself around the gap.
   */
  it("keeps a knocked-out cell on the same panel when a column is added right", () => {
    const before = block({ omitted: [4] }); // 3 wide: row 1, col 1
    const g = growBlock(before, "right", M);
    expect(g.omitted).toEqual([5]); // 4 wide: row 1, col 1
    const held = panelCorners(g, M);
    // The hole is still the middle of the second row: 4x2 less one is 7.
    expect(held).toHaveLength(7);
  });

  it("keeps a knocked-out cell on the same panel when a column is added left", () => {
    const g = growBlock(block({ omitted: [4] }), "left", M);
    // row 1, col 1 becomes row 1, col 2 of a 4-wide grid.
    expect(g.omitted).toEqual([6]);
  });

  it("keeps a knocked-out cell on the same panel when a row is added on top", () => {
    const g = growBlock(block({ omitted: [4] }), "top", M);
    expect(g.omitted).toEqual([7]);
  });

  it("leaves indices alone when a row is added at the bottom", () => {
    const g = growBlock(block({ omitted: [4] }), "bottom", M);
    expect(g.omitted).toEqual([4]);
  });

  it("drops indices that were already off the end", () => {
    const g = growBlock(block({ omitted: [99] }), "right", M);
    expect(g.omitted).toEqual([]);
  });

  it("survives a rotated block: the new column sits along the block's own rows", () => {
    const g = growBlock(block({ rotationDeg: 90 }), "left", M);
    // Rotated 90° clockwise from north, the block's +x runs south, so "back one
    // module along +x" is one module north.
    expect(g.originN).toBeCloseTo(1 + PANEL_GAP_M, 6);
    expect(g.originE).toBeCloseTo(0, 6);
  });
});

describe("growGhosts", () => {
  it("offers all four sides, each one module deep", () => {
    const ghosts = growGhosts(block(), M);
    expect(ghosts.map((g) => g.side).sort()).toEqual(["bottom", "left", "right", "top"]);
    for (const g of ghosts) expect(g.corners).toHaveLength(4);
  });

  /**
   * A side ghost covers the WHOLE column it would add, not one panel, so it is
   * checked against the first and last cell of that column: its top-left is
   * where the new row-0 panel starts and its bottom-right is where the new
   * bottom-row panel ends. A ghost that does not land on the panels the click
   * actually creates is a button that points somewhere else.
   */
  it("puts the right-hand ghost exactly where the added column lands", () => {
    const ghost = growGhosts(block(), M).find((g) => g.side === "right")!;
    const grown = growBlock(block(), "right", M);
    const cells = panelCorners(grown, M);
    const topRight = cells[3]; // row 0, col 3 of a 4-wide grid
    const bottomRight = cells[7]; // row 1, col 3
    expect(ghost.corners[0].e).toBeCloseTo(topRight[0].e, 6);
    expect(ghost.corners[0].n).toBeCloseTo(topRight[0].n, 6);
    expect(ghost.corners[2].e).toBeCloseTo(bottomRight[2].e, 6);
    expect(ghost.corners[2].n).toBeCloseTo(bottomRight[2].n, 6);
  });
});

describe("holeQuads", () => {
  it("gives a quad for every knocked-out cell, in index order", () => {
    const holes = holeQuads(block({ omitted: [4, 1] }), M);
    expect(holes.map((h) => h.index)).toEqual([1, 4]);
  });

  it("puts a hole exactly where the panel it replaced was", () => {
    const full = panelCorners(block(), M);
    const hole = holeQuads(block({ omitted: [4] }), M)[0];
    for (let i = 0; i < 4; i++) {
      expect(hole.corners[i].e).toBeCloseTo(full[4][i].e, 6);
      expect(hole.corners[i].n).toBeCloseTo(full[4][i].n, 6);
    }
  });

  it("ignores indices outside the grid", () => {
    expect(holeQuads(block({ omitted: [900] }), M)).toEqual([]);
  });
});

describe("shade clamping", () => {
  it("keeps a shade inside 0..100", () => {
    expect(clampShade(140)).toBe(100);
    expect(clampShade(-5)).toBe(0);
    expect(clampShade(37)).toBe(37);
  });

  it("reads a missing or broken shade as unrecorded", () => {
    expect(clampShade(null)).toBeNull();
    expect(clampShade(undefined)).toBeNull();
    expect(clampShade(Number.NaN)).toBeNull();
  });
});

describe("setbacks", () => {
  it("reads a traced setback back", () => {
    const parsed = parseLayoutSetbacks([
      { id: "s1", points: [{ e: 0, n: 0 }, { e: 10, n: 0 }], widthM: 0.9 },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].points).toHaveLength(2);
  });

  it("drops a line with fewer than two points — it is not a line", () => {
    expect(parseLayoutSetbacks([{ id: "s1", points: [{ e: 0, n: 0 }], widthM: 1 }])).toEqual([]);
  });

  it("falls back to the code-standard width rather than a zero-wide band", () => {
    const parsed = parseLayoutSetbacks([
      { id: "s1", points: [{ e: 0, n: 0 }, { e: 4, n: 0 }] },
    ]);
    expect(parsed[0].widthM).toBe(DEFAULT_SETBACK_M);
  });

  it("reads junk as nothing drawn", () => {
    expect(parseLayoutSetbacks("nope")).toEqual([]);
    expect(parseLayoutSetbacks([null, 3, { id: 7 }])).toEqual([]);
  });

  it("bands an east-west line evenly north and south of it", () => {
    const bands = setbackBands({
      id: "s",
      points: [{ e: 0, n: 0 }, { e: 10, n: 0 }],
      widthM: 2,
    });
    expect(bands).toHaveLength(1);
    const ns = bands[0].map((p) => p.n).sort((a, b) => a - b);
    expect(ns[0]).toBeCloseTo(-1, 6);
    expect(ns[3]).toBeCloseTo(1, 6);
  });

  it("gives one band per segment of a traced run", () => {
    const bands = setbackBands({
      id: "s",
      points: [{ e: 0, n: 0 }, { e: 5, n: 0 }, { e: 5, n: 5 }],
      widthM: 1,
    });
    expect(bands).toHaveLength(2);
  });

  it("skips a zero-length segment rather than dividing by it", () => {
    const bands = setbackBands({
      id: "s",
      points: [{ e: 2, n: 2 }, { e: 2, n: 2 }],
      widthM: 1,
    });
    expect(bands).toEqual([]);
  });
});

describe("panelSizeM still turns a module the right way round", () => {
  it("swaps the sides for landscape", () => {
    expect(panelSizeM(M, "portrait")).toEqual({ w: 1, h: 2 });
    expect(panelSizeM(M, "landscape")).toEqual({ w: 2, h: 1 });
  });
});

describe("joining an array instead of scattering singles", () => {
  const M2: ModuleMm = { widthMm: 1000, heightMm: 2000 };
  const at = (row: number, col: number) => ({ row, col });

  it("finds which cell of the lattice a point falls in", () => {
    const b = block({ cols: 3, rows: 2 });
    // Middle of the panel at row 0, col 0.
    expect(cellAt(b, M2, { e: 0.5, n: -1 })).toEqual(at(0, 0));
    // One module to the right.
    expect(cellAt(b, M2, { e: 1.5, n: -1 })).toEqual(at(0, 1));
    // One row down: +y in the block frame is south, so n goes negative.
    expect(cellAt(b, M2, { e: 0.5, n: -3 })).toEqual(at(1, 0));
  });

  /** Negative and past-the-end indices are the point — that is how a click just
   *  off the edge says "extend to meet me". */
  it("answers with a negative cell for a point off the left or top", () => {
    const b = block({ cols: 3, rows: 2 });
    expect(cellAt(b, M2, { e: -0.5, n: -1 }).col).toBe(-1);
    expect(cellAt(b, M2, { e: 0.5, n: 1 }).row).toBe(-1);
  });

  it("measures how far a cell is from the block in whole cells", () => {
    const b = block({ cols: 3, rows: 2 });
    expect(cellDistance(b, at(0, 0))).toBe(0); // inside
    expect(cellDistance(b, at(0, 3))).toBe(1); // touching the right edge
    expect(cellDistance(b, at(-1, 0))).toBe(1); // touching the top
    expect(cellDistance(b, at(0, 5))).toBe(3); // plainly somewhere else
  });

  it("adds ONE panel on the edge, not a whole column", () => {
    const before = block({ cols: 3, rows: 2 });
    const after = addPanelAtCell(before, at(0, 3), M2);
    expect(after.cols).toBe(4);
    // 6 were there, 1 was asked for. A bare grow would have given 8.
    expect(blockPanelCount(after)).toBe(7);
  });

  /**
   * By POSITION, not by index. Widening the grid renumbers every cell, so the
   * nth panel before is not the nth panel after — what has to hold is that
   * every panel still sits exactly where it did on the roof.
   */
  it("keeps every existing panel exactly where it was", () => {
    const before = block({ cols: 3, rows: 2 });
    const after = addPanelAtCell(before, at(0, 3), M2);
    const key = (q: { e: number; n: number }[]) => `${q[0].e.toFixed(6)},${q[0].n.toFixed(6)}`;
    const afterKeys = new Set(panelCorners(after, M2).map(key));
    for (const q of panelCorners(before, M2)) expect(afterKeys.has(key(q))).toBe(true);
    expect(afterKeys.size).toBe(7);
  });

  /**
   * Growing left or up renumbers every row-major index, so carrying the old
   * cells across BY INDEX would slide the whole array around the new panel.
   */
  it("keeps them in place when the grid grows leftwards", () => {
    const before = block({ cols: 3, rows: 2 });
    const after = addPanelAtCell(before, at(0, -1), M2);
    expect(after.cols).toBe(4);
    expect(blockPanelCount(after)).toBe(7);
    const beforeFirst = panelCorners(before, M2)[0][0];
    // The original row-0 col-0 panel is now at col 1, and has not moved on the
    // roof — the origin walked back a module instead.
    const afterCells = panelCorners(after, M2);
    const stillThere = afterCells.some(
      (q) => Math.abs(q[0].e - beforeFirst.e) < 1e-6 && Math.abs(q[0].n - beforeFirst.n) < 1e-6
    );
    expect(stillThere).toBe(true);
  });

  it("fills a hole rather than growing when the cell is inside", () => {
    const before = block({ cols: 3, rows: 2, omitted: [4] });
    expect(blockPanelCount(before)).toBe(5);
    const after = addPanelAtCell(before, at(1, 1), M2);
    expect(after.cols).toBe(3);
    expect(after.rows).toBe(2);
    expect(blockPanelCount(after)).toBe(6);
  });

  it("reaches a cell two out diagonally without filling the space between", () => {
    const before = block({ cols: 2, rows: 2 });
    const after = addPanelAtCell(before, at(-1, 2), M2);
    expect(blockPanelCount(after)).toBe(5); // the 4 that were there, plus one
    expect(after.rows).toBe(3);
    expect(after.cols).toBe(3);
  });

  it("leaves a single panel a single panel when it is asked for its own cell", () => {
    const before = block({ cols: 1, rows: 1 });
    const after = addPanelAtCell(before, at(0, 0), M2);
    expect(blockPanelCount(after)).toBe(1);
    expect(after.cols).toBe(1);
    expect(after.rows).toBe(1);
  });
});
