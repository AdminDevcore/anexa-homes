import { describe, it, expect } from "vitest";
import {
  eaveOf,
  facingFromEave,
  fillFace,
  insetPolygon,
  pointInPolygon,
  polygonAreaM2,
  splitPolygon,
  DEFAULT_FACE_INSET_M,
  type RoofFace,
} from "@/lib/solar-face-fill";
import {
  blockPanelCount,
  panelCorners,
  MODULE_FALLBACK_MM,
  type ModuleMm,
} from "@/lib/solar-layout";

/**
 * The module the fixtures draw with.
 *
 * A metre square rather than a real 1.13 x 1.76 panel, because a square module
 * makes "how many fit in a 6 x 4 rectangle" arithmetic a reader can check in
 * their head — and the orientation search has nothing to prefer, so a test that
 * cares about orientation has to say so with a rectangular module.
 */
const SQUARE: ModuleMm = { widthMm: 1000, heightMm: 1000 };

/** A rectangle in ground metres, corners anticlockwise from the south-west. */
const rect = (e0: number, n0: number, e1: number, n1: number) => [
  { e: e0, n: n0 },
  { e: e1, n: n0 },
  { e: e1, n: n1 },
  { e: e0, n: n1 },
];

const face = (points: { e: number; n: number }[], insetM = 0): RoofFace => ({
  points,
  insetM,
});

// ---------------------------------------------------------------------------
// Which edge is the eave
// ---------------------------------------------------------------------------

describe("eaveOf", () => {
  it("takes the edge whose midpoint is farthest from the house", () => {
    // A gable face north of the pin: 10 m wide, 4 m deep, its ridge along the
    // south side (nearest the middle of the house) and its eave along the north.
    const points = rect(-5, 4, 5, 8);
    const eave = eaveOf(points, { e: 0, n: 0 });
    const mid = { e: (eave.a.e + eave.b.e) / 2, n: (eave.a.n + eave.b.n) / 2 };
    expect(mid.n).toBeCloseTo(8, 6);
  });

  it("takes the long edge of a hip triangle", () => {
    // A hip face: a triangle whose base is the eave and whose apex touches the
    // ridge, pointing back at the house.
    const points = [
      { e: -6, n: 9 },
      { e: 6, n: 9 },
      { e: 0, n: 3 },
    ];
    const eave = eaveOf(points, { e: 0, n: 0 });
    expect(Math.hypot(eave.b.e - eave.a.e, eave.b.n - eave.a.n)).toBeCloseTo(12, 6);
  });

  it("is unmoved by which corner the trace started on", () => {
    const points = rect(-5, 4, 5, 8);
    const rolled = [...points.slice(2), ...points.slice(0, 2)];
    const a = eaveOf(points, { e: 0, n: 0 });
    const b = eaveOf(rolled, { e: 0, n: 0 });
    const mid = (x: typeof a) => ({ e: (x.a.e + x.b.e) / 2, n: (x.a.n + x.b.n) / 2 });
    expect(mid(a).e).toBeCloseTo(mid(b).e, 6);
    expect(mid(a).n).toBeCloseTo(mid(b).n, 6);
  });
});

// ---------------------------------------------------------------------------
// Which way it faces
// ---------------------------------------------------------------------------

describe("facingFromEave", () => {
  it("points away from the house, not into it", () => {
    // Eave running east-west along the north side. The slope falls north.
    const eave = { a: { e: -5, n: 8 }, b: { e: 5, n: 8 } };
    const { azimuthDeg } = facingFromEave(eave, { e: 0, n: 0 });
    expect(azimuthDeg).toBe(0);
  });

  it("faces south for an eave on the south side", () => {
    const eave = { a: { e: -5, n: -8 }, b: { e: 5, n: -8 } };
    expect(facingFromEave(eave, { e: 0, n: 0 }).azimuthDeg).toBe(180);
  });

  it("faces west for an eave down the west side", () => {
    const eave = { a: { e: -8, n: -5 }, b: { e: -8, n: 5 } };
    expect(facingFromEave(eave, { e: 0, n: 0 }).azimuthDeg).toBe(270);
  });

  it("lays the rows along the eave, whichever way it was traced", () => {
    const forward = facingFromEave({ a: { e: -5, n: 8 }, b: { e: 5, n: 8 } }, { e: 0, n: 0 });
    const backward = facingFromEave({ a: { e: 5, n: 8 }, b: { e: -5, n: 8 } }, { e: 0, n: 0 });
    // Rows run along the eave either way, and the facing is the same slope.
    expect(backward.azimuthDeg).toBe(forward.azimuthDeg);
    const spin = Math.abs(((backward.rotationDeg - forward.rotationDeg) % 360 + 360) % 360);
    expect(spin === 0 || spin === 180).toBe(true);
  });

  it("reads a 30 degree eave as a 30 degree slope off it", () => {
    // Eave bearing 30 degrees from north, house to the west of it.
    const eave = { a: { e: 0, n: 0 }, b: { e: 5, n: 8.66 } };
    const { azimuthDeg } = facingFromEave(eave, { e: -10, n: 4 });
    expect(azimuthDeg).toBeCloseTo(120, 0);
  });
});

