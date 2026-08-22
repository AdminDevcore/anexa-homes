import { describe, it, expect } from "vitest";
import {
  autoFillRoof,
  pruneToTarget,
  pruneToCount,
  FILL_REACH_M,
  MIN_POINTS_PER_SEGMENT,
} from "@/lib/solar-autofill";
import {
  panelCorners,
  blockPanelCount,
  MODULE_FALLBACK_MM,
  type LayoutBlock,
  type ModuleMm,
} from "@/lib/solar-layout";
import type { RoofPlanes, RoofSegment } from "@/lib/solar-roof-planes";

// ---------------------------------------------------------------------------
// Building a roof to fill
// ---------------------------------------------------------------------------

const segment = (over: Partial<RoofSegment> = {}): RoofSegment => ({
  index: 0,
  pitchDeg: 20,
  // East, so the block frame is (+e, -n) and the arithmetic in these tests is
  // readable. `azimuth = rotation + 90`, so this segment rotates to zero.
  azimuthDeg: 90,
  areaM2: 40,
  centerE: 3,
  centerN: -2,
  ...over,
});

/**
 * Google's panel centres over a rectangle of roof, one per metre.
 *
 * A metre is tighter than Google's real spacing, which keeps the fixture about
 * the mask rather than about sampling density: every cell inside the rectangle
 * is unambiguously covered and every cell outside it is unambiguously not.
 */
function points(
  box: { e0: number; e1: number; n0: number; n1: number },
  segmentIndex = 0,
  step = 1
): RoofPlanes["panels"] {
  const out: RoofPlanes["panels"] = [];
  for (let e = box.e0; e <= box.e1 + 1e-9; e += step) {
    for (let n = box.n0; n <= box.n1 + 1e-9; n += step) {
      out.push({ e, n, segmentIndex });
    }
  }
  return out;
}

const roof = (
  segments: RoofSegment[],
  panels: RoofPlanes["panels"]
): RoofPlanes => ({
  segments,
  panels,
  imageryQuality: "HIGH",
  imageryDate: "March 2025",
});

/** Every present panel's centre, in ground metres. */
function centres(b: LayoutBlock, m: ModuleMm): { e: number; n: number }[] {
  return panelCorners(b, m).map((c) => ({
    e: (c[0].e + c[2].e) / 2,
    n: (c[0].n + c[2].n) / 2,
  }));
}

function nearestPoint(
  p: { e: number; n: number },
  pts: RoofPlanes["panels"]
): number {
  let best = Infinity;
  for (const q of pts) best = Math.min(best, Math.hypot(q.e - p.e, q.n - p.n));
  return best;
}

// ---------------------------------------------------------------------------

