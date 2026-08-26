/**
 * Filling a roof face a rep traced, when nothing else knows where the roof is.
 *
 * `solar-autofill` fills the planes Google modelled and is strictly better than
 * this: it is a photogrammetric measurement of the building and it knows the
 * pitch. But the Solar API is a switch somebody has to flick, and on this
 * account it is off — every call comes back `SERVICE_DISABLED`, so `planes` is
 * null on every house, the fill button never renders and every array carries no
 * facing. The rep is left dragging rectangles over a hip roof and deleting the
 * cells that hang over the eaves by hand.
 *
 * So the trace is the mask. The rep clicks the corners of one roof plane —
 * something they can do from an aerial in about four seconds and cannot get
 * badly wrong, because they can see the roof — and this lays a grid inside it.
 * The same bargain as the Google fill, with a human supplying the outline.
 *
 * WHAT THE TRACE BUYS BEYOND A MASK. A traced face is a plane, and a plane has
 * an eave: the edge farthest from the middle of the building. Rows run along
 * it, and the slope falls square out of it, away from the house. That is the
 * facing — the one number a top-down photograph genuinely cannot show and the
 * one this whole module exists to stop people guessing at. It is an inference
 * from a shape, not a measurement, so blocks from here are marked
 * `facingSource: "traced"` and the screen says as much.
 *
 * WHAT IT STILL CANNOT DO. It knows nothing about pitch — a traced face leaves
 * `tiltDeg` null and the rep sets it, exactly as before. It does not see trees.
 * It believes the outline it was given, so a rep who traces past an eave gets
 * panels past the eave.
 *
 * Pure and network-free, like every other `solar-*` lib.
 */

import {
  PANEL_GAP_M,
  blockLocalToGround,
  cellCorners,
  groundToBlockLocal,
  panelSizeM,
  quadsOverlap,
  type LayoutBlock,
  type ModuleMm,
  type Orientation,
  type RoofFace,
} from "./solar-layout";

/**
 * A roof plane the rep traced, in the ground metres everything else here uses.
 *
 * Defined on `LayoutBlock` in `solar-layout` and re-exported here, because the
 * block carries the trace and the dependency only runs one way. Storing it on
 * the block is what let this ship with no migration: `layoutBlocks` is already
 * a JSON column and already round-trips whatever that file parses.
 */
export type { RoofFace };

/** The 3 ft most jurisdictions want back from an eave. Matches DEFAULT_SETBACK_M. */
export const DEFAULT_FACE_INSET_M = 0.914;

/**
 * How many grid phases are tried per orientation, per axis.
 *
 * Lifted from `solar-autofill` for the same reason it exists there: a grid laid
 * from the corner of a bounding box is not the grid that fits best, and
 * shifting it a third of a panel can pick up a whole extra column. Four offsets
 * on each axis in each of two orientations is thirty-two candidate grids, which
 * is nothing to compute and worth about a panel a roof.
 */
const PHASE_STEPS = 4;

/**
 * How far a cell's corners are pulled toward its centre before they are tested.
 *
 * Effectively not at all — half a millimetre on a metre panel, which exists
 * only so a corner sitting exactly on the traced line is not a coin toss.
 *
 * DELIBERATELY STRICTER THAN THE PLANE FILL, which pulls corners in to 72%.
 * There the mask is Google's cloud of panel CENTRES, already inset from the
 * roof edges, so a bare-corner test would reject most of a good edge row. Here
 * the mask is a line a person drew round the roof, and a panel crossing it is a
 * panel over the eave in the one picture the rep was looking at when they drew
 * it. How far back from the edge panels sit is `insetM`'s job — a number that
 * is on screen and can be argued with, not a tolerance buried in a constant.
 */
const CORNER_INSET = 0.999;

// ---------------------------------------------------------------------------
// The polygon
// ---------------------------------------------------------------------------

export type Edge = { a: { e: number; n: number }; b: { e: number; n: number } };

