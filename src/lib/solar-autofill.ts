/**
 * Filling a roof with panels, and then taking the worst ones back off.
 *
 * The workflow this replaces: a rep drags a rectangle over a roof face, gets a
 * grid, and hand-deletes the cells that hang over the eave. The saved design
 * for 404 Shoreline is what that produces — ten blocks, four of them empty
 * leftovers, and a main array of eleven by five with thirty-nine of its
 * fifty-five cells knocked out by hand. Every one of those deletions is a
 * judgement about where the roof ends, made by eye, at speed, on a sales call.
 *
 * The building already knows where the roof ends. `solar-roof-planes` explains
 * why Google's own panel placements are the trustworthy part of its answer: a
 * dense labelled point cloud, several hundred points on a house, each stamped
 * with the plane it sits on and already inset from the edges where a setback
 * would be. That module uses the cloud to LABEL an array a rep drew. This one
 * uses it to DRAW the array.
 *
 * So the mask is not ours. We do not decide where a roof ends, how far a panel
 * must sit from a valley, or which planes are worth using — Google's model
 * decides all three, and this module lays our grid over what it found.
 *
 * WHY A GRID AT ALL, when Google hands back positions. Because a `LayoutBlock`
 * is what the rest of the system understands: the designer drags it, the
 * proposal draws it, `solar-arrays` prices it, and the plane assignment that
 * feeds PVWatts reads it. Emitting loose panels would fork every one of those.
 * A block with the right cells omitted is the same picture in the vocabulary
 * that is already there — which is also why the fill is EDITABLE the moment it
 * lands: it is an ordinary array, not a special object a rep cannot touch.
 *
 * WHAT THIS IS NOT. It is not a shading study and it is not a stringing plan.
 * It gets a roof covered in seconds so the conversation is about the numbers
 * instead of the mouse, and every panel it places can be clicked off.
 *
 * Pure and network-free, like every other `solar-*` lib.
 */

import {
  PANEL_GAP_M,
  blockLocalToGround,
  blockPanelCount,
  cellCorners,
  groundToBlockLocal,
  panelSizeM,
  type LayoutBlock,
  type ModuleMm,
  type Orientation,
} from "./solar-layout";
import { norm360, type RoofPlanes, type RoofSegment } from "./solar-roof-planes";

// ---------------------------------------------------------------------------
// Filling
// ---------------------------------------------------------------------------

/**
 * How far a cell may sit from the nearest of Google's panel centres and still
 * count as being on the roof, in metres.
 *
 * The cloud is centres, not coverage, so the figure has to span the gap between
 * two of them or a grid whose phase falls between rows reads as off-roof
 * everywhere. Google's residential module is about 1.05 m by 1.88 m, giving a
 * half-diagonal of roughly 1.08 m; 1.3 m clears that with a little margin.
 *
 * Deliberately NOT generous. This is the number that keeps panels off the lawn,
 * and every metre added to it buys a few more panels by quietly moving them
 * over an eave. `NEAREST_PANEL_CUTOFF_M` in `solar-roof-planes` is 3 m and can
 * afford to be, because it is deciding which plane a panel is on rather than
 * whether there is a roof under it at all.
 */
export const FILL_REACH_M = 1.3;

/**
 * How many of Google's panels a plane needs before it is worth filling.
 *
 * A plane with three points on it is a dormer cheek or the sliver left over
 * where two hips meet. Filling it produces an array of one panel that a rep has
 * to notice and delete, which is the cost this module exists to remove.
 */
export const MIN_POINTS_PER_SEGMENT = 6;

/**
 * How many grid phases are tried per orientation, per axis.
 *
 * A grid laid from the corner of a bounding box is not the grid that fits best:
 * shifting it a third of a panel can pick up a whole extra column, because the
 * cells that were half over the edge come back on. Four offsets on each axis in
 * each of two orientations is thirty-two candidate grids for a plane, which is
 * nothing to compute and is worth about a panel a roof.
 */
const PHASE_STEPS = 4;

/** A cell must have all of these on the roof, as a share of its half-size. */
const CORNER_INSET = 0.72;

export type AutoFillOptions = {
  module: ModuleMm;
  /** Overridable so a company with a tighter fire setback can say so. */
  reachM?: number;
  minPointsPerSegment?: number;
};

/**
 * Every plane of a roof, filled with as many panels as it will hold.
 *
 * One block per plane on purpose. An array that spans a ridge is priced on one
 * facing when it sits on two, which is the failure `assignPlanes` reports as
 * straddling — so the fill never creates one.
 *
 * Null planes is the ordinary no-roof state: the Solar API disabled, a rural
 * address, a building Google cannot model. The caller keeps whatever the rep
 * has drawn and the designer says why, exactly as before this existed.
 */