describe("autoFillRoof", () => {
  it("returns nothing for a roof nobody has looked up", () => {
    expect(autoFillRoof(null, { module: MODULE_FALLBACK_MM })).toEqual([]);
  });

  it("fills a plane and takes its facing and pitch from the roof", () => {
    const seg = segment({ azimuthDeg: 176.4, pitchDeg: 26.6 });
    const planes = roof([seg], points({ e0: 0, e1: 6, n0: -4, n1: 0 }));

    const blocks = autoFillRoof(planes, { module: MODULE_FALLBACK_MM });

    expect(blocks).toHaveLength(1);
    expect(blocks[0].azimuthDeg).toBe(176.4);
    expect(blocks[0].tiltDeg).toBe(26.6);
    // Read off the building, not typed by a rep — the proposal says which.
    expect(blocks[0].facingSource).toBe("roof");
    expect(blockPanelCount(blocks[0])).toBeGreaterThan(0);
  });

  it("keeps the grid square to the plane it sits on", () => {
    // The designer's own rule, inverted: a block whose rotation is 90 less than
    // its facing has its columns running straight down the slope.
    const planes = roof(
      [segment({ azimuthDeg: 210 })],
      points({ e0: 0, e1: 8, n0: -6, n1: 0 })
    );
    const [block] = autoFillRoof(planes, { module: MODULE_FALLBACK_MM });
    expect(block.rotationDeg).toBeCloseTo(120, 6);
  });

  it("never puts a panel where the roof is not", () => {
    const pts = points({ e0: 0, e1: 8, n0: -6, n1: 0 });
    const planes = roof([segment()], pts);

    const [block] = autoFillRoof(planes, { module: MODULE_FALLBACK_MM });

    // The guarantee the whole fill rests on: every panel it placed sits on a
    // part of the roof Google modelled, so nothing hangs over an eave.
    for (const c of centres(block, MODULE_FALLBACK_MM)) {
      expect(nearestPoint(c, pts)).toBeLessThanOrEqual(FILL_REACH_M);
    }
  });

  it("leaves a hole where the roof has one", () => {
    // An L: the top-right quarter of the rectangle is not roof.
    const pts = points({ e0: 0, e1: 9, n0: -7, n1: 0 }).filter(
      (p) => !(p.e > 5 && p.n > -3)
    );
    const planes = roof([segment()], pts);

    const [block] = autoFillRoof(planes, { module: MODULE_FALLBACK_MM });

    expect(block.omitted.length).toBeGreaterThan(0);
    for (const c of centres(block, MODULE_FALLBACK_MM)) {
      expect(nearestPoint(c, pts)).toBeLessThanOrEqual(FILL_REACH_M);
    }
  });

  it("fills every plane of a hip roof, each with its own facing", () => {
    const planes = roof(
      [
        segment({ index: 0, azimuthDeg: 180, centerE: 0, centerN: 0 }),
        segment({ index: 1, azimuthDeg: 90, centerE: 20, centerN: 0 }),
        segment({ index: 2, azimuthDeg: 0, centerE: 40, centerN: 0 }),
      ],
      [
        ...points({ e0: -3, e1: 3, n0: -3, n1: 3 }, 0),
        ...points({ e0: 17, e1: 23, n0: -3, n1: 3 }, 1),
        ...points({ e0: 37, e1: 43, n0: -3, n1: 3 }, 2),
      ]
    );

    const blocks = autoFillRoof(planes, { module: MODULE_FALLBACK_MM });

    expect(blocks).toHaveLength(3);
    expect(blocks.map((b) => b.azimuthDeg).sort((a, b) => Number(a) - Number(b))).toEqual([
      0, 90, 180,
    ]);
    // One block per plane, so nothing straddles a ridge and every array prices
    // on the plane it is actually on.
    expect(new Set(blocks.map((b) => b.id)).size).toBe(3);
  });

  it("skips a plane Google barely modelled", () => {
    const planes = roof(
      [segment()],
      Array.from({ length: MIN_POINTS_PER_SEGMENT - 1 }, (_, i) => ({
        e: i * 0.5,
        n: 0,
        segmentIndex: 0,
      }))
    );
    expect(autoFillRoof(planes, { module: MODULE_FALLBACK_MM })).toEqual([]);
  });

  it("fits fewer of a bigger panel on the same roof", () => {
    const planes = roof([segment()], points({ e0: 0, e1: 10, n0: -8, n1: 0 }));

    const small = autoFillRoof(planes, { module: { widthMm: 1134, heightMm: 1762 } });
    const large = autoFillRoof(planes, { module: { widthMm: 1134, heightMm: 2278 } });

    expect(blockPanelCount(large[0])).toBeLessThan(blockPanelCount(small[0]));
  });

  it("gives each block a stable id, so a refill does not duplicate arrays", () => {
    const planes = roof([segment()], points({ e0: 0, e1: 6, n0: -4, n1: 0 }));
    const first = autoFillRoof(planes, { module: MODULE_FALLBACK_MM });
    const second = autoFillRoof(planes, { module: MODULE_FALLBACK_MM });
    expect(first.map((b) => b.id)).toEqual(second.map((b) => b.id));
  });
});

// ---------------------------------------------------------------------------

