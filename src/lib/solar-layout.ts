/**
 * The geometry behind the panel-layout designer.
 *
 * Pure on purpose: the canvas, the server action that counts panels and the
 * tests all need the same maths, and a module with no React and no Prisma in it
 * is the only version all three can hold.
 *
 * POSITIONS ARE GROUND METRES, east and north of the deal's coordinate — never
 * pixels. A pixel layout reopened at a different zoom is a layout in the wrong
 * place, which is the same class of bug as house dots landing on tile corners.
 */

export type Orientation = "portrait" | "landscape";

export type LayoutBlock = {
  id: string;
  /** The block's first panel's top-left corner, metres east/north of the lead. */
  originE: number;
  originN: number;
  /** Clockwise from north, degrees — a roof ridge's bearing. */
  rotationDeg: number;
  cols: number;
  rows: number;
  orientation: Orientation;
  /** Grid indices knocked out: chimneys, vents, setbacks. Row-major. */
  omitted: number[];
  /**
   * Which way these panels FACE, degrees clockwise from true north — 180 is due
   * south. NOT the same as `rotationDeg`, which only turns the grid in plan
   * view so its rows line up with the ridge; a rep can align an array perfectly
   * and still have it pointing north.
   *
   * Undefined means nobody has said, and production falls back to the
   * company-wide yield exactly as it did before orientation existed. Guessing
   * a south roof here would be the one lie this whole module exists to stop.
   */
  azimuthDeg?: number | null;
  /** The plane's slope off horizontal, degrees. 0 is flat. Undefined = unknown. */
  tiltDeg?: number | null;
  /**
   * Where the facing and pitch above came from: `"roof"` when they were read
   * off the building's own roof planes, absent when a person said.
   *
   * Kept so the screen can be honest about which it is. A rep who typed a
   * facing has to be able to see that the tool did not quietly replace it, and
   * a rep who typed nothing has to be able to see that the number in front of
   * them is a measurement rather than a default. Editing either angle by hand
   * clears this — from that moment the value is theirs.
   *
   * THREE STATES, not two, and the difference is the strength of the claim:
   *   "roof"      — Google's photogrammetric model of THIS building, per plane.
   *                 A measurement.
   *   "footprint" — inferred from the building's outline by `solar-footprint`,
   *                 when no roof model exists. One ridge for the whole house,
   *                 so it can be wrong on an L-plan and cannot tell the faces
   *                 of a hip apart. An estimate, and the proposal says so.
   *   "traced"    — square off the eave of a roof face the rep traced, which
   *                 is the outer edge of a shape a person drew while looking
   *                 at the house. Better than a coin toss and worse than a
   *                 measurement: it is only ever as good as the trace.
   *   null        — a person's own figure, or nothing at all.
   */
  facingSource?: "roof" | "footprint" | "traced" | null;
  /**
   * How much of this array's year the surroundings take away, 0..100.
   *
   * A tree, a neighbour's gable, a chimney — the things the aerial shows but
   * the sun model cannot, because the sun model only knows the plane and never
   * what is standing in front of it. 0 is a clear roof and is what an array
   * with nothing recorded means: undefined has to keep pricing a design
   * exactly as it did before shading existed.
   *
   * Deliberately ONE number for the whole array rather than per panel. A rep
   * on a doorstep judges "that oak takes about half this bank" and is right;
   * asked for a per-module figure they would be inventing precision.
   */
  shadePct?: number | null;
  /**
   * The roof plane a rep traced to produce this array, if they did.
   *
   * Carried ON the block rather than in a column of its own, which is what let
   * the whole traced-face feature ship without a migration: `layoutBlocks` is
   * already JSON and already round-trips whatever shape this file parses.
   *
   * It is kept so the fill can be REPEATED. The panel stepper beside the fill
   * re-covers the roof at a new size, and a design reopened next week has to
   * be able to do that without the rep tracing the roof a second time. Without
   * this the trace would be a gesture that produced an array and then evaporated.
   *
   * Absent on every array drawn by hand, and on every array that existed before
   * tracing did. Nothing reads it except the fill.
   */
  face?: RoofFace | null;
};

/**
 * A roof plane as a person drew it: a closed ring in ground metres, plus how
 * far in from that line panels have to stay.
 *
 * Lives here rather than in `solar-face-fill` because `LayoutBlock` carries one
 * and this file may not import that one — the dependency runs the other way.
 */
export type RoofFace = {
  /** A closed ring. The first point is NOT repeated at the end. */
  points: { e: number; n: number }[];
  /** How far in from the traced edge panels must stay, metres. */
  insetM: number;
};

export type ModuleMm = { widthMm: number; heightMm: number };

/** A standard 60-cell residential module, for a catalogue entry with no size. */
export const MODULE_FALLBACK_MM: ModuleMm = { widthMm: 1134, heightMm: 1762 };

/** Rail gap between neighbouring modules. */
export const PANEL_GAP_M = 0.02;