export function autoFillRoof(
  planes: RoofPlanes | null,
  opts: AutoFillOptions
): LayoutBlock[] {
  if (!planes) return [];
  const reach = opts.reachM ?? FILL_REACH_M;
  const minPoints = opts.minPointsPerSegment ?? MIN_POINTS_PER_SEGMENT;

  const bySegment = new Map<number, { e: number; n: number }[]>();
  for (const p of planes.panels) {
    const list = bySegment.get(p.segmentIndex);
    if (list) list.push({ e: p.e, n: p.n });
    else bySegment.set(p.segmentIndex, [{ e: p.e, n: p.n }]);
  }

  const out: LayoutBlock[] = [];
  // Biggest plane first, so the array a rep sees selected after a fill is the
  // one carrying most of the system rather than a dormer.
  const segments = [...planes.segments].sort((a, b) => b.areaM2 - a.areaM2);
  for (const seg of segments) {
    const pts = bySegment.get(seg.index);
    if (!pts || pts.length < minPoints) continue;
    const block = fillSegment(seg, pts, opts.module, reach);
    if (block && blockPanelCount(block) > 0) out.push(block);
  }
  return out;
}

/**
 * The best grid this module can lay on one plane.
 *
 * "Best" is simply the most panels. Tie-breaking is left to the order the
 * candidates are generated in, which puts portrait and the unshifted phase
 * first — the layout a person would have drawn, kept unless turning the panels
 * sideways or nudging the grid actually wins something.
 */
function fillSegment(
  seg: RoofSegment,
  pts: { e: number; n: number }[],
  m: ModuleMm,
  reach: number
): LayoutBlock | null {
  // The array faces the way the plane does, and `azimuth = rotation + 90` is
  // the designer's own relationship between a grid and its facing — so the
  // columns of the grid run straight down the slope.
  const rotationDeg = norm360(seg.azimuthDeg - 90);
  const frame = { originE: seg.centerE, originN: seg.centerN, rotationDeg };

  // The cloud in the plane's own frame, where the roof is axis-aligned and the
  // grid is a pair of ranges rather than a rotated-rectangle problem.
  const local = pts.map((p) => groundToBlockLocal(frame, p.e, p.n));
  const xs = local.map((p) => p.x);
  const ys = local.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  // Centres, not coverage: the usable roof reaches half a module past the
  // outermost point Google placed, in every direction.
  const pad = reach / 2;
  const spanX = maxX - minX + 2 * pad;
  const spanY = maxY - minY + 2 * pad;

  const grid = new PointGrid(local, reach);

  let best: LayoutBlock | null = null;
  let bestCount = -1;

  for (const orientation of ["portrait", "landscape"] as const) {
    const { w, h } = panelSizeM(m, orientation);
    const pitchX = w + PANEL_GAP_M;
    const pitchY = h + PANEL_GAP_M;
    const cols = Math.floor((spanX + PANEL_GAP_M) / pitchX);
    const rows = Math.floor((spanY + PANEL_GAP_M) / pitchY);
    if (cols < 1 || rows < 1) continue;

    // Slack is the roof the grid does not use; sliding the grid through it is
    // what picks up the extra column.
    const slackX = spanX - (cols * pitchX - PANEL_GAP_M);
    const slackY = spanY - (rows * pitchY - PANEL_GAP_M);

    for (let px = 0; px < PHASE_STEPS; px++) {
      for (let py = 0; py < PHASE_STEPS; py++) {
        const x0 = minX - pad + (slackX * px) / PHASE_STEPS;
        const y0 = minY - pad + (slackY * py) / PHASE_STEPS;
        const candidate = gridAt(
          { frame, orientation, cols, rows, w, h, pitchX, pitchY, x0, y0 },
          grid,
          seg,
          m
        );
        const count = blockPanelCount(candidate);
        if (count > bestCount) {
          bestCount = count;
          best = candidate;
        }
      }
    }
  }

  return best;
}