describe("pruneToTarget", () => {
  const block = (over: Partial<LayoutBlock> = {}): LayoutBlock => ({
    id: "b1",
    originE: 0,
    originN: 0,
    rotationDeg: 0,
    cols: 4,
    rows: 2,
    orientation: "portrait",
    omitted: [],
    azimuthDeg: 180,
    tiltDeg: 25,
    facingSource: "roof",
    shadePct: null,
    ...over,
  });

  /** 100 kWh a panel, flat, unless a block says otherwise. */
  const flat = () => 100;

  it("leaves a system that does not reach the target alone", () => {
    const blocks = [block()]; // 8 panels x 100 = 800
    const out = pruneToTarget(blocks, flat, 1000);
    expect(out.removed).toBe(0);
    expect(out.blocks).toEqual(blocks);
  });

  it("removes the fewest panels that still clear the target", () => {
    const blocks = [block()]; // 800 kWh
    const out = pruneToTarget(blocks, flat, 550);
    // Six panels is 600, which clears it; five is 500, which does not.
    expect(blockPanelCount(out.blocks[0])).toBe(6);
    expect(out.removed).toBe(2);
    expect(out.productionKwh).toBe(600);
  });

  it("takes the worst-facing panels first", () => {
    const south = block({ id: "s", azimuthDeg: 180, cols: 4, rows: 1 });
    const north = block({ id: "n", azimuthDeg: 0, cols: 4, rows: 1 });
    const value = (b: LayoutBlock) => (b.id === "s" ? 150 : 80);
    // 4 x 150 + 4 x 80 = 920. Target 700.
    const out = pruneToTarget([south, north], value, 700);

    const kept = Object.fromEntries(out.blocks.map((b) => [b.id, blockPanelCount(b)]));
    // The south face is untouched; the north face gives up panels until one
    // more would drop the system under the target.
    expect(kept.s).toBe(4);
    expect(kept.n).toBe(2);
    expect(out.productionKwh).toBe(760);
  });

  it("does nothing when the system produces nothing", () => {
    // An empty equipment catalogue leaves every panel worth zero. Pruning on
    // that would delete the array to chase a target it can never reach.
    const blocks = [block()];
    const out = pruneToTarget(blocks, () => 0, 500);
    expect(out.removed).toBe(0);
    expect(out.blocks).toEqual(blocks);
  });

  it("ignores a target of zero rather than stripping the roof", () => {
    const blocks = [block()];
    expect(pruneToTarget(blocks, flat, 0).removed).toBe(0);
  });

  it("counts down to a panel count, worst first", () => {
    const south = block({ id: "s", azimuthDeg: 180, cols: 4, rows: 1 });
    const north = block({ id: "n", azimuthDeg: 0, cols: 4, rows: 1 });
    const value = (b: LayoutBlock) => (b.id === "s" ? 150 : 80);

    const out = pruneToCount([south, north], value, 5);

    const kept = Object.fromEntries(out.blocks.map((b) => [b.id, blockPanelCount(b)]));
    expect(kept.s).toBe(4);
    expect(kept.n).toBe(1);
    expect(out.removed).toBe(3);
  });

  it("leaves a system already under the count alone", () => {
    const blocks = [block()]; // 8 panels
    expect(pruneToCount(blocks, flat, 20).removed).toBe(0);
    expect(pruneToCount(blocks, flat, 8).removed).toBe(0);
  });

  it("will not count a system below what it can reach", () => {
    // Zero-value panels are never removed, so a count no removal can satisfy
    // stops rather than spinning.
    const blocks = [block()];
    const out = pruneToCount(blocks, () => 0, 1);
    expect(out.removed).toBe(0);
  });

  it("peels a block from its far edge so the array stays tidy", () => {
    const blocks = [block({ cols: 4, rows: 2 })]; // 800
    const out = pruneToTarget(blocks, flat, 450);
    // Three off the end of the bottom row, right to left — not holes punched
    // through the middle of a rectangle somebody has to install.
    expect(out.blocks[0].omitted.sort((a, b) => a - b)).toEqual([5, 6, 7]);
    expect(out.productionKwh).toBe(500);
  });
});