/**
 * The filename the designer saves its own snapshot of the array under.
 *
 * LOAD-BEARING, and the only thing that tells the designer's drawing apart from
 * a layout a rep exported from another tool and uploaded by hand. Both arrive
 * through the same action and are filed under the same category, but they are
 * not the same kind of thing: the designer re-renders its picture on EVERY
 * save, so yesterday's copy is superseded and gets pruned, while a rep's upload
 * is a document they chose to put on the deal and is never touched.
 *
 * Change it in one place and the pruner stops recognising every drawing saved
 * before the change — they stay on the deal instead of being cleaned up, which
 * is the harmless direction to fail in.
 */
export const DESIGNER_LAYOUT_FILENAME = "panel-layout.jpg";

/**
 * Web Mercator ground resolution — the whole tool's accuracy rests here.
 *
 * Re-exported rather than defined here since the customer-facing proposal
 * started drawing the same array on the same imagery: see `@/lib/web-mercator`.
 * Every existing importer keeps working.
 */
export { metresPerPixel, metresToImagePx } from "./web-mercator";

export function panelSizeM(m: ModuleMm, o: Orientation): { w: number; h: number } {
  const w = m.widthMm / 1000;
  const h = m.heightMm / 1000;
  return o === "portrait" ? { w, h } : { w: h, h: w };
}

/** How many whole panels fit a dragged rectangle. Never a partial one. */
export function fitBlock(
  rect: { widthM: number; heightM: number },
  m: ModuleMm,
  o: Orientation
): { cols: number; rows: number } {
  const { w, h } = panelSizeM(m, o);
  const fit = (span: number, size: number) =>
    Math.max(0, Math.floor((span + PANEL_GAP_M) / (size + PANEL_GAP_M)));
  return { cols: fit(rect.widthM, w), rows: fit(rect.heightM, h) };
}

/**
 * The best way to fill a dragged rectangle: whichever way round fits more.
 *
 * `fitBlock` with a fixed orientation is what produced "Too small for a
 * panel — drag a bigger area" on a rectangle that a landscape module would
 * have sat in happily. A shallow band along a ridge is 1.1 m deep, so portrait
 * (1.76 m tall) fits zero rows and the drag was rejected, with nothing in the
 * message to suggest turning the panel sideways would have worked.
 */
export function bestFitBlock(
  rect: { widthM: number; heightM: number },
  m: ModuleMm
): { cols: number; rows: number; orientation: Orientation } {
  const portrait = fitBlock(rect, m, "portrait");
  const landscape = fitBlock(rect, m, "landscape");
  const pn = portrait.cols * portrait.rows;
  const ln = landscape.cols * landscape.rows;
  // Ties go to portrait: it is how residential arrays are laid up by default,
  // and a tie means the rectangle was square enough for it not to matter.
  return ln > pn ? { ...landscape, orientation: "landscape" } : { ...portrait, orientation: "portrait" };
}

/** The smallest rectangle that holds one module, either way round. Drives the
 *  "drag at least this big" hint rather than a bare rejection. */
export function smallestPanelRectM(m: ModuleMm): { widthM: number; heightM: number } {
  const { w, h } = panelSizeM(m, "portrait");
  return { widthM: Math.min(w, h), heightM: Math.min(w, h) };
}

/** Cells knocked out of one block, de-duplicated and clamped to the grid. */
function omittedInRange(b: LayoutBlock): Set<number> {
  const cells = Math.max(0, b.cols) * Math.max(0, b.rows);
  return new Set(b.omitted.filter((i) => Number.isInteger(i) && i >= 0 && i < cells));
}

/**
 * The number the quote is built on.
 *
 * Counted from geometry, never sent by a client — the same discipline as system
 * size and offset, and for the same reason: every number a homeowner reads has
 * to come from something nobody in the browser can retype.
 */
export function panelCount(blocks: LayoutBlock[]): number {
  return blocks.reduce((n, b) => n + blockPanelCount(b), 0);
}

/**
 * How many panels are in ONE block.
 *
 * Split out of `panelCount` because production is no longer a single sum: each
 * array faces its own way, so the kW on each plane has to be weighted by that
 * plane's orientation before the totals are added up.
 */
export function blockPanelCount(b: LayoutBlock): number {
  const cells = Math.max(0, b.cols) * Math.max(0, b.rows);
  return cells - omittedInRange(b).size;
}

/** Rotate a ground offset clockwise from north. */
function rotate(dE: number, dN: number, deg: number): { e: number; n: number } {
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return { e: dE * cos + dN * sin, n: -dE * sin + dN * cos };
}

/**
 * A point in the block's OWN frame → ground metres.
 *
 * The block frame is the natural one to think in: +x runs along a row, +y runs
 * down the rows, both in metres from the block's first panel's top-left corner.
 *
 * The single implementation on purpose. The panels and the on-canvas grips are
 * positioned by different code paths, and a grip drawn where the hit test does
 * not look is a control that silently does nothing.
 */
export function blockLocalToGround(
  b: Pick<LayoutBlock, "originE" | "originN" | "rotationDeg">,
  x: number,
  y: number
): { e: number; n: number } {
  const r = rotate(x, -y, b.rotationDeg);
  return { e: b.originE + r.e, n: b.originN + r.n };
}

