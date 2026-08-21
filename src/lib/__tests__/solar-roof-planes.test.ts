import { describe, expect, it } from "vitest";
import {
  applyPlanes,
  assignPlanes,
  readBuildingInsights,
  segmentHulls,
  toGroundPlanes,
  NEAREST_PANEL_CUTOFF_M,
  type RoofPlanes,
} from "../solar-roof-planes";
import { MODULE_FALLBACK_MM, type LayoutBlock } from "../solar-layout";

const M = MODULE_FALLBACK_MM;
// Plano, TX — the roof this whole feature was built to read.
const ORIGIN = { lat: 33.0198, lng: -96.6989 };

const block = (over: Partial<LayoutBlock> = {}): LayoutBlock => ({
  id: "b1",
  originE: 0,
  originN: 0,
  rotationDeg: 0,
  cols: 4,
  rows: 2,
  orientation: "portrait",
  omitted: [],
  azimuthDeg: null,
  tiltDeg: null,
  ...over,
});

/** A patch of Google panels covering a rectangle, all on one segment. */
function patch(
  segmentIndex: number,
  bounds: { fromE: number; toE: number; fromN: number; toN: number }
) {
  const out: { e: number; n: number; segmentIndex: number }[] = [];
  for (let e = bounds.fromE; e <= bounds.toE; e += 1) {
    for (let n = bounds.fromN; n <= bounds.toN; n += 1) out.push({ e, n, segmentIndex });
  }
  return out;
}

/** A hip roof: south plane below the ridge at n = 0, north plane above it. */
const HIP: RoofPlanes = {
  segments: [
    { index: 0, pitchDeg: 23, azimuthDeg: 180, areaM2: 60, centerE: 0, centerN: -5 },
    { index: 1, pitchDeg: 23, azimuthDeg: 0, areaM2: 60, centerE: 0, centerN: 5 },
  ],
  panels: [
    ...patch(0, { fromE: -10, toE: 10, fromN: -10, toN: -1 }),
    ...patch(1, { fromE: -10, toE: 10, fromN: 1, toN: 10 }),
  ],
  imageryQuality: "HIGH",
  imageryDate: "March 2025",
};

describe("readBuildingInsights", () => {
  const response = {
    imageryQuality: "HIGH",
    imageryDate: { year: 2025, month: 3, day: 14 },
    solarPotential: {
      roofSegmentStats: [
        {
          pitchDegrees: 22.6,
          azimuthDegrees: 187.4,
          stats: { areaMeters2: 61.2 },
          center: { latitude: 33.0197, longitude: -96.6989 },
        },
        {
          pitchDegrees: 22.6,
          azimuthDegrees: 7.4,
          stats: { areaMeters2: 58.9 },
          center: { latitude: 33.0199, longitude: -96.6989 },
        },
      ],
      solarPanels: [
        { center: { latitude: 33.0197, longitude: -96.6989 }, segmentIndex: 0 },
        { center: { latitude: 33.0199, longitude: -96.6989 }, segmentIndex: 1 },
      ],
    },
  };

  it("reads the planes, the panels and the imagery", () => {
    const roof = readBuildingInsights(response)!;
    expect(roof.segments).toHaveLength(2);
    expect(roof.segments[0].index).toBe(0);
    expect(roof.segments[0].pitchDeg).toBeCloseTo(22.6, 4);
    expect(roof.segments[0].azimuthDeg).toBeCloseTo(187.4, 4);
    expect(roof.panels).toHaveLength(2);
    expect(roof.imageryQuality).toBe("HIGH");
    expect(roof.imageryDate).toBe("March 2025");
  });

  it("normalises a negative azimuth to a compass bearing", () => {
    const raw = structuredClone(response);
    raw.solarPotential.roofSegmentStats[0].azimuthDegrees = -172.6;
    expect(readBuildingInsights(raw)!.segments[0].azimuthDeg).toBeCloseTo(187.4, 4);
  });

  it("drops a plane described by only one of the two angles", () => {
    const raw = structuredClone(response);
    delete (raw.solarPotential.roofSegmentStats[0] as Partial<{ pitchDegrees: number }>)
      .pitchDegrees;
    const roof = readBuildingInsights(raw)!;
    expect(roof.segments.map((s) => s.index)).toEqual([1]);
    // And the panel that pointed at it goes with it — a label for a plane that
    // is not there would win a vote and price nothing.
    expect(roof.panels.every((p) => p.segmentIndex === 1)).toBe(true);
  });

  it("is null for a body with no roof in it", () => {
    expect(readBuildingInsights(null)).toBeNull();
    expect(readBuildingInsights({})).toBeNull();
    expect(readBuildingInsights({ solarPotential: {} })).toBeNull();
    expect(readBuildingInsights({ solarPotential: { roofSegmentStats: [] } })).toBeNull();
  });
});