/**
 * Two corners closer than this are one corner, metres.
 *
 * A centimetre is finer than anybody can aim on an aerial and coarser than the
 * jitter of a hand closing a shape, so it separates "another corner" from "the
 * same corner, pressed again".
 */
const SAME_CORNER_M = 0.01;

/**
 * A traced ring with its repeated corners taken out.
 *
 * THE CLOSING CLICK IS THE REASON THIS EXISTS. A person draws a shape by
 * clicking its corners and then clicking the first one again — that is what
 * closing means, in this tool and in every mapping tool there is. It arrives
 * here as a ring whose first point is repeated at the end, which is to say a
 * ring with a zero-length edge in it.
 *
 * An edge of no length has no direction, so the inset offsets it along a
 * meaningless normal, the neighbouring edges intersect somewhere absurd, and
 * the whole face folds into a bow tie that `insetPolygon` then throws away.
 * The rep sees "no panel fits inside that outline" on a perfectly good roof,
 * which is the least believable error message this tool could produce.
 *
 * The same cleaning handles a corner clicked twice by a slipping hand, which
 * is the same defect a centimetre apart instead of zero.
 */
function cleanRing(points: { e: number; n: number }[]): { e: number; n: number }[] {
  const out: { e: number; n: number }[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.hypot(p.e - last.e, p.n - last.n) <= SAME_CORNER_M) continue;
    out.push(p);
  }
  // The wrap-around pair: the closing click, and the only one the loop above
  // cannot see because its neighbour is at the other end of the array.
  while (
    out.length > 1 &&
    Math.hypot(out[0].e - out[out.length - 1].e, out[0].n - out[out.length - 1].n) <= SAME_CORNER_M
  ) {
    out.pop();
  }
  return out;
}

/** Twice the signed area. Positive is anticlockwise in an east/north frame. */
function signedArea2(points: { e: number; n: number }[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    sum += p.e * q.n - q.e * p.n;
  }
  return sum;
}

/** The area a traced face encloses, square metres. Winding does not matter. */
export function polygonAreaM2(points: { e: number; n: number }[]): number {
  if (points.length < 3) return 0;
  return Math.abs(signedArea2(points)) / 2;
}

/**
 * Is this point inside the trace?
 *
 * Ray casting, which handles the concave shapes that matter here — an L-plan
 * roof face, or a face traced around a chimney. A winding test would be no
 * simpler and a convex-only test would quietly fill the notch.
 */
export function pointInPolygon(
  p: { e: number; n: number },
  points: { e: number; n: number }[]
): boolean {
  if (points.length < 3) return false;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    // Half-open in n, so a vertex on the ray is counted once rather than twice.
    const straddles = a.n > p.n !== b.n > p.n;
    if (!straddles) continue;
    const crossE = ((b.e - a.e) * (p.n - a.n)) / (b.n - a.n) + a.e;
    if (p.e < crossE) inside = !inside;
  }
  return inside;
}

/**
 * The face pulled in from its own edges by `d` metres.
 *
 * Every edge is moved inward along its normal and the neighbours re-intersected
 * — a straight-skeleton inset, minus the skeleton, which is more than this
 * needs. A roof face is a handful of corners at sane angles; the failure mode
 * worth guarding is not a bad mitre but an inset deep enough to turn the shape
 * inside out, which reads as a face too small to put a panel on and returns
 * nothing rather than an inverted polygon full of panels off the roof.
 *
 * Winding is normalised first, so it does not matter which way round the rep
 * traced. That is not a detail: clicking corners clockwise is as natural as
 * anticlockwise and a tool that only worked one way round would look broken
 * every other time.
 */