/** How far a block reaches along its own rows and columns, in metres. */
export function blockSpanM(b: LayoutBlock, m: ModuleMm): { spanX: number; spanY: number } {
  const { w, h } = panelSizeM(m, b.orientation);
  return {
    spanX: Math.max(0, b.cols) * w + Math.max(0, b.cols - 1) * PANEL_GAP_M,
    spanY: Math.max(0, b.rows) * h + Math.max(0, b.rows - 1) * PANEL_GAP_M,
  };
}

/**
 * A ground point → the block's own frame. The inverse of blockLocalToGround,
 * used when a rotated block is resized so it grows along its own rows rather
 * than along north.
 */
export function groundToBlockLocal(
  b: Pick<LayoutBlock, "originE" | "originN" | "rotationDeg">,
  e: number,
  n: number
): { x: number; y: number } {
  const inv = rotate(e - b.originE, n - b.originN, -b.rotationDeg);
  return { x: inv.e, y: -inv.n };
}

/**
 * Every present panel as four ground-metre corners, clockwise from top-left.
 * Used both to draw the array and to hit-test a click on it.
 */
export function panelCorners(b: LayoutBlock, m: ModuleMm): { e: number; n: number }[][] {
  const { w, h } = panelSizeM(m, b.orientation);
  const skip = omittedInRange(b);
  const out: { e: number; n: number }[][] = [];

  for (let row = 0; row < b.rows; row++) {
    for (let col = 0; col < b.cols; col++) {
      if (skip.has(row * b.cols + col)) continue;
      // Block frame: +x along a row, +y down the rows.
      const x = col * (w + PANEL_GAP_M);
      const y = row * (h + PANEL_GAP_M);
      out.push(
        (
          [
            [x, y],
            [x + w, y],
            [x + w, y + h],
            [x, y + h],
          ] as const
        ).map(([lx, ly]) => blockLocalToGround(b, lx, ly))
      );
    }
  }
  return out;
}

/**
 * Where one grid cell sits, in the block's own frame — its top-left corner.
 *
 * The single place that knows a cell's offset, so detaching a panel puts the
 * loose copy exactly where the grid one was rather than a rail-gap off.
 */
export function cellLocalXY(
  b: Pick<LayoutBlock, "cols" | "orientation">,
  m: ModuleMm,
  index: number
): { x: number; y: number } {
  const { w, h } = panelSizeM(m, b.orientation);
  const cols = Math.max(1, b.cols);
  return { x: (index % cols) * (w + PANEL_GAP_M), y: Math.floor(index / cols) * (h + PANEL_GAP_M) };
}

/**
 * Pull one panel out of a grid so it can be moved on its own.
 *
 * A single panel is just a 1x1 block — the same shape, the same maths, the same
 * count — so "slide this one over" needs no new model and no migration. The
 * cell is knocked out of the parent and a loose block is placed on top of where
 * it was, inheriting the parent's rotation and orientation so the detach itself
 * moves nothing on screen.
 */
export function detachPanel(
  blocks: LayoutBlock[],
  blockId: string,
  index: number,
  m: ModuleMm,
  newId: string
): { blocks: LayoutBlock[]; detachedId: string } | null {
  const parent = blocks.find((b) => b.id === blockId);
  if (!parent) return null;
  if (index < 0 || index >= Math.max(0, parent.cols) * Math.max(0, parent.rows)) return null;
  if (parent.omitted.includes(index)) return null;

  // Already a lone panel: nothing to detach, it IS the loose one.
  if (parent.cols === 1 && parent.rows === 1) return { blocks, detachedId: parent.id };

  const local = cellLocalXY(parent, m, index);
  const ground = blockLocalToGround(parent, local.x, local.y);
  const loose: LayoutBlock = {
    id: newId,
    originE: ground.e,
    originN: ground.n,
    rotationDeg: parent.rotationDeg,
    cols: 1,
    rows: 1,
    orientation: parent.orientation,
    omitted: [],
    azimuthDeg: parent.azimuthDeg ?? null,
    tiltDeg: parent.tiltDeg ?? null,
    // The panel has not moved out from under the tree by being detached.
    shadePct: parent.shadePct ?? null,
  };
  return {
    blocks: [
      ...blocks.map((b) =>
        b.id === blockId ? { ...b, omitted: [...b.omitted, index] } : b
      ),
      loose,
    ],
    detachedId: newId,
  };
}

// ---------------------------------------------------------------------------
// Growing an array
// ---------------------------------------------------------------------------

export type GrowSide = "left" | "right" | "top" | "bottom";

/**
 * Add one row or column to an array, on the side asked for.
 *
 * This is the whole of "click the green square and a panel appears there". It
 * beats dragging a resize grip for the case that actually comes up on a roof —
 * one more panel along this eave — because a grip has to be dragged far enough
 * to cross a whole module boundary and not so far that it crosses two.
 *
 * THE KNOCKED-OUT CELLS HAVE TO BE REMAPPED, and this is the part that is easy
 * to get wrong. `omitted` holds row-major indices, `row * cols + col`, so the
 * moment `cols` changes every stored index means a different cell. Growing a
 * 3-wide array with a hole at index 4 (row 1, col 1) to 4 wide without
 * remapping leaves the hole at row 1, col 0 — the array silently rearranges
 * itself around the panel the rep removed, which is exactly the complaint that
 * "it doesn't put them all symmetric" describes.
 *
 * Growing left or top also moves the ORIGIN, because the origin is the first
 * panel's top-left corner: a new column on the left starts one module further
 * back along the block's own x axis, not along north.
 */
