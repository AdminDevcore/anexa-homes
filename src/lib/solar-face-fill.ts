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
 * An edge of no length has no direction, and a ring carrying one puts a corner
 * of the roof in two places at once — which throws off the eave, the bounding
 * box the grid is laid in, and the distance every panel is measured against.
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
 * How far a point is from the nearest edge of a ring, metres.
 *
 * THIS REPLACED INSETTING THE POLYGON, and the reason is a real building. A
 * fire setback is "no panel within three feet of the edge", and the obvious way
 * to honour it is to shrink the outline by three feet and fill what is left.
 * That works on a rectangle and falls apart on anything else: offsetting the
 * edges of a concave shape makes them cross, and the L-plan house this company
 * tests on came back with one of its two slopes eroded to nothing. No panels,
 * no explanation, on half a roof that plainly has room.
 *
 * Measuring the clearance of each panel instead is exact whatever the shape,
 * because it never tries to build a smaller polygon at all — it asks the only
 * question the rule actually poses, of the only points that matter.
 */
export function distanceToBoundary(
  p: { e: number; n: number },
  ring: { e: number; n: number }[]
): number {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const dE = b.e - a.e;
    const dN = b.n - a.n;
    const lenSq = dE * dE + dN * dN;
    // A zero-length edge is a repeated corner; its distance is the corner's.
    const t = lenSq < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.e - a.e) * dE + (p.n - a.n) * dN) / lenSq));
    const d = Math.hypot(p.e - (a.e + dE * t), p.n - (a.n + dN * t));
    if (d < best) best = d;
  }
  return best;
}

/**
 * The centre of area of a ring — where its ridge runs through.
 *
 * NOT the average of the corners, which is pulled toward whichever end of the
 * building has more of them: an L-plan traced with six points down one wing and
 * three down the other has its "average corner" inside the long wing. The
 * centroid of the AREA is where the shape actually balances, which is where a
 * roof's ridge sits.
 */
export function polygonCentroid(points: { e: number; n: number }[]): { e: number; n: number } {
  let twice = 0;
  let e = 0;
  let n = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    const cross = p.e * q.n - q.e * p.n;
    twice += cross;
    e += (p.e + q.e) * cross;
    n += (p.n + q.n) * cross;
  }
  // A degenerate ring has no area to balance; fall back to the plain average.
  if (Math.abs(twice) < 1e-9) {
    const k = Math.max(1, points.length);
    return {
      e: points.reduce((t, p) => t + p.e, 0) / k,
      n: points.reduce((t, p) => t + p.n, 0) / k,
    };
  }
  return { e: e / (3 * twice), n: n / (3 * twice) };
}

/**
 * Cut a building's outline in two along its ridge.
 *
 * WHY A ROOF IS NOT ONE FACE. Filling a whole footprint gives every panel on it
 * a single facing, which is a lie on any house with a ridge: half the modules
 * are on the south slope and half are on the north, and pricing them all as
 * south overstates the year by a fifth. Cutting first means each half carries
 * the slope it is actually on, and the prune that follows takes the north face
 * off first — which is the entire point of covering the roof and then trimming.
 *
 * Sutherland–Hodgman against a half-plane, run twice with the normal flipped.
 * It is exact for the convex case and correct for the concave one that matters
 * here — an L-plan house — because a single infinite cutting line can only ever
 * remove area, never fold the ring back on itself.
 *
 * A line that misses the building entirely returns the whole outline on one
 * side and nothing on the other, which is the honest answer for a footprint too
 * square to have a ridge: one face, and the caller says so.
 */
export function splitPolygon(
  points: { e: number; n: number }[],
  through: { e: number; n: number },
  bearingDeg: number
): [{ e: number; n: number }[], { e: number; n: number }[]] {
  if (points.length < 3) return [[], []];
  const rad = (bearingDeg * Math.PI) / 180;
  // The ridge direction, and the normal to it that the two sides are measured
  // along. Bearings are clockwise from north: east is sin, north is cos.
  const nE = Math.cos(rad);
  const nN = -Math.sin(rad);
  const side = (p: { e: number; n: number }) =>
    (p.e - through.e) * nE + (p.n - through.n) * nN;
  return [clipHalfPlane(points, side, 1), clipHalfPlane(points, side, -1)];
}