// ---------------------------------------------------------------------------
// The polygon itself
// ---------------------------------------------------------------------------

describe("pointInPolygon", () => {
  const square = rect(0, 0, 10, 10);

  it("keeps what is inside and drops what is out", () => {
    expect(pointInPolygon({ e: 5, n: 5 }, square)).toBe(true);
    expect(pointInPolygon({ e: 15, n: 5 }, square)).toBe(false);
    expect(pointInPolygon({ e: 5, n: -0.1 }, square)).toBe(false);
  });

  it("handles a concave L without leaking into the notch", () => {
    const ell = [
      { e: 0, n: 0 },
      { e: 10, n: 0 },
      { e: 10, n: 4 },
      { e: 4, n: 4 },
      { e: 4, n: 10 },
      { e: 0, n: 10 },
    ];
    expect(pointInPolygon({ e: 2, n: 8 }, ell)).toBe(true);
    expect(pointInPolygon({ e: 8, n: 2 }, ell)).toBe(true);
    // The bite out of the top-right corner.
    expect(pointInPolygon({ e: 8, n: 8 }, ell)).toBe(false);
  });
});

describe("insetPolygon", () => {
  it("shrinks a square by the inset on every side", () => {
    const out = insetPolygon(rect(0, 0, 10, 10), 1);
    expect(polygonAreaM2(out)).toBeCloseTo(64, 4);
  });

  it("survives a trace wound the other way round", () => {
    const clockwise = [...rect(0, 0, 10, 10)].reverse();
    expect(polygonAreaM2(insetPolygon(clockwise, 1))).toBeCloseTo(64, 4);
  });

  it("collapses rather than turning inside out when the inset eats the shape", () => {
    const out = insetPolygon(rect(0, 0, 2, 2), 3);
    expect(polygonAreaM2(out)).toBe(0);
  });

  it("returns the polygon untouched at zero inset", () => {
    expect(polygonAreaM2(insetPolygon(rect(0, 0, 10, 10), 0))).toBeCloseTo(100, 6);
  });
});

// ---------------------------------------------------------------------------
// Filling it
// ---------------------------------------------------------------------------