export function growBlock(b: LayoutBlock, side: GrowSide, m: ModuleMm): LayoutBlock {
  const { w, h } = panelSizeM(m, b.orientation);
  const cols = Math.max(1, b.cols);
  const rows = Math.max(1, b.rows);
  const cell = (i: number) => ({ row: Math.floor(i / cols), col: i % cols });

  if (side === "right" || side === "left") {
    const nextCols = cols + 1;
    const shift = side === "left" ? 1 : 0;
    const origin =
      side === "left"
        ? blockLocalToGround(b, -(w + PANEL_GAP_M), 0)
        : { e: b.originE, n: b.originN };
    return {
      ...b,
      cols: nextCols,
      rows,
      originE: origin.e,
      originN: origin.n,
      omitted: b.omitted
        .filter((i) => i >= 0 && i < cols * rows)
        .map((i) => {
          const { row, col } = cell(i);
          return row * nextCols + col + shift;
        }),
    };
  }

  const nextRows = rows + 1;
  const origin =
    side === "top" ? blockLocalToGround(b, 0, -(h + PANEL_GAP_M)) : { e: b.originE, n: b.originN };
  return {
    ...b,
    rows: nextRows,
    cols,
    originE: origin.e,
    originN: origin.n,
    // Columns are unchanged, so a row-major index only has to move down by a
    // whole row when the new row is inserted above it.
    omitted: b.omitted
      .filter((i) => i >= 0 && i < cols * rows)
      .map((i) => (side === "top" ? i + cols : i)),
  };
}

// ---------------------------------------------------------------------------
// Overlap
// ---------------------------------------------------------------------------

/**
 * Do two panel footprints intersect?
 *
 * Separating-axis test, because panels are rotated rectangles and an
 * axis-aligned box check would call two panels on a 30-degree ridge
 * overlapping when they are not. Four axes suffice for two convex quads: each
 * shape's two edge normals.
 *
 * This exists because a design reached production with two modules sitting 18
 * centimetres apart — 82% of one panel on top of another — and nothing in the
 * app had an opinion about it. On a roof that is not a layout, it is a
 * quantity: the count, the system size, the production and the price were all
 * built on panels that cannot physically both be there.
 */
export function quadsOverlap(
  a: { e: number; n: number }[],
  b: { e: number; n: number }[]
): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p1 = poly[i];
      const p2 = poly[(i + 1) % poly.length];
      // The edge's outward normal.
      const axis = { e: -(p2.n - p1.n), n: p2.e - p1.e };
      const len = Math.hypot(axis.e, axis.n);
      if (len < 1e-9) continue;
      axis.e /= len;
      axis.n /= len;

      const project = (poly2: { e: number; n: number }[]) => {
        let min = Infinity;
        let max = -Infinity;
        for (const p of poly2) {
          const d = p.e * axis.e + p.n * axis.n;
          if (d < min) min = d;
          if (d > max) max = d;
        }
        return { min, max };
      };
      const pa = project(a);
      const pb = project(b);
      // A hair of tolerance: panels that share a rail edge are touching, not
      // overlapping, and floating point makes an exact comparison a coin toss.
      if (pa.max <= pb.min + 1e-6 || pb.max <= pa.min + 1e-6) return false;
    }
  }
  return true;
}

/** Every present panel on a roof, as quads, with the block it belongs to. */
function allPanelQuads(blocks: LayoutBlock[], m: ModuleMm) {
  return blocks.flatMap((b) =>
    panelCorners(b, m).map((corners) => ({ blockId: b.id, corners }))
  );
}

/**
 * Would this panel land on top of one that is already there?
 *
 * `ignoreBlockId` skips the block being edited, so growing an array does not
 * report the array's own panels as being in its way.
 */
export function wouldOverlap(
  candidate: { e: number; n: number }[],
  blocks: LayoutBlock[],
  m: ModuleMm,
  ignoreBlockId?: string
): boolean {
  return allPanelQuads(blocks, m).some(
    (q) => q.blockId !== ignoreBlockId && quadsOverlap(candidate, q.corners)
  );
}

/** The four ground corners of ONE cell of a block's grid. */
export function cellCorners(
  b: LayoutBlock,
  m: ModuleMm,
  index: number
): { e: number; n: number }[] {
  const { w, h } = panelSizeM(m, b.orientation);
  const { x, y } = cellLocalXY(b, m, index);
  return (
    [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ] as const
  ).map(([lx, ly]) => blockLocalToGround(b, lx, ly));
}

/** The four ground corners of one lone panel placed at a top-left corner. */
export function loosePanelCorners(
  at: { originE: number; originN: number; rotationDeg: number },
  m: ModuleMm,
  orientation: Orientation
): { e: number; n: number }[] {
  const { w, h } = panelSizeM(m, orientation);
  return (
    [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ] as const
  ).map(([x, y]) => blockLocalToGround(at, x, y));
}