describe("toGroundPlanes", () => {
  it("puts the deal's own coordinate at the origin", () => {
    const ground = toGroundPlanes(
      {
        segments: [
          {
            index: 0,
            pitchDeg: 20,
            azimuthDeg: 180,
            areaM2: 10,
            centerLat: ORIGIN.lat,
            centerLng: ORIGIN.lng,
          },
        ],
        panels: [],
        imageryQuality: null,
        imageryDate: null,
      },
      ORIGIN
    );
    expect(ground.segments[0].centerE).toBeCloseTo(0, 6);
    expect(ground.segments[0].centerN).toBeCloseTo(0, 6);
  });

  it("measures north and east in metres", () => {
    // A ten-thousandth of a degree of latitude is about 11.1 m.
    const ground = toGroundPlanes(
      {
        segments: [],
        panels: [{ lat: ORIGIN.lat + 0.0001, lng: ORIGIN.lng, segmentIndex: 0 }],
        imageryQuality: null,
        imageryDate: null,
      },
      ORIGIN
    );
    expect(ground.panels[0].n).toBeCloseTo(11.13, 1);
    expect(ground.panels[0].e).toBeCloseTo(0, 6);
  });
});

describe("assignPlanes", () => {
  it("gives an array the plane its panels sit on", () => {
    // Two rows of four, entirely below the ridge: the south plane.
    const south = assignPlanes([block({ originN: -3 })], HIP, M).get("b1")!;
    expect(south.azimuthDeg).toBe(180);
    expect(south.tiltDeg).toBe(23);
    expect(south.planesSpanned).toBe(1);

    const north = assignPlanes([block({ originN: 8 })], HIP, M).get("b1")!;
    expect(north.azimuthDeg).toBe(0);
  });

  it("flags an array drawn across the ridge, and keeps the majority plane", () => {
    // Origin is the TOP-left corner and rows run down (south), so this block
    // starts on the north plane and runs over onto the south one — one row up
    // there, two below, so the south plane is the honest majority.
    const hit = assignPlanes([block({ originN: 2, rows: 3 })], HIP, M).get("b1")!;
    expect(hit.azimuthDeg).toBe(180);
    expect(hit.planesSpanned).toBe(2);
    expect(hit.panels).toBe(12);
    expect(hit.onPlane).toBe(8);
  });

  it("says nothing about an array off the modelled roof", () => {
    // A ground mount out in the yard, well past the fallback radius.
    expect(assignPlanes([block({ originE: 60, originN: 60 })], HIP, M).size).toBe(0);
  });

  it("falls back to the nearest segment centre when Google placed no panels", () => {
    const noPanels: RoofPlanes = { ...HIP, panels: [] };
    const hit = assignPlanes([block({ originN: -3 })], noPanels, M).get("b1")!;
    expect(hit.azimuthDeg).toBe(180);
  });

  it("reaches across the gap Google leaves at a setback, and prefers panels to centres", () => {
    // Google's panels stop short of the eave, so a rep who draws tight to it is
    // a couple of metres clear of the nearest modelled one. Segment 1's centre
    // is deliberately the NEARER of the two centres, so this only passes if the
    // labelled panels decided it rather than the coarse fallback.
    const gapped: RoofPlanes = {
      segments: [
        { index: 0, pitchDeg: 23, azimuthDeg: 180, areaM2: 60, centerE: 0, centerN: -6 },
        { index: 1, pitchDeg: 40, azimuthDeg: 270, areaM2: 60, centerE: 0, centerN: -2 },
      ],
      panels: [
        ...patch(0, { fromE: -6, toE: 6, fromN: -10, toN: -6 }),
        ...patch(1, { fromE: -6, toE: 6, fromN: 20, toN: 24 }),
      ],
      imageryQuality: "HIGH",
      imageryDate: null,
    };
    // One panel centred 2.5 m north of the last modelled one — inside the cutoff.
    const eave = block({ originN: -6 + 2.5 + 0.881, rows: 1, cols: 1 });
    expect(assignPlanes([eave], gapped, M).get("b1")?.azimuthDeg).toBe(180);

    // And the cutoff is real: the same panel far out past the modelled roof and
    // past the fallback radius is not placed at all.
    const away = block({ originN: 40 });
    expect(assignPlanes([away], gapped, M).size).toBe(0);
    expect(NEAREST_PANEL_CUTOFF_M).toBeGreaterThan(2.5);
  });

  it("ignores an array with every panel knocked out", () => {
    const empty = block({ cols: 2, rows: 1, omitted: [0, 1], originN: -3 });
    expect(assignPlanes([empty], HIP, M).size).toBe(0);
  });
});