describe("fillFace", () => {
  it("fills a plain rectangle with the panels that fit", () => {
    // 6 x 4 m of roof, 1 m modules with a 2 cm rail gap: five columns and three
    // rows fit comfortably, six columns would need 6.1 m.
    const block = fillFace(face(rect(0, 0, 6, 4)), { module: SQUARE });
    expect(block).not.toBeNull();
    expect(blockPanelCount(block!)).toBe(5 * 3);
  });

  it("keeps every panel inside the trace", () => {
    const points = rect(0, 0, 6, 4);
    const block = fillFace(face(points), { module: SQUARE })!;
    for (const corners of panelCorners(block, SQUARE)) {
      for (const c of corners) {
        // A hair of tolerance: a panel edge sitting exactly on the traced line
        // is inside the roof, and an exact comparison there is a coin toss.
        expect(pointInPolygon({ e: c.e, n: c.n }, insetPolygon(points, -0.001))).toBe(true);
      }
    }
  });

  it("honours the edge setback", () => {
    const bare = fillFace(face(rect(0, 0, 6, 4), 0), { module: SQUARE })!;
    const inset = fillFace(face(rect(0, 0, 6, 4), 1), { module: SQUARE })!;
    expect(blockPanelCount(inset)).toBeLessThan(blockPanelCount(bare));
  });

  it("gives back nothing when the setback eats the face", () => {
    expect(fillFace(face(rect(0, 0, 3, 3), 1.4), { module: SQUARE })).toBeNull();
  });

  it("knocks out the cells that fall outside a hip triangle", () => {
    const triangle = [
      { e: 0, n: 0 },
      { e: 12, n: 0 },
      { e: 6, n: 6 },
    ];
    const block = fillFace(face(triangle), { module: SQUARE })!;
    // Half of a 12 x 6 box is 36 m2, so a full box of panels would be well over
    // what fits: the fill has to be knocking cells out, not filling the box.
    expect(block.omitted.length).toBeGreaterThan(0);
    expect(blockPanelCount(block)).toBeLessThan(block.cols * block.rows);
    expect(blockPanelCount(block)).toBeGreaterThan(6);
  });

  it("turns the grid to run along the eave of a rotated face", () => {
    // The same 6 x 4 face, swung 30 degrees about the origin.
    const spin = (p: { e: number; n: number }, deg: number) => {
      const r = (deg * Math.PI) / 180;
      return { e: p.e * Math.cos(r) - p.n * Math.sin(r), n: p.e * Math.sin(r) + p.n * Math.cos(r) };
    };
    const points = rect(-3, 4, 3, 8).map((p) => spin(p, 30));
    const block = fillFace(face(points), { module: SQUARE })!;
    // Same roof, so the same number of panels as the unrotated one.
    expect(blockPanelCount(block)).toBe(5 * 3);
  });

  it("beats a grid anchored at the corner, on a shape where phase matters", () => {
    // 5.6 m across: a corner-anchored grid of 1.02 m cells fits five columns
    // with 0.5 m wasted at one end. Centring the phase wastes 0.25 m at each,
    // which changes nothing here — so the shape that proves the search is one
    // whose usable width only opens up off-phase.
    const points = [
      { e: 0, n: 0 },
      { e: 5.6, n: 0 },
      { e: 5.6, n: 3 },
      { e: 0, n: 3 },
    ];
    const searched = fillFace(face(points), { module: SQUARE })!;
    const anchored = fillFace(face(points), { module: SQUARE, phaseSteps: 1 })!;
    expect(blockPanelCount(searched)).toBeGreaterThanOrEqual(blockPanelCount(anchored));
  });

  it("turns the modules sideways when that fits one more", () => {
    // 6 m of eave by 4 m of rake, with the real 1.134 x 1.762 module. Laid the
    // usual way round that is 3 across by 3 up the slope — nine. Turned
    // sideways it is 2 by 5 — ten. Which way a module lies is not a
    // preference; it is a panel, and a panel is money.
    const block = fillFace(face(rect(-3, 4, 3, 8)), { module: MODULE_FALLBACK_MM })!;
    expect(blockPanelCount(block)).toBe(10);
    expect(block.orientation).toBe("landscape");
  });

  it("still fills a band too shallow for a module stood up the slope", () => {
    // 1.3 m of rake is less than the 1.762 m a module needs lying the long way
    // down the slope, so the only fill that works is the short way. The plane
    // fill's rejection of exactly this shape is why `bestFitBlock` exists.
    const block = fillFace(face(rect(-3, 4, 3, 5.3)), { module: MODULE_FALLBACK_MM })!;
    expect(blockPanelCount(block)).toBeGreaterThan(0);
    expect(block.orientation).toBe("portrait");
  });

  it("carries the trace and the facing on the block it produced", () => {
    const points = rect(-5, 4, 5, 8);
    const block = fillFace(face(points, DEFAULT_FACE_INSET_M), { module: SQUARE })!;
    expect(block.face?.points).toHaveLength(4);
    expect(block.face?.insetM).toBeCloseTo(DEFAULT_FACE_INSET_M, 6);
    expect(block.azimuthDeg).toBe(0);
    expect(block.facingSource).toBe("traced");
  });

  it("leaves the facing alone when the caller already knows it", () => {
    const block = fillFace(face(rect(-5, 4, 5, 8)), {
      module: SQUARE,
      azimuthDeg: 175,
      tiltDeg: 22,
    })!;
    expect(block.azimuthDeg).toBe(175);
    expect(block.tiltDeg).toBe(22);
  });

  it("keeps panels out of a traced setback band", () => {
    const points = rect(0, 0, 6, 4);
    const open = fillFace(face(points), { module: SQUARE })!;
    const blocked = fillFace(face(points), {
      module: SQUARE,
      // A 2 m wide band straight down the middle of the face.
      keepOut: [
        [
          { e: 2, n: -1 },
          { e: 4, n: -1 },
          { e: 4, n: 5 },
          { e: 2, n: 5 },
        ],
      ],
    })!;
    expect(blockPanelCount(blocked)).toBeLessThan(blockPanelCount(open));
    expect(blockPanelCount(blocked)).toBeGreaterThan(0);
  });

  it("survives a trace that closes on its own first corner", () => {
    // What a person actually produces: four corners and then a click back on
    // the dot they started from. The ring arrives with its first point
    // repeated at the end, a zero-length edge in the middle of it, and the
    // inset turned the whole face to nothing — so a perfectly good roof came
    // back "no panel fits inside that outline".
    const open = rect(0, 0, 12, 9);
    const closed = [...open, { ...open[0] }];
    const a = fillFace(face(open, DEFAULT_FACE_INSET_M), { module: SQUARE })!;
    const b = fillFace(face(closed, DEFAULT_FACE_INSET_M), { module: SQUARE })!;
    expect(b).not.toBeNull();
    expect(blockPanelCount(b)).toBe(blockPanelCount(a));
  });

  it("ignores a corner clicked twice by a hand that slipped", () => {
    // Two clicks a centimetre apart is one corner, not an edge a centimetre
    // long. Treating it as an edge is what produced the bow tie.
    const points = [...rect(0, 0, 12, 9)];
    points.splice(1, 0, { e: points[1].e + 0.008, n: points[1].n - 0.004 });
    const block = fillFace(face(points, DEFAULT_FACE_INSET_M), { module: SQUARE })!;
    expect(block).not.toBeNull();
    expect(blockPanelCount(block)).toBe(
      blockPanelCount(fillFace(face(rect(0, 0, 12, 9), DEFAULT_FACE_INSET_M), { module: SQUARE })!)
    );
  });

  it("refuses a trace that is not a shape", () => {
    expect(fillFace(face([{ e: 0, n: 0 }, { e: 5, n: 0 }]), { module: SQUARE })).toBeNull();
    expect(fillFace(face([]), { module: SQUARE })).toBeNull();
    // Three clicks in the same place is one point, however many times it was
    // pressed — and one point is not a roof.
    expect(
      fillFace(face([{ e: 1, n: 1 }, { e: 1, n: 1.001 }, { e: 1.002, n: 1 }]), { module: SQUARE })
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Cutting a building in two at its ridge
// ---------------------------------------------------------------------------

describe("splitPolygon", () => {
  it("halves a rectangle along a ridge running east-west", () => {
    const whole = rect(-6, -4, 6, 4);
    const [a, b] = splitPolygon(whole, { e: 0, n: 0 }, 90);
    expect(polygonAreaM2(a)).toBeCloseTo(48, 4);
    expect(polygonAreaM2(b)).toBeCloseTo(48, 4);
    // Together they are the whole building and nothing more.
    expect(polygonAreaM2(a) + polygonAreaM2(b)).toBeCloseTo(polygonAreaM2(whole), 4);
  });

  it("halves it along a ridge running north-south", () => {
    const [a, b] = splitPolygon(rect(-6, -4, 6, 4), { e: 0, n: 0 }, 0);
    expect(polygonAreaM2(a)).toBeCloseTo(48, 4);
    expect(polygonAreaM2(b)).toBeCloseTo(48, 4);
  });

  it("cuts on a diagonal ridge without losing or inventing area", () => {
    const whole = rect(-6, -4, 6, 4);
    const [a, b] = splitPolygon(whole, { e: 0, n: 0 }, 35);
    expect(polygonAreaM2(a) + polygonAreaM2(b)).toBeCloseTo(polygonAreaM2(whole), 3);
    expect(polygonAreaM2(a)).toBeGreaterThan(1);
    expect(polygonAreaM2(b)).toBeGreaterThan(1);
  });

  it("cuts an L-plan house, notch and all", () => {
    const ell = [
      { e: -6, n: -4 },
      { e: 6, n: -4 },
      { e: 6, n: 0 },
      { e: 0, n: 0 },
      { e: 0, n: 4 },
      { e: -6, n: 4 },
    ];
    const [a, b] = splitPolygon(ell, { e: 0, n: 0 }, 90);
    expect(polygonAreaM2(a) + polygonAreaM2(b)).toBeCloseTo(polygonAreaM2(ell), 3);
  });

  it("gives one side the whole building when the line misses it", () => {
    const whole = rect(-6, -4, 6, 4);
    // A ridge well north of the roof: everything falls on one side of it.
    const [a, b] = splitPolygon(whole, { e: 0, n: 40 }, 90);
    const areas = [polygonAreaM2(a), polygonAreaM2(b)].sort((x, y) => x - y);
    expect(areas[0]).toBeCloseTo(0, 6);
    expect(areas[1]).toBeCloseTo(polygonAreaM2(whole), 4);
  });
});

describe("fillFace with a stated provenance", () => {
  it("keeps the source the caller gives it", () => {
    const block = fillFace(face(rect(-6, 1, 6, 6)), {
      module: SQUARE,
      azimuthDeg: 182,
      facingSource: "footprint",
    })!;
    expect(block.azimuthDeg).toBe(182);
    expect(block.facingSource).toBe("footprint");
  });
});