/** One candidate grid, with every cell that is not on the roof knocked out. */
function gridAt(
  g: {
    frame: { originE: number; originN: number; rotationDeg: number };
    orientation: Orientation;
    cols: number;
    rows: number;
    w: number;
    h: number;
    pitchX: number;
    pitchY: number;
    x0: number;
    y0: number;
  },
  grid: PointGrid,
  seg: RoofSegment,
  m: ModuleMm
): LayoutBlock {
  const origin = blockLocalToGround(g.frame, g.x0, g.y0);

  const block: LayoutBlock = {
    id: `af-${seg.index}`,
    originE: origin.e,
    originN: origin.n,
    rotationDeg: g.frame.rotationDeg,
    cols: g.cols,
    rows: g.rows,
    orientation: g.orientation,
    omitted: [],
    azimuthDeg: seg.azimuthDeg,
    tiltDeg: seg.pitchDeg,
    // Both angles came off the building, which is exactly what this flag
    // promises — see `applyPlanes`, which is stricter for the same reason.
    facingSource: "roof",
    shadePct: null,
  };

  // Cell geometry has ONE implementation, in `solar-layout`. Recomputing corner
  // offsets here is how a fill ends up a rail-gap out from what gets drawn.
  const omitted: number[] = [];
  for (let index = 0; index < g.cols * g.rows; index++) {
    const corners = cellCorners(block, m, index);
    if (!onRoof(corners, grid, g.frame)) omitted.push(index);
  }
  block.omitted = omitted;
  return block;
}

/**
 * Whether one cell is on the roof.
 *
 * Its centre and its four corners, the corners pulled in slightly: a module
 * whose corner is a hand's breadth past the last point Google placed is on the
 * roof, and testing the bare corner rejects most of a perfectly good edge row.
 * Pulling them in is the tolerance, in place of widening `reach`, which would
 * have loosened the centre test too.
 */
function onRoof(
  corners: { e: number; n: number }[],
  grid: PointGrid,
  frame: { originE: number; originN: number; rotationDeg: number }
): boolean {
  const cx = (corners[0].e + corners[2].e) / 2;
  const cy = (corners[0].n + corners[2].n) / 2;
  const centre = groundToBlockLocal(frame, cx, cy);
  if (!grid.covered(centre.x, centre.y)) return false;

  for (const c of corners) {
    const inset = {
      e: cx + (c.e - cx) * CORNER_INSET,
      n: cy + (c.n - cy) * CORNER_INSET,
    };
    const p = groundToBlockLocal(frame, inset.e, inset.n);
    if (!grid.covered(p.x, p.y)) return false;
  }
  return true;
}

/**
 * The point cloud, bucketed, so a fill is not quadratic.
 *
 * A large roof carries the full 1,200 points `solar-roof-planes` keeps, and a
 * candidate grid tests five points per cell across thirty-two candidates. Doing
 * that against every point is tens of millions of distance checks per plane,
 * inside a drag a rep is watching. Buckets of one reach make it a handful.
 */
class PointGrid {
  private readonly cells = new Map<string, { x: number; y: number }[]>();
  private readonly reach: number;
  private readonly reachSq: number;

  constructor(points: { x: number; y: number }[], reach: number) {
    this.reach = reach;
    this.reachSq = reach * reach;
    for (const p of points) {
      const key = this.key(p.x, p.y);
      const bucket = this.cells.get(key);
      if (bucket) bucket.push(p);
      else this.cells.set(key, [p]);
    }
  }

  private key(x: number, y: number): string {
    return `${Math.floor(x / this.reach)}|${Math.floor(y / this.reach)}`;
  }