// ---------------------------------------------------------------------------
// Tidying up
// ---------------------------------------------------------------------------

/** Are these two blocks laid out on the same infinite lattice? */
function sharesLattice(host: LayoutBlock, other: LayoutBlock, m: ModuleMm): boolean {
  if (host.orientation !== other.orientation) return false;
  // A rotation difference of more than a degree is a different plane, not a
  // rounding difference.
  const spin = Math.abs(((host.rotationDeg - other.rotationDeg) % 360 + 360) % 360);
  if (spin > 1 && spin < 359) return false;

  const { w, h } = panelSizeM(m, host.orientation);
  const local = groundToBlockLocal(host, other.originE, other.originN);
  const col = local.x / (w + PANEL_GAP_M);
  const row = local.y / (h + PANEL_GAP_M);
  const off = (v: number) => Math.abs(v - Math.round(v));
  // A fifth of a cell. Closer than that and it was meant to be the same grid;
  // further and moving it there would be relocating a rep's panel for them.
  return off(col) < 0.2 && off(row) < 0.2;
}

export type TidyResult = {
  blocks: LayoutBlock[];
  /** How many separate arrays were folded into another. */
  merged: number;
  /** How many panels were sitting on top of one already there. */
  dropped: number;
};

/**
 * Fold arrays that share a lattice into one, and drop panels stacked on others.
 *
 * The mess this cleans up is a real one, and it had a cause: adding panels used
 * to drop a free-standing module wherever the pointer was. Ten panels arrived
 * as nine separate arrays, three of them overlapping the main row and two of
 * them 82% on top of each other — and because facing and pitch are set per
 * array, that is also seven separate arrays each asking to be told which way it
 * points.
 *
 * The biggest array wins, always: it is the one the rep drew deliberately, and
 * the strays are what accumulated around it.
 */
export function tidyBlocks(blocks: LayoutBlock[], m: ModuleMm): TidyResult {
  // Biggest first, so a lone panel is folded into a row and never the reverse.
  const order = [...blocks].sort((a, b) => blockPanelCount(b) - blockPanelCount(a));
  const kept: LayoutBlock[] = [];
  let merged = 0;
  let dropped = 0;

  for (const block of order) {
    if (blockPanelCount(block) === 0) continue;

    const hostIndex = kept.findIndex((h) => sharesLattice(h, block, m));

    // Nothing to join: keep it, minus any panel already covered by a kept one.
    if (hostIndex === -1) {
      const skip = new Set<number>(block.omitted);
      const cells = Math.max(1, block.cols) * Math.max(1, block.rows);
      for (let index = 0; index < cells; index++) {
        if (skip.has(index)) continue;
        if (wouldOverlap(cellCorners(block, m, index), kept, m)) {
          skip.add(index);
          dropped++;
        }
      }
      kept.push({ ...block, omitted: [...skip] });
      continue;
    }

    // Fold every panel of this block into the host's grid.
    let host = kept[hostIndex];
    const skip = new Set(block.omitted);
    const cells = Math.max(1, block.cols) * Math.max(1, block.rows);
    for (let index = 0; index < cells; index++) {
      if (skip.has(index)) continue;
      // Aim at the cell's CENTRE. Its corner sits exactly on a lattice line,
      // where a hair of drift picks the neighbouring cell instead.
      const corners = cellCorners(block, m, index);
      const centre = {
        e: (corners[0].e + corners[2].e) / 2,
        n: (corners[0].n + corners[2].n) / 2,
      };
      const before = blockPanelCount(host);
      host = addPanelAtCell(host, cellAt(host, m, centre), m);
      // The cell was already taken — this panel was stacked on another.
      if (blockPanelCount(host) === before) dropped++;
    }
    kept[hostIndex] = host;
    merged++;
  }

  return {
    // An array whose every panel was a duplicate leaves an empty husk. So does
    // erasing a whole array by hand, which is how this design ended up with two
    // invisible blocks on it. They render nothing and price nothing, but they
    // are still arrays, and the moment one is selected it offers to be given a
    // facing and a pitch it will never use.
    blocks: kept.filter((b) => blockPanelCount(b) > 0),
    merged,
    dropped,
  };
}

/**
 * Put a lone panel back into the array it belongs to.
 *
 * The other half of `detachPanel`, and the reason a click is no longer
 * destructive. Pulling a panel out is how "slide this one over" works; the
 * failure mode was that there was no way back, so a rep who grabbed a panel and
 * changed their mind was left with a 1x1 block sitting exactly where a cell of
 * the array used to be — visually identical, priced the same, and separately
 * asking to be told which way it faces.
 *
 * Absorbing happens on RELEASE, not on save, so it is visible: the panel snaps
 * into the grid under the pointer and the selection follows it. Nothing is
 * moved that the rep did not just move themselves.
 *
 * Null means leave it loose, which is an ordinary answer: a panel deliberately
 * placed off the array's lattice, one turned to another angle, or one dropped
 * on a cell that is already taken. `tidyBlocks` is still there for a roof that
 * has accumulated strays; this only ever acts on the panel in the rep's hand.
 */