export function insetPolygon(
  points: { e: number; n: number }[],
  d: number
): { e: number; n: number }[] {
  const clean = cleanRing(points);
  if (clean.length < 3) return [];
  if (d === 0) return clean.map((p) => ({ ...p }));

  // Anticlockwise, so the inward normal is a consistent quarter-turn.
  const ring = signedArea2(clean) < 0 ? [...clean].reverse() : [...clean];
  const before = polygonAreaM2(ring);

  const out: { e: number; n: number }[] = [];
  for (let i = 0; i < ring.length; i++) {
    const prev = ring[(i - 1 + ring.length) % ring.length];
    const curr = ring[i];
    const next = ring[(i + 1) % ring.length];

    // The two edges meeting at this corner, moved inward by d.
    const in1 = inwardOffset(prev, curr, d);
    const in2 = inwardOffset(curr, next, d);
    const hit = intersect(in1, in2);
    // Parallel edges — a corner that is not really one. The offset point on
    // either line is the same place, so take it.
    out.push(hit ?? { e: curr.e + in2.dE, n: curr.n + in2.dN });
  }

  // Inside out, or eaten to nothing: no roof left to put a panel on.
  const after = polygonAreaM2(out);
  if (d > 0 && (after >= before || after < 1e-6)) return [];
  if (selfCrossing(out)) return [];
  return out;
}

/** One edge shifted d metres toward the inside of an anticlockwise ring. */
function inwardOffset(
  a: { e: number; n: number },
  b: { e: number; n: number },
  d: number
): { a: { e: number; n: number }; b: { e: number; n: number }; dE: number; dN: number } {
  const len = Math.hypot(b.e - a.e, b.n - a.n) || 1;
  // Quarter-turn left of the direction of travel: inward on an anticlockwise ring.
  const dE = (-(b.n - a.n) / len) * d;
  const dN = ((b.e - a.e) / len) * d;
  return { a: { e: a.e + dE, n: a.n + dN }, b: { e: b.e + dE, n: b.n + dN }, dE, dN };
}

/** Where two infinite lines cross, or null if they are parallel. */
function intersect(
  l1: { a: { e: number; n: number }; b: { e: number; n: number } },
  l2: { a: { e: number; n: number }; b: { e: number; n: number } }
): { e: number; n: number } | null {
  const d1 = { e: l1.b.e - l1.a.e, n: l1.b.n - l1.a.n };
  const d2 = { e: l2.b.e - l2.a.e, n: l2.b.n - l2.a.n };
  const denom = d1.e * d2.n - d1.n * d2.e;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((l2.a.e - l1.a.e) * d2.n - (l2.a.n - l1.a.n) * d2.e) / denom;
  return { e: l1.a.e + d1.e * t, n: l1.a.n + d1.n * t };
}

/**
 * Does the ring cross itself?
 *
 * An inset that folds a thin part of the shape over produces a bow tie whose
 * area can still look plausible. Filling one puts panels in the fold, which is
 * to say off the roof, so a crossing ring is thrown away entirely.
 */
function selfCrossing(ring: { e: number; n: number }[]): boolean {
  for (let i = 0; i < ring.length; i++) {
    for (let j = i + 2; j < ring.length; j++) {
      // Adjacent edges share a vertex; the last and the first do too.
      if (i === 0 && j === ring.length - 1) continue;
      if (
        segmentsCross(ring[i], ring[(i + 1) % ring.length], ring[j], ring[(j + 1) % ring.length])
      ) {
        return true;
      }
    }
  }
  return false;
}

function segmentsCross(
  p1: { e: number; n: number },
  p2: { e: number; n: number },
  p3: { e: number; n: number },
  p4: { e: number; n: number }
): boolean {
  const side = (a: typeof p1, b: typeof p1, c: typeof p1) =>
    Math.sign((b.e - a.e) * (c.n - a.n) - (b.n - a.n) * (c.e - a.e));
  const d1 = side(p3, p4, p1);
  const d2 = side(p3, p4, p2);
  const d3 = side(p1, p2, p3);
  const d4 = side(p1, p2, p4);
  return d1 !== d2 && d3 !== d4 && d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0;
}

// ---------------------------------------------------------------------------
// Which edge is the eave, and therefore which way the roof falls
// ---------------------------------------------------------------------------