  /** Is there a modelled panel within reach of this point. */
  covered(x: number, y: number): boolean {
    const gx = Math.floor(x / this.reach);
    const gy = Math.floor(y / this.reach);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = this.cells.get(`${gx + dx}|${gy + dy}`);
        if (!bucket) continue;
        for (const p of bucket) {
          const ex = p.x - x;
          const ey = p.y - y;
          if (ex * ex + ey * ey <= this.reachSq) return true;
        }
      }
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Pruning
// ---------------------------------------------------------------------------

export type PruneResult = {
  blocks: LayoutBlock[];
  /** How many panels came off, for the sentence the designer shows. */
  removed: number;
  /** What the system makes now, on the same model the caller priced it with. */
  productionKwh: number;
};

/**
 * Take panels off, worst first, until the system only just clears the target.
 *
 * A full roof is not the system anybody buys. The rep's job after a fill is to
 * bring it down to what the house actually uses, and doing that by eye means
 * deciding which panels are the weak ones — which is the north face, except
 * when it is the shaded east face, and nobody can see the difference on an
 * aerial.
 *
 * So the order is not a guess. `panelKwh` is what ONE panel on a given array
 * makes a year, from whichever model priced it: PVWatts where a plane has been
 * simulated, the market average where it has not. Taking the cheapest panel
 * each time is both the least damage to production and, on an ordinary roof,
 * the north face going first.
 *
 * STOPS ABOVE THE TARGET, never below. The last panel removed is the last one
 * that still leaves the system clearing what the house uses; the one after it
 * would put the homeowner short, and a design that quietly undershoots the
 * offset it claims is worse than one with a panel too many on it.
 *
 * A system worth nothing — an empty equipment catalogue, so every panel is zero
 * kWh — is left completely alone. Pruning it would strip the roof chasing a
 * target it cannot move toward.
 */
export function pruneToTarget(
  blocks: LayoutBlock[],
  panelKwh: (block: LayoutBlock) => number,
  targetKwh: number
): PruneResult {
  if (!(targetKwh > 0)) return unpruned(blocks, panelKwh);
  // Stop while one more panel off would put the system under what the house
  // uses. Never below — see the header.
  return prune(blocks, panelKwh, (production, next) => production - next < targetKwh);
}

/**
 * The same order of removal, stopped at a panel COUNT instead of a target.
 *
 * What the plus and minus beside the auto-fill are wired to. A rep talking to a
 * homeowner moves in panels — "what does one more do to the payment" — not in
 * kilowatt-hours, and re-filling at a size is honest about what the control
 * does in a way that nudging their drawing would not be.
 */
export function pruneToCount(
  blocks: LayoutBlock[],
  panelKwh: (block: LayoutBlock) => number,
  maxPanels: number
): PruneResult {
  if (!Number.isFinite(maxPanels) || maxPanels < 0) return unpruned(blocks, panelKwh);
  let left = blocks.reduce((n, b) => n + blockPanelCount(b), 0);
  return prune(blocks, panelKwh, () => {
    if (left <= maxPanels) return true;
    left--;
    return false;
  });
}

/** Totals for a system nothing is being taken off. */
function unpruned(
  blocks: LayoutBlock[],
  panelKwh: (block: LayoutBlock) => number
): PruneResult {
  let production = 0;
  for (const b of blocks) production += panelValue(b, panelKwh) * blockPanelCount(b);
  return { blocks, removed: 0, productionKwh: production };
}

/** A panel's worth, with anything unusable read as nothing rather than NaN. */
function panelValue(b: LayoutBlock, panelKwh: (block: LayoutBlock) => number): number {
  const per = panelKwh(b);
  return Number.isFinite(per) && per > 0 ? per : 0;
}

/**
 * Take the cheapest panel off, over and over, until `stop` says otherwise.
 *
 * The shared body of both prunes. `stop` is asked BEFORE each removal and is
 * given the production as it stands and what the next panel off would cost, so
 * a caller can stop either side of its own threshold.
 */
function prune(
  blocks: LayoutBlock[],
  panelKwh: (block: LayoutBlock) => number,
  stop: (production: number, nextValue: number) => boolean
): PruneResult {
  const value = new Map<string, number>();
  let production = 0;
  for (const b of blocks) {
    const per = panelValue(b, panelKwh);
    value.set(b.id, per);
    production += per * blockPanelCount(b);
  }

  // A system worth nothing is left alone — see the header.
  if (production <= 0) return { blocks, removed: 0, productionKwh: production };

  const working = blocks.map((b) => ({ ...b, omitted: [...b.omitted] }));
  let removed = 0;

  for (;;) {
    let pick: (typeof working)[number] | null = null;
    let pickValue = Infinity;
    for (const b of working) {
      const per = value.get(b.id) ?? 0;
      // Zero-value arrays are skipped rather than emptied: removing one changes
      // nothing, so it would loop for ever, and it is not what the rep asked
      // for either.
      if (per <= 0 || blockPanelCount(b) === 0) continue;
      if (per < pickValue) {
        pickValue = per;
        pick = b;
      }
    }
    if (!pick || stop(production, pickValue)) break;

    const index = lastPresentCell(pick);
    if (index == null) break;
    pick.omitted.push(index);
    production -= pickValue;
    removed++;
  }

  return { blocks: working, removed, productionKwh: production };
}

/**
 * The cell a block gives up next: the last one still present.
 *
 * Row-major, so this peels the bottom row from its outer end inward and then
 * starts on the row above. An array that loses panels from its far edge is
 * still a rectangle somebody can rack; one with holes punched through the
 * middle of it is a stringing problem the rep has to fix by hand, which is the
 * work this was supposed to save.
 */
function lastPresentCell(b: LayoutBlock): number | null {
  const skip = new Set(b.omitted);
  for (let index = Math.max(0, b.cols) * Math.max(0, b.rows) - 1; index >= 0; index--) {
    if (!skip.has(index)) return index;
  }
  return null;
}