export function absorbPanel(
  blocks: LayoutBlock[],
  looseId: string,
  m: ModuleMm
): { blocks: LayoutBlock[]; hostId: string } | null {
  const loose = blocks.find((b) => b.id === looseId);
  // Only a single panel is ever put back. A whole array dropped on another is a
  // rep moving a bank of modules, not a mistake to undo.
  if (!loose || loose.cols !== 1 || loose.rows !== 1 || blockPanelCount(loose) !== 1) return null;

  for (const host of blocks) {
    if (host.id === looseId) continue;
    // Same grid, same bearing, same rail gaps — or it is not the same array.
    if (!sharesLattice(host, loose, m)) continue;

    // Aim at the panel's CENTRE. Its corner sits exactly on a lattice line,
    // where a hair of drift picks the neighbouring cell instead — the same trap
    // `tidyBlocks` documents.
    const corners = cellCorners(loose, m, 0);
    const centre = {
      e: (corners[0].e + corners[2].e) / 2,
      n: (corners[0].n + corners[2].n) / 2,
    };
    /**
     * NEAR ENOUGH TO BE PART OF THIS ARRAY, which is a separate question from
     * sharing its lattice — the lattice is infinite, so a panel dropped nine
     * metres away across the garden still lands on it, and folding that one in
     * grows the array eleven rows to reach it.
     *
     * One cell is touching an edge. Beyond that the rep has plainly put the
     * panel somewhere else on purpose, which is the same line `Add panel`
     * already draws for the same reason.
     */
    const cell = cellAt(host, m, centre);
    if (cellDistance(host, cell) > 1) continue;

    const before = blockPanelCount(host);
    const grown = addPanelAtCell(host, cell, m);
    // The cell was already taken: putting it back would stack two modules on
    // one patch of roof, which is the exact defect `wouldOverlap` exists for.
    if (blockPanelCount(grown) === before) return null;

    // The host's own grid had room, but another array can cross the same
    // ground. Nothing goes on top of anything.
    const landed = cellAt(grown, m, centre);
    const index = landed.row * Math.max(1, grown.cols) + landed.col;
    const others = blocks.filter((b) => b.id !== looseId && b.id !== host.id);
    if (wouldOverlap(cellCorners(grown, m, index), others, m)) return null;

    return {
      blocks: blocks.flatMap((b) =>
        b.id === looseId ? [] : b.id === host.id ? [grown] : [b]
      ),
      hostId: host.id,
    };
  }
  return null;
}

/**
 * Which cell of a block's lattice a ground point falls in.
 *
 * Indices may be NEGATIVE or past the end — that is the point. The lattice is
 * infinite; the block is the part of it that currently has panels on it. Asking
 * "which cell is this click in" for a point just off the edge answers row -1 or
 * col `cols`, which is exactly what is needed to extend the array to meet it.
 */
export function cellAt(
  b: Pick<LayoutBlock, "originE" | "originN" | "rotationDeg" | "orientation">,
  m: ModuleMm,
  point: { e: number; n: number }
): { row: number; col: number } {
  const { w, h } = panelSizeM(m, b.orientation);
  const local = groundToBlockLocal(b, point.e, point.n);
  return {
    col: Math.floor(local.x / (w + PANEL_GAP_M)),
    row: Math.floor(local.y / (h + PANEL_GAP_M)),
  };
}

/**
 * How far a cell is from the block, in whole cells. Zero means inside it.
 *
 * Drives "is this click close enough to join this array": one means touching an
 * edge, two means a cell's gap away, and by three the rep is plainly starting
 * something new somewhere else on the roof.
 */
export function cellDistance(b: LayoutBlock, cell: { row: number; col: number }): number {
  const dCol = Math.max(0, -cell.col, cell.col - (Math.max(1, b.cols) - 1));
  const dRow = Math.max(0, -cell.row, cell.row - (Math.max(1, b.rows) - 1));
  return Math.max(dCol, dRow);
}

/**
 * Put ONE panel into a block's lattice at the given cell, growing the grid if
 * the cell is outside it.
 *
 * This is what makes adding panels feel like laying tile rather than dropping
 * confetti. A click near an existing array joins that array on its own lattice
 * — same bearing, same rows, same rail gaps — instead of creating a loose panel
 * a few centimetres out of line with everything around it, which is what a
 * roof full of independent 1x1 blocks looks like from above.
 *
 * The cells that were already there are carried across BY POSITION, not by
 * index. Growing changes what every row-major index means, and the one cell the
 * rep asked for is the only one the new row or column should gain — a grow
 * alone would hand them a whole row they did not ask for.
 */