/**
 * The eave of a traced face: the edge whose midpoint is farthest from the pin.
 *
 * The pin is the deal's own coordinate, geocoded to the ROOFTOP, so it really
 * is the middle of the building rather than the kerb outside it. On a gable
 * face the ridge and the eave are the two long parallels and the outer one is
 * the eave; on a hip triangle the base is the only long edge and the apex
 * points back at the ridge. Both are the ordinary case, and both come out right.
 *
 * LENGTH BREAKS THE TIE, weighted gently. A traced face has short edges at its
 * ends — a rake, a jog round a dormer — and one of those can sit marginally
 * farther out than the eave on a face that is wider than it is deep. Scoring
 * distance times the square root of length keeps the long outer edge winning
 * without letting a long inner one (the ridge of a deep face) take it.
 */
export function eaveOf(
  points: { e: number; n: number }[],
  pin: { e: number; n: number }
): Edge {
  let best: Edge = { a: points[0], b: points[1 % points.length] };
  let bestScore = -Infinity;

  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const len = Math.hypot(b.e - a.e, b.n - a.n);
    if (len < 1e-6) continue;
    const mid = { e: (a.e + b.e) / 2, n: (a.n + b.n) / 2 };
    const away = Math.hypot(mid.e - pin.e, mid.n - pin.n);
    const score = away * Math.sqrt(len);
    if (score > bestScore) {
      bestScore = score;
      best = { a, b };
    }
  }
  return best;
}

/**
 * The grid bearing and the facing that an eave implies.
 *
 * `rotationDeg` turns the grid so rows run ALONG the eave — a drawing concern,
 * no effect on output. `azimuthDeg` is the slope, square off the eave and
 * pointing AWAY from the house, which is the half of the answer a plan view
 * cannot supply and a coin toss gets wrong half the time.
 *
 * Both come out of the same edge on purpose. A rep who nudges the grid angle
 * afterwards has not changed which way the roof falls, and the two numbers are
 * separate for exactly that reason — see the designer's header.
 */
export function facingFromEave(
  eave: Edge,
  pin: { e: number; n: number }
): { rotationDeg: number; azimuthDeg: number } {
  const dE = eave.b.e - eave.a.e;
  const dN = eave.b.n - eave.a.n;
  // Bearing of the eave itself, clockwise from north.
  const along = Math.atan2(dE, dN);

  const mid = { e: (eave.a.e + eave.b.e) / 2, n: (eave.a.n + eave.b.n) / 2 };
  const outward = { e: mid.e - pin.e, n: mid.n - pin.n };

  // The two perpendiculars to the eave. Take whichever points away from the pin.
  const candidates = [along + Math.PI / 2, along - Math.PI / 2];
  const pick =
    Math.sin(candidates[0]) * outward.e + Math.cos(candidates[0]) * outward.n >= 0
      ? candidates[0]
      : candidates[1];

  const azimuthDeg = norm360((pick * 180) / Math.PI);
  // `azimuth = rotation + 90` is the relationship the rest of the designer
  // uses — "Off the rows" is exactly this sum — so the grid bearing is read
  // back out of the facing rather than derived a second way that could drift.
  return { rotationDeg: norm360(azimuthDeg - 90), azimuthDeg };
}

/** 0..359, so a flip past north and a negative bearing both read normally. */
function norm360(deg: number): number {
  return Math.round(((deg % 360) + 360) % 360);
}

// ---------------------------------------------------------------------------
// The fill
// ---------------------------------------------------------------------------

export type FillFaceOptions = {
  module: ModuleMm;
  /** The house, for working out which edge is the eave. Defaults to the pin. */
  pin?: { e: number; n: number };
  /** Already know the facing? A re-fill at a new size does; a fresh trace does not. */
  azimuthDeg?: number | null;
  tiltDeg?: number | null;
  shadePct?: number | null;
  /** Areas nothing may sit on: setback bands, an obstruction, another array. */
  keepOut?: { e: number; n: number }[][];
  /** Overridable so a test can prove the phase search is doing something. */
  phaseSteps?: number;
  /** The id to give the block. Supplied so the caller keeps control of identity. */
  id?: string;
};