describe("segmentHulls", () => {
  it("wraps each plane's own panels, and nothing else's", () => {
    const hulls = segmentHulls(HIP);
    expect(hulls).toHaveLength(2);

    const south = hulls.find((h) => h.segmentIndex === 0)!;
    expect(south.azimuthDeg).toBe(180);
    expect(south.ring.length).toBeGreaterThanOrEqual(3);
    // Every point of the south hull is south of the ridge. A bounding box would
    // have covered both planes; this must not.
    expect(south.ring.every((p) => p.n < 0)).toBe(true);
    expect(hulls.find((h) => h.segmentIndex === 1)!.ring.every((p) => p.n > 0)).toBe(true);
  });

  it("encloses the corners of the patch it was given", () => {
    const [south] = segmentHulls(HIP);
    const es = south.ring.map((p) => p.e);
    const ns = south.ring.map((p) => p.n);
    expect(Math.min(...es)).toBeCloseTo(-10, 6);
    expect(Math.max(...es)).toBeCloseTo(10, 6);
    expect(Math.min(...ns)).toBeCloseTo(-10, 6);
    expect(Math.max(...ns)).toBeCloseTo(-1, 6);
  });

  it("draws nothing for a plane with too few panels to enclose an area", () => {
    const sparse: RoofPlanes = { ...HIP, panels: [{ e: 0, n: -2, segmentIndex: 0 }] };
    expect(segmentHulls(sparse).every((h) => h.ring.length === 0)).toBe(true);
  });
});

describe("applyPlanes", () => {
  it("fills an array nobody has described, and marks where it came from", () => {
    const result = applyPlanes([block({ originN: -3 })], HIP, M);
    expect(result.filled).toBe(1);
    expect(result.blocks[0]).toMatchObject({
      azimuthDeg: 180,
      tiltDeg: 23,
      facingSource: "roof",
    });
  });

  it("never overwrites a figure a person entered", () => {
    const typed = block({ originN: -3, azimuthDeg: 90, tiltDeg: 10 });
    const result = applyPlanes([typed], HIP, M);
    expect(result.filled).toBe(0);
    expect(result.blocks[0]).toMatchObject({ azimuthDeg: 90, tiltDeg: 10 });
    expect(result.blocks[0].facingSource).toBeUndefined();
  });

  it("fills only the half that is missing, and does not claim the whole", () => {
    const halfTyped = block({ originN: -3, azimuthDeg: 90 });
    const result = applyPlanes([halfTyped], HIP, M);
    expect(result.blocks[0].azimuthDeg).toBe(90);
    expect(result.blocks[0].tiltDeg).toBe(23);
    // The facing is still the rep's, so the array is not "read from the roof".
    expect(result.blocks[0].facingSource).toBeUndefined();
  });

  it("reports which filled arrays straddle a ridge", () => {
    const result = applyPlanes([block({ originN: 2 })], HIP, M);
    expect(result.straddling).toEqual(["b1"]);
  });

  it("changes nothing at all when there is no roof — the no-regression rule", () => {
    const blocks = [block(), block({ id: "b2", originN: 40 })];
    const result = applyPlanes(blocks, null, M);
    expect(result).toMatchObject({ filled: 0, straddling: [] });
    expect(result.blocks).toBe(blocks);
    expect(result.blocks.every((b) => b.azimuthDeg == null && b.tiltDeg == null)).toBe(true);
  });

  it("leaves an array Google cannot place exactly as it was", () => {
    const roof = block({ originN: -3 });
    const yard = block({ id: "b2", originE: 60, originN: 60 });
    const result = applyPlanes([roof, yard], HIP, M);
    expect(result.filled).toBe(1);
    expect(result.blocks[1]).toEqual(yard);
  });
});