/** The part of a ring on one side of a line, `sign` choosing which side. */
function clipHalfPlane(
  points: { e: number; n: number }[],
  side: (p: { e: number; n: number }) => number,
  sign: 1 | -1
): { e: number; n: number }[] {
  const out: { e: number; n: number }[] = [];
  for (let i = 0; i < points.length; i++) {
    const curr = points[i];
    const next = points[(i + 1) % points.length];
    const dc = side(curr) * sign;
    const dn = side(next) * sign;
    if (dc >= 0) out.push(curr);
    // The edge crosses the line: keep the crossing point, so the cut edge is
    // the line itself rather than a staircase of whichever corners survived.
    if ((dc >= 0) !== (dn >= 0)) {
      const t = dc / (dc - dn);
      out.push({ e: curr.e + (next.e - curr.e) * t, n: curr.n + (next.n - curr.n) * t });
    }
  }
  return out.length >= 3 ? out : [];
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
  // Rounded FIRST, then wrapped. Wrapping first leaves 359.7 to round up to
  // 360 — a bearing that is really north, written as a number no compass has,
  // that a 0..359 input rejects and that misses the yield cache keyed on 0.
  return Math.round(((deg % 360) + 360) % 360) % 360;
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
  /**
   * Where a supplied `azimuthDeg` came from.
   *
   * Defaults to null — a person's own figure — which is right for a rep's typed
   * angle and wrong for one the building's outline supplied. A caller that
   * knows the provenance says so, and the proposal keeps being able to tell a
   * measurement from an inference from a guess.
   */
  facingSource?: LayoutBlock["facingSource"];
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

  if (polygonAreaM2(points) < 1e-6) return null;
  const clearM = Math.max(0, face.insetM);

  const pin = opts.pin ?? { e: 0, n: 0 };
  const eave = eaveOf(points, pin);
  const { rotationDeg, azimuthDeg } = facingFromEave(eave, pin);

  const steps = Math.max(1, opts.phaseSteps ?? PHASE_STEPS);
  let best: LayoutBlock | null = null;
  let bestCount = 0;

  for (const orientation of ["portrait", "landscape"] as const) {
    const candidate = fillAt(points, rotationDeg, orientation, opts.module, steps, clearM, opts.keepOut);
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
    facingSource: opts.azimuthDeg == null ? "traced" : (opts.facingSource ?? null),
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
  ring: { e: number; n: number }[],
  rotationDeg: number,
  orientation: Orientation,
  module: ModuleMm,
  steps: number,
  clearM: number,
  keepOut?: { e: number; n: number }[][]
): { block: LayoutBlock; count: number } | null {
  const { w, h } = panelSizeM(module, orientation);
  const pitchX = w + PANEL_GAP_M;
  const pitchY = h + PANEL_GAP_M;

  // The face in the grid's own frame, so the bounding box is the box the panels
  // actually lie in rather than a north-aligned one around a rotated roof.
  const frame = { originE: 0, originN: 0, rotationDeg };
  const local = ring.map((p) => groundToBlockLocal(frame, p.e, p.n));
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
        if (onFace(corners, ring, clearM) && !blocked(corners, keepOut)) count++;
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
 * Whether one cell is on the roof, and far enough in from its edge.
 *
 * Its centre and its four corners, the corners pulled in by a whisker so a
 * panel edge sitting exactly on the traced line is not a coin toss — and every
 * one of them at least `clearM` from the nearest edge, which is the setback.
 *
 * BOTH TESTS ARE NEEDED. Distance alone would accept a panel sitting three feet
 * clear of the walls on the OUTSIDE of the building, and inside-ness alone
 * would put modules hard against the eave. Together they are the rule as it is
 * written: on the roof, and this far back from the edge of it.
 */
function onFace(
  corners: { e: number; n: number }[],
  ring: { e: number; n: number }[],
  clearM: number
): boolean {
  const cx = (corners[0].e + corners[2].e) / 2;
  const cy = (corners[0].n + corners[2].n) / 2;
  const centre = { e: cx, n: cy };
  if (!pointInPolygon(centre, ring)) return false;
  if (clearM > 0 && distanceToBoundary(centre, ring) < clearM) return false;

  for (const c of corners) {
    const p = { e: cx + (c.e - cx) * CORNER_INSET, n: cy + (c.n - cy) * CORNER_INSET };
    if (!pointInPolygon(p, ring)) return false;
    if (clearM > 0 && distanceToBoundary(p, ring) < clearM) return false;
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