/**
 * Cover one traced face with panels.
 *
 * ONE BLOCK, never a scatter of loose modules. A `LayoutBlock` with cells
 * knocked out is the vocabulary the whole system already speaks — the designer
 * drags it, the proposal draws it, `solar-arrays` prices it, `assignPlanes`
 * reads it — and emitting anything else would fork every one of those. It is
 * also why the fill is editable the moment it lands: what comes back is an
 * ordinary array, not a special object a rep is locked out of.
 *
 * Null means there is no roof here worth a panel: fewer than three corners, or
 * a face the setback ate. Returning an empty block instead would leave an
 * invisible array on the design that still asks to be given a facing.
 */
export function fillFace(face: RoofFace, opts: FillFaceOptions): LayoutBlock | null {
  // Cleaned once, here, so the eave, the mask and the outline stored on the
  // block are all read off the same ring. Cleaning it twice in two places is
  // how a face gets filled to one shape and drawn as another.
  const points = cleanRing(face.points);
  if (points.length < 3) return null;

  const usable = insetPolygon(points, Math.max(0, face.insetM));
  if (usable.length < 3 || polygonAreaM2(usable) < 1e-6) return null;

  const pin = opts.pin ?? { e: 0, n: 0 };
  const eave = eaveOf(points, pin);
  const { rotationDeg, azimuthDeg } = facingFromEave(eave, pin);

  const steps = Math.max(1, opts.phaseSteps ?? PHASE_STEPS);
  let best: LayoutBlock | null = null;
  let bestCount = 0;

  for (const orientation of ["portrait", "landscape"] as const) {
    const candidate = fillAt(usable, rotationDeg, orientation, opts.module, steps, opts.keepOut);
    if (candidate && candidate.count > bestCount) {
      bestCount = candidate.count;
      best = candidate.block;
    }
  }
  if (!best || bestCount === 0) return null;

  return {
    ...best,
    id: opts.id ?? best.id,
    // A facing the caller already has beats one inferred from the shape: a
    // re-fill at a new panel count must not quietly re-guess a rep's own angle
    // back to what the trace said.
    azimuthDeg: opts.azimuthDeg ?? azimuthDeg,
    tiltDeg: opts.tiltDeg ?? null,
    shadePct: opts.shadePct ?? null,
    facingSource: opts.azimuthDeg == null ? "traced" : null,
    face: { points: points.map((p) => ({ ...p })), insetM: Math.max(0, face.insetM) },
  };
}

/**
 * The best grid of one orientation over one polygon.
 *
 * The search is over PHASE, not position: the bearing is settled by the eave
 * and the extent by the polygon, so all that is left is where the lattice lines
 * fall within it. Sliding the whole grid by a fraction of a cell in each axis
 * is what picks up the edge column that was hanging half off.
 */
function fillAt(
  usable: { e: number; n: number }[],
  rotationDeg: number,
  orientation: Orientation,
  module: ModuleMm,
  steps: number,
  keepOut?: { e: number; n: number }[][]
): { block: LayoutBlock; count: number } | null {
  const { w, h } = panelSizeM(module, orientation);
  const pitchX = w + PANEL_GAP_M;
  const pitchY = h + PANEL_GAP_M;

  // The face in the grid's own frame, so the bounding box is the box the panels
  // actually lie in rather than a north-aligned one around a rotated roof.
  const frame = { originE: 0, originN: 0, rotationDeg };
  const local = usable.map((p) => groundToBlockLocal(frame, p.e, p.n));
  const minX = Math.min(...local.map((p) => p.x));
  const maxX = Math.max(...local.map((p) => p.x));
  const minY = Math.min(...local.map((p) => p.y));
  const maxY = Math.max(...local.map((p) => p.y));

  const cols = Math.floor((maxX - minX + PANEL_GAP_M) / pitchX);
  const rows = Math.floor((maxY - minY + PANEL_GAP_M) / pitchY);
  if (cols < 1 || rows < 1) return null;

  // One extra row and column of headroom, because a phase shift moves the grid
  // and a cell that was off the end can come back on.
  const gridCols = cols + 1;
  const gridRows = rows + 1;

  let best: { block: LayoutBlock; count: number } | null = null;

  for (let px = 0; px < steps; px++) {
    for (let py = 0; py < steps; py++) {
      const offX = minX - (px / steps) * pitchX;
      const offY = minY - (py / steps) * pitchY;
      const origin = blockLocalToGround(frame, offX, offY);

      const block: LayoutBlock = {
        id: "face",
        originE: origin.e,
        originN: origin.n,
        rotationDeg,
        cols: gridCols,
        rows: gridRows,
        orientation,
        omitted: [],
        azimuthDeg: null,
        tiltDeg: null,
        shadePct: null,
      };

      const omitted: number[] = [];
      let count = 0;
      for (let index = 0; index < gridCols * gridRows; index++) {
        const corners = cellCorners(block, module, index);
        if (onFace(corners, usable) && !blocked(corners, keepOut)) count++;
        else omitted.push(index);
      }
      if (count > (best?.count ?? 0)) {
        best = { block: trimmed({ ...block, omitted }, gridCols, gridRows, module), count };
      }
    }
  }
  return best;
}