export function addPanelAtCell(
  b: LayoutBlock,
  cell: { row: number; col: number },
  m: ModuleMm
): LayoutBlock {
  const cols = Math.max(1, b.cols);
  const rows = Math.max(1, b.rows);

  const leftAdds = Math.max(0, -cell.col);
  const rightAdds = Math.max(0, cell.col - (cols - 1));
  const topAdds = Math.max(0, -cell.row);
  const bottomAdds = Math.max(0, cell.row - (rows - 1));

  // Everything already on the roof, as positions in the OLD grid.
  const skip = omittedInRange(b);
  const present: { row: number; col: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!skip.has(r * cols + c)) present.push({ row: r, col: c });
    }
  }

  let next = b;
  for (let i = 0; i < leftAdds; i++) next = growBlock(next, "left", m);
  for (let i = 0; i < rightAdds; i++) next = growBlock(next, "right", m);
  for (let i = 0; i < topAdds; i++) next = growBlock(next, "top", m);
  for (let i = 0; i < bottomAdds; i++) next = growBlock(next, "bottom", m);

  // Growing left or up shifts every old position by that many cells.
  const nextCols = Math.max(1, next.cols);
  const nextRows = Math.max(1, next.rows);
  const keep = new Set(
    present.map((p) => (p.row + topAdds) * nextCols + (p.col + leftAdds))
  );
  keep.add((cell.row + topAdds) * nextCols + (cell.col + leftAdds));

  const omitted: number[] = [];
  for (let i = 0; i < nextRows * nextCols; i++) if (!keep.has(i)) omitted.push(i);

  return { ...next, omitted };
}

/**
 * The four places one more row or column could go, as ground-metre quads.
 *
 * Drawn as translucent ghosts so a rep can see where the array would extend
 * before committing to it — the same affordance the tool this was modelled on
 * uses, and the reason panel-by-panel work there feels like laying tile rather
 * than aiming at a handle.
 */
export function growGhosts(
  b: LayoutBlock,
  m: ModuleMm
): { side: GrowSide; corners: { e: number; n: number }[] }[] {
  const { w, h } = panelSizeM(m, b.orientation);
  const { spanX, spanY } = blockSpanM(b, m);
  const quad = (x: number, y: number, dx: number, dy: number) =>
    (
      [
        [x, y],
        [x + dx, y],
        [x + dx, y + dy],
        [x, y + dy],
      ] as const
    ).map(([lx, ly]) => blockLocalToGround(b, lx, ly));

  return [
    { side: "left" as const, corners: quad(-(w + PANEL_GAP_M), 0, w, spanY) },
    { side: "right" as const, corners: quad(spanX + PANEL_GAP_M, 0, w, spanY) },
    { side: "top" as const, corners: quad(0, -(h + PANEL_GAP_M), spanX, h) },
    { side: "bottom" as const, corners: quad(0, spanY + PANEL_GAP_M, spanX, h) },
  ];
}

/**
 * The holes: cells knocked out of this array, as quads plus their index.
 *
 * Shown as ghosts too, so putting a removed panel back is a click on the gap it
 * left rather than a redraw of the whole array.
 */
export function holeQuads(
  b: LayoutBlock,
  m: ModuleMm
): { index: number; corners: { e: number; n: number }[] }[] {
  const { w, h } = panelSizeM(m, b.orientation);
  const skip = omittedInRange(b);
  const out: { index: number; corners: { e: number; n: number }[] }[] = [];
  for (const index of [...skip].sort((a, z) => a - z)) {
    const { x, y } = cellLocalXY(b, m, index);
    out.push({
      index,
      corners: (
        [
          [x, y],
          [x + w, y],
          [x + w, y + h],
          [x, y + h],
        ] as const
      ).map(([lx, ly]) => blockLocalToGround(b, lx, ly)),
    });
  }
  return out;
}

/** An angle from the database, or null. Keeps NaN and Infinity out of the maths. */
function finiteOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** 0..100, or null. A shade of 140% would hand an array negative production. */
export function clampShade(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  return Math.max(0, Math.min(100, v));
}

/** Parse `SolarDesign.layoutBlocks` from the database. Bad data reads as empty. */
export function parseLayoutBlocks(raw: unknown): LayoutBlock[] {
  if (!Array.isArray(raw)) return [];
  const shaped = raw.filter((b): b is LayoutBlock => {
    if (!b || typeof b !== "object") return false;
    const x = b as Record<string, unknown>;
    return (
      typeof x.id === "string" &&
      typeof x.originE === "number" &&
      Number.isFinite(x.originE) &&
      typeof x.originN === "number" &&
      Number.isFinite(x.originN) &&
      typeof x.rotationDeg === "number" &&
      Number.isFinite(x.rotationDeg) &&
      Number.isInteger(x.cols) &&
      Number.isInteger(x.rows) &&
      (x.orientation === "portrait" || x.orientation === "landscape") &&
      Array.isArray(x.omitted)
    );
  });

  // Orientation arrived after the first designs were saved, so it is optional
  // on the wire and normalised here — an older row simply has none, which the
  // production model already reads as "unknown", not as "zero".
  return shaped.map((b) => ({
    ...b,
    azimuthDeg: finiteOrNull((b as LayoutBlock).azimuthDeg),
    tiltDeg: finiteOrNull((b as LayoutBlock).tiltDeg),
    // Same story as orientation: shading arrived later, so a design saved
    // before it has none, and none has to mean "clear" rather than NaN.
    shadePct: clampShade(finiteOrNull((b as LayoutBlock).shadePct)),
    // Anything other than the values we write is a person's own figure.
    facingSource:
      (b as LayoutBlock).facingSource === "roof"
        ? ("roof" as const)
        : (b as LayoutBlock).facingSource === "footprint"
          ? ("footprint" as const)
          : (b as LayoutBlock).facingSource === "traced"
            ? ("traced" as const)
            : null,
    // A malformed trace reads as no trace, never as a shape with a hole in it:
    // the fill would put panels wherever the missing corner used to be.
    face: parseRoofFace((b as LayoutBlock).face),
  }));
}

