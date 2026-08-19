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
};

export type ModuleMm = { widthMm: number; heightMm: number };

/** A standard 60-cell residential module, for a catalogue entry with no size. */
export const MODULE_FALLBACK_MM: ModuleMm = { widthMm: 1134, heightMm: 1762 };

/** Rail gap between neighbouring modules. */
export const PANEL_GAP_M = 0.02;

/**
 * Web Mercator ground resolution — the whole tool's accuracy rests here.
 *
 * `scale: 2` is a HiDPI image: twice the pixels for the same ground, so each
 * pixel covers half the distance.
 */
export function metresPerPixel(lat: number, zoom: number, scale: 1 | 2 = 1): number {
  return (156543.03392804097 * Math.cos((lat * Math.PI) / 180)) / (2 ** zoom * scale);
}

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
  return blocks.reduce((n, b) => {
    const cells = Math.max(0, b.cols) * Math.max(0, b.rows);
    return n + cells - omittedInRange(b).size;
  }, 0);
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
 * Ground metres → pixel on a static map centred on the deal.
 *
 * Takes both dimensions rather than one "size": the imagery route serves
 * 1280x720, and halving the wrong edge puts the whole array off the roof.
 */
export function metresToImagePx(
  e: number,
  n: number,
  mpp: number,
  image: { widthPx: number; heightPx: number }
): { x: number; y: number } {
  // Mercator's cos(lat) stretch is already in `mpp`, and a residential roof
  // spans tens of metres, so treating north as a straight vertical here is
  // accurate to well under a pixel.
  return { x: image.widthPx / 2 + e / mpp, y: image.heightPx / 2 - n / mpp };
}

/** Parse `SolarDesign.layoutBlocks` from the database. Bad data reads as empty. */
export function parseLayoutBlocks(raw: unknown): LayoutBlock[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((b): b is LayoutBlock => {
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
}