/**
 * Whether one cell is on the traced face.
 *
 * Its centre and its four corners, the corners pulled in slightly — the same
 * test and the same tolerance the plane fill uses. Pulling the corners in is
 * the tolerance in place of growing the polygon, which would have loosened the
 * centre test too and let a cell whose middle is off the roof stay on it.
 */
function onFace(
  corners: { e: number; n: number }[],
  usable: { e: number; n: number }[]
): boolean {
  const cx = (corners[0].e + corners[2].e) / 2;
  const cy = (corners[0].n + corners[2].n) / 2;
  if (!pointInPolygon({ e: cx, n: cy }, usable)) return false;
  for (const c of corners) {
    const p = { e: cx + (c.e - cx) * CORNER_INSET, n: cy + (c.n - cy) * CORNER_INSET };
    if (!pointInPolygon(p, usable)) return false;
  }
  return true;
}

/** Does this cell touch anything that has to stay clear? */
function blocked(
  corners: { e: number; n: number }[],
  keepOut?: { e: number; n: number }[][]
): boolean {
  if (!keepOut || keepOut.length === 0) return false;
  return keepOut.some((zone) => zone.length >= 3 && quadsOverlap(corners, zone));
}

/**
 * Shrink the grid to the rows and columns that actually carry a panel.
 *
 * The search grid is deliberately a row and a column bigger than the face needs
 * so a phase shift has somewhere to go. Left as it is, every filled face would
 * arrive with a rim of knocked-out cells around it — which shows up as an
 * oversized selection rectangle, four grow-ghosts in the wrong place, and an
 * array whose stated size is not the array you can see.
 */
function trimmed(
  b: LayoutBlock,
  cols: number,
  rows: number,
  module: ModuleMm
): LayoutBlock {
  const skip = new Set(b.omitted);
  let minR = rows;
  let maxR = -1;
  let minC = cols;
  let maxC = -1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (skip.has(r * cols + c)) continue;
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
      if (c < minC) minC = c;
      if (c > maxC) maxC = c;
    }
  }
  if (maxR < 0) return { ...b, cols: 0, rows: 0, omitted: [] };

  const nextCols = maxC - minC + 1;
  const nextRows = maxR - minR + 1;

  // The origin is the FIRST PANEL'S top-left corner, so dropping leading rows
  // and columns moves it — along the block's own axes, not along north.
  const { w, h } = panelSizeM(module, b.orientation);
  const origin = blockLocalToGround(b, minC * (w + PANEL_GAP_M), minR * (h + PANEL_GAP_M));

  const omitted: number[] = [];
  for (let r = 0; r < nextRows; r++) {
    for (let c = 0; c < nextCols; c++) {
      if (skip.has((r + minR) * cols + (c + minC))) omitted.push(r * nextCols + c);
    }
  }
  return {
    ...b,
    originE: origin.e,
    originN: origin.n,
    cols: nextCols,
    rows: nextRows,
    omitted,
  };
}