/**
 * One traced roof face off the wire, or null.
 *
 * Three corners is the fewest that enclose anything. Anything less is a line,
 * and a line filled with panels is a row of modules in mid-air.
 */
export function parseRoofFace(raw: unknown): RoofFace | null {
  if (!raw || typeof raw !== "object") return null;
  const x = raw as Record<string, unknown>;
  if (!Array.isArray(x.points)) return null;
  const points = x.points.flatMap((pt) => {
    if (!pt || typeof pt !== "object") return [];
    const p = pt as Record<string, unknown>;
    return typeof p.e === "number" && Number.isFinite(p.e) &&
      typeof p.n === "number" && Number.isFinite(p.n)
      ? [{ e: p.e, n: p.n }]
      : [];
  });
  if (points.length !== x.points.length || points.length < 3) return null;
  const insetM =
    typeof x.insetM === "number" && Number.isFinite(x.insetM) && x.insetM >= 0
      ? Math.min(10, x.insetM)
      : DEFAULT_SETBACK_M;
  return { points, insetM };
}

// ---------------------------------------------------------------------------
// Setbacks
// ---------------------------------------------------------------------------

/**
 * A fire setback: the strip along a roof edge that has to stay clear.
 *
 * Drawn as a POLYLINE along the edge plus a width, not as a filled polygon,
 * because that is how a roof states the rule — "three feet back from this
 * eave" — and because an edge is what a rep can actually trace on an aerial.
 * The band is rendered from the line and the width.
 *
 * Points are ground metres east/north of the deal's coordinate, exactly like
 * a block's origin. Nothing here is in pixels for the same reason.
 *
 * These do NOT clip panels. Ours is a drawing aid and a talking point on the
 * plan set, and a tool that silently deleted a rep's array because a line
 * moved would be worse than one that shows the conflict and lets them judge
 * it — which is also how the tool this was modelled on behaves.
 */
export type LayoutSetback = {
  id: string;
  /** At least two points; a straight eave is two, a hip run is more. */
  points: { e: number; n: number }[];
  /** How far back the rule reaches, metres. 0.914 m is the usual 3 ft. */
  widthM: number;
};

/** The 3 ft (0.914 m) most jurisdictions ask for along an eave or a ridge. */
export const DEFAULT_SETBACK_M = 0.914;

/** Parse `SolarDesign.layoutSetbacks`. Bad data reads as none drawn. */
export function parseLayoutSetbacks(raw: unknown): LayoutSetback[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((v) => {
    if (!v || typeof v !== "object") return [];
    const x = v as Record<string, unknown>;
    if (typeof x.id !== "string" || !Array.isArray(x.points)) return [];
    const points = x.points.flatMap((pt) => {
      if (!pt || typeof pt !== "object") return [];
      const p = pt as Record<string, unknown>;
      return typeof p.e === "number" && Number.isFinite(p.e) &&
        typeof p.n === "number" && Number.isFinite(p.n)
        ? [{ e: p.e, n: p.n }]
        : [];
    });
    if (points.length < 2) return [];
    const widthM =
      typeof x.widthM === "number" && Number.isFinite(x.widthM) && x.widthM > 0
        ? Math.min(10, x.widthM)
        : DEFAULT_SETBACK_M;
    return [{ id: x.id, points, widthM }];
  });
}

/**
 * The band a setback occupies, as a ground-metre polygon per segment.
 *
 * One quad per segment rather than one offset outline for the whole run: a
 * mitred outline needs the join maths to be right at every corner, and a wrong
 * mitre draws the keep-out zone somewhere the roof does not have one. Overlapping
 * quads at a corner are visually identical and cannot lie.
 *
 * The band is drawn on BOTH sides of the line, so a rep tracing an eave does
 * not have to know which way round the tool wants the roof to be.
 */
export function setbackBands(s: LayoutSetback): { e: number; n: number }[][] {
  const half = s.widthM / 2;
  const out: { e: number; n: number }[][] = [];
  for (let i = 0; i + 1 < s.points.length; i++) {
    const a = s.points[i];
    const b = s.points[i + 1];
    const dE = b.e - a.e;
    const dN = b.n - a.n;
    const len = Math.hypot(dE, dN);
    if (len < 1e-6) continue;
    // Unit normal to the segment.
    const nE = -dN / len;
    const nN = dE / len;
    out.push([
      { e: a.e + nE * half, n: a.n + nN * half },
      { e: b.e + nE * half, n: b.n + nN * half },
      { e: b.e - nE * half, n: b.n - nN * half },
      { e: a.e - nE * half, n: a.n - nN * half },
    ]);
  }
  return out;
}
