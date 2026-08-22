/**
 * Reading a facing and a pitch off the roof itself, instead of asking.
 *
 * `solar-layout` says in its own header that an array drawn along a ridge faces
 * square off it "but off WHICH side is a coin toss the drawing cannot settle",
 * and that was true of the drawing. It is not true of the building: Google's
 * Solar API has a photogrammetric model of the roof and will say, per plane,
 * which way it points and how steep it is. So the coin toss stops being a
 * judgement a rep has to make and becomes a lookup.
 *
 * WHY NOT THE BOUNDING BOXES. Each segment comes with a `boundingBox`, and
 * testing which box a panel falls in is the obvious implementation. It is also
 * wrong on the commonest roof there is: the boxes are axis-aligned, so on a hip
 * roof the four planes' boxes overlap heavily around the ridge and a box test
 * hands back a confident answer that is a coin toss again — the exact failure
 * this module exists to remove.
 *
 * WHAT IS USED INSTEAD: Google returns its OWN panel placements, several
 * hundred of them on a house, each stamped with the segment it sits on. That is
 * a dense labelled point cloud across the roof, so every panel a rep has drawn
 * can take the label of the nearest one. A stray near an edge is outvoted by
 * the rest of its array, which is what makes a vote better than a test.
 *
 * NOTHING HERE FETCHES. The request, the cache and the key live in
 * `@/server/modules/solar/roof-planes`, for the same reason `solar-pvwatts` is
 * split from its server module: the parsing and the geometry are the parts
 * worth testing, and a module that fetches cannot be tested without pretending
 * to be Google.
 *
 * THE NO-REGRESSION RULE, inherited from `solar-orientation`: an array this
 * module cannot place keeps a null facing and prices on the company's market
 * average exactly as it did before. A missing roof, a rural address, an
 * unreachable API and a panel out on the lawn all take that path.
 */

import {
  cellCorners,
  blockPanelCount,
  type LayoutBlock,
  type ModuleMm,
} from "./solar-layout";

// ---------------------------------------------------------------------------
// What a roof looks like once Google has answered
// ---------------------------------------------------------------------------

/** How good the imagery behind the model is, in Google's own words. */
export type ImageryQuality = "HIGH" | "MEDIUM" | "LOW";

/**
 * One roof plane, in degrees and lat/lng — the form it is CACHED in.
 *
 * Deliberately not ground metres: metres are measured from one deal's
 * coordinate, and a cache keyed on a building has to outlive any particular
 * deal on it. Two leads on the same house share one row.
 */
export type RoofSegmentGeo = {
  /** Google's own index for this segment, which its panels refer to. */
  index: number;
  /** Slope off horizontal, degrees. 0 is flat. */
  pitchDeg: number;
  /** Clockwise from true north, degrees — 180 is due south. Our convention too. */
  azimuthDeg: number;
  areaM2: number;
  centerLat: number;
  centerLng: number;
};

/** One of Google's own panels: a labelled point on the roof. */
export type RoofPanelGeo = { lat: number; lng: number; segmentIndex: number };

/** Everything known about one building's roof. The shape the cache stores. */
export type RoofPlanesGeo = {
  segments: RoofSegmentGeo[];
  panels: RoofPanelGeo[];
  imageryQuality: ImageryQuality | null;
  /** "March 2025" — what the model was built from, for the record. */
  imageryDate: string | null;
};

/** The same roof, measured from a deal's coordinate like everything else. */
export type RoofSegment = Omit<RoofSegmentGeo, "centerLat" | "centerLng"> & {
  centerE: number;
  centerN: number;
};

export type RoofPlanes = {
  segments: RoofSegment[];
  /** Google's panel centres, ground metres east/north of the deal. */
  panels: { e: number; n: number; segmentIndex: number }[];
  imageryQuality: ImageryQuality | null;
  imageryDate: string | null;
};

// ---------------------------------------------------------------------------
// Reading Google's answer
// ---------------------------------------------------------------------------

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** 0..359, so a bearing of -10 and one of 350 are the same facing. */
export function norm360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * How many of Google's panels are kept.
 *
 * A large roof can carry several hundred, and every one of them is stored in
 * the cache row and shipped to the browser. The vote does not get better past a
 * few hundred points — they are already a metre apart — so this is a bound on
 * the payload rather than a limit on the answer.
 */
const MAX_PANELS = 1200;

/**
 * Google's `buildingInsights:findClosest` response → a roof, or null.
 *
 * Null for a response with no usable planes at all, which is an ordinary state:
 * outside the coverage area the API returns 404, and inside it a building it
 * cannot model returns a body with nothing in it.
 */
export function readBuildingInsights(raw: unknown): RoofPlanesGeo | null {
  if (!raw || typeof raw !== "object") return null;
  const root = raw as Record<string, unknown>;
  const potential = root.solarPotential as Record<string, unknown> | undefined;
  if (!potential || typeof potential !== "object") return null;

  const rawSegments = Array.isArray(potential.roofSegmentStats)
    ? potential.roofSegmentStats
    : [];

  const segments: RoofSegmentGeo[] = [];
  rawSegments.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") return;
    const s = entry as Record<string, unknown>;
    const pitch = num(s.pitchDegrees);
    const azimuth = num(s.azimuthDegrees);
    // A plane described by only one of the two angles cannot price anything —
    // `planeFor` needs both, and half a description is worse than none because
    // it looks like an answer.
    if (pitch == null || azimuth == null) return;
    const centre = s.center as Record<string, unknown> | undefined;
    const lat = num(centre?.latitude);
    const lng = num(centre?.longitude);
    if (lat == null || lng == null) return;
    const stats = s.stats as Record<string, unknown> | undefined;
    segments.push({
      index,
      // A flat roof comes back as a small non-zero pitch and that is fine, but
      // the model is undefined past vertical.
      pitchDeg: Math.max(0, Math.min(90, pitch)),
      azimuthDeg: norm360(azimuth),
      areaM2: num(stats?.areaMeters2) ?? 0,
      centerLat: lat,
      centerLng: lng,
    });
  });
  if (segments.length === 0) return null;

  const known = new Set(segments.map((s) => s.index));
  const rawPanels = Array.isArray(potential.solarPanels) ? potential.solarPanels : [];
  const panels: RoofPanelGeo[] = [];
  for (const entry of rawPanels) {
    if (panels.length >= MAX_PANELS) break;
    if (!entry || typeof entry !== "object") continue;
    const p = entry as Record<string, unknown>;
    const centre = p.center as Record<string, unknown> | undefined;
    const lat = num(centre?.latitude);
    const lng = num(centre?.longitude);
    const segmentIndex = num(p.segmentIndex);
    if (lat == null || lng == null || segmentIndex == null) continue;
    // A panel pointing at a segment we threw away describes nothing.
    if (!known.has(segmentIndex)) continue;
    panels.push({ lat, lng, segmentIndex });
  }

  const quality = root.imageryQuality;
  const date = root.imageryDate as Record<string, unknown> | undefined;
  const year = num(date?.year);
  const month = num(date?.month);

  return {
    segments,
    panels,
    imageryQuality:
      quality === "HIGH" || quality === "MEDIUM" || quality === "LOW" ? quality : null,
    imageryDate:
      year == null ? null : month == null ? String(year) : `${MONTHS[month - 1] ?? month} ${year}`,
  };
}

// ---------------------------------------------------------------------------
// Lat/lng → the ground metres everything else in the designer speaks
// ---------------------------------------------------------------------------

/** The Web Mercator sphere, the same one `metresPerPixel` measures the tiles with. */
const EARTH_RADIUS_M = 6378137;
const M_PER_DEG_LAT = (Math.PI * EARTH_RADIUS_M) / 180;

/**
 * A roof in lat/lng → the same roof in metres east and north of a deal.
 *
 * Flat-earth on purpose. A residential roof is tens of metres across, where the
 * equirectangular error is under a millimetre — and the whole designer already
 * treats north as a straight vertical for the same reason (`metresToImagePx`).
 */
export function toGroundPlanes(
  geo: RoofPlanesGeo,
  origin: { lat: number; lng: number }
): RoofPlanes {
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((origin.lat * Math.PI) / 180);
  const east = (lng: number) => (lng - origin.lng) * mPerDegLng;
  const north = (lat: number) => (lat - origin.lat) * M_PER_DEG_LAT;
  return {
    segments: geo.segments.map(({ centerLat, centerLng, ...rest }) => ({
      ...rest,
      centerE: east(centerLng),
      centerN: north(centerLat),
    })),
    panels: geo.panels.map((p) => ({
      e: east(p.lng),
      n: north(p.lat),
      segmentIndex: p.segmentIndex,
    })),
    imageryQuality: geo.imageryQuality,
    imageryDate: geo.imageryDate,
  };
}

// ---------------------------------------------------------------------------
// Which plane is an array on
// ---------------------------------------------------------------------------

/**
 * How far one of our panels may be from the nearest of Google's and still take
 * its label, in metres.
 *
 * Google leaves the edges of a roof empty where a setback would be, so a panel
 * a rep has drawn tight to an eave can sit a couple of metres from the nearest
 * modelled one. Three metres reaches across that gap; it is also short enough
 * that a panel on the far side of a ridge is picked up by its own plane, whose
 * panels start about a metre away, rather than by the one behind it.
 */
export const NEAREST_PANEL_CUTOFF_M = 3;

/**
 * The fallback radius from a segment's centre, for a roof Google described but
 * placed no panels on. Half the span of a large residential plane.
 */
export const SEGMENT_CENTRE_CUTOFF_M = 12;

/**
 * The share of an array's panels that has to sit on a second plane before the
 * array counts as straddling a ridge.
 *
 * A quarter. Below that it is an overhang or an edge effect and the majority is
 * plainly the answer; at or above it, two real planes are being priced as one
 * and the rep is told so rather than having their drawing cut in half for them.
 */
export const STRADDLE_SHARE = 0.25;

export type PlaneAssignment = {
  blockId: string;
  segmentIndex: number;
  azimuthDeg: number;
  tiltDeg: number;
  /** How many of the array's panels landed on the winning plane, and in total. */
  onPlane: number;
  panels: number;
  /** How many distinct planes hold at least `STRADDLE_SHARE` of the array. */
  planesSpanned: number;
};

/** The centre of every present panel in a block, in ground metres. */
function panelCentres(b: LayoutBlock, m: ModuleMm): { e: number; n: number }[] {
  const cells = Math.max(0, b.cols) * Math.max(0, b.rows);
  const skip = new Set(b.omitted);
  const out: { e: number; n: number }[] = [];
  for (let index = 0; index < cells; index++) {
    if (skip.has(index)) continue;
    const corners = cellCorners(b, m, index);
    out.push({
      e: (corners[0].e + corners[2].e) / 2,
      n: (corners[0].n + corners[2].n) / 2,
    });
  }
  return out;
}

/** Which of Google's segments one point sits on, or null if none is near. */
function segmentAt(point: { e: number; n: number }, planes: RoofPlanes): number | null {
  let best: number | null = null;
  let bestDist = Infinity;

  for (const p of planes.panels) {
    const d = (p.e - point.e) ** 2 + (p.n - point.n) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = p.segmentIndex;
    }
  }
  if (best != null && bestDist <= NEAREST_PANEL_CUTOFF_M ** 2) return best;

  // No modelled panels near enough — Google described the planes but put no
  // panels on this part of the roof, or none at all. Fall back to the nearest
  // segment CENTRE, which is coarse but is still the building's own geometry.
  best = null;
  bestDist = Infinity;
  for (const s of planes.segments) {
    const d = (s.centerE - point.e) ** 2 + (s.centerN - point.n) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = s.index;
    }
  }
  return best != null && bestDist <= SEGMENT_CENTRE_CUTOFF_M ** 2 ? best : null;
}

/**
 * The plane each array sits on, by a vote of its own panels.
 *
 * Arrays with no panels, and arrays whose panels are all off the modelled roof
 * — a ground mount, a patio cover, a pergola Google never saw — are simply
 * absent from the result. Absent means "nobody has measured this", which is the
 * state the whole no-regression rule is built on.
 */
export function assignPlanes(
  blocks: LayoutBlock[],
  planes: RoofPlanes,
  m: ModuleMm
): Map<string, PlaneAssignment> {
  const out = new Map<string, PlaneAssignment>();
  if (planes.segments.length === 0) return out;
  const bySegment = new Map(planes.segments.map((s) => [s.index, s]));

  for (const block of blocks) {
    if (blockPanelCount(block) === 0) continue;

    const votes = new Map<number, number>();
    let placed = 0;
    for (const centre of panelCentres(block, m)) {
      const index = segmentAt(centre, planes);
      if (index == null) continue;
      votes.set(index, (votes.get(index) ?? 0) + 1);
      placed++;
    }
    if (placed === 0) continue;

    let winner = -1;
    let winnerVotes = 0;
    for (const [index, n] of votes) {
      // Ties break on the larger plane: a tie means the array is centred on a
      // ridge, and the bigger plane is the one more of the roof agrees with.
      const bigger = (bySegment.get(index)?.areaM2 ?? 0) > (bySegment.get(winner)?.areaM2 ?? 0);
      if (n > winnerVotes || (n === winnerVotes && bigger)) {
        winner = index;
        winnerVotes = n;
      }
    }
    const segment = bySegment.get(winner);
    if (!segment) continue;

    const threshold = placed * STRADDLE_SHARE;
    const planesSpanned = [...votes.values()].filter((n) => n >= threshold).length;

    out.set(block.id, {
      blockId: block.id,
      segmentIndex: segment.index,
      azimuthDeg: Math.round(segment.azimuthDeg),
      tiltDeg: Math.round(segment.pitchDeg),
      onPlane: winnerVotes,
      panels: placed,
      planesSpanned,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Showing the rep what the tool thinks the roof is
// ---------------------------------------------------------------------------

export type SegmentHull = {
  segmentIndex: number;
  azimuthDeg: number;
  pitchDeg: number;
  /** A ring of ground-metre points, or empty when the plane is too sparse to draw. */
  ring: { e: number; n: number }[];
};

/**
 * The outline of each plane, as the convex hull of the panels on it.
 *
 * Google does not return a polygon for a segment — only an axis-aligned
 * `boundingBox`, which on a hip roof is a rectangle covering three planes that
 * are not this one. Drawing that would be drawing a lie in the one place it
 * would be believed, because a rep checking the tool's work is exactly who
 * looks at this overlay.
 *
 * A hull of the segment's own panels is not the true roof plane either — it
 * stops where Google's panels stop, short of the eaves — but every point in it
 * IS on that plane, which is the property that matters for a sanity check.
 */
export function segmentHulls(planes: RoofPlanes): SegmentHull[] {
  const byIndex = new Map<number, { e: number; n: number }[]>();
  for (const p of planes.panels) {
    const list = byIndex.get(p.segmentIndex);
    if (list) list.push({ e: p.e, n: p.n });
    else byIndex.set(p.segmentIndex, [{ e: p.e, n: p.n }]);
  }

  return planes.segments.map((s) => ({
    segmentIndex: s.index,
    azimuthDeg: s.azimuthDeg,
    pitchDeg: s.pitchDeg,
    ring: convexHull(byIndex.get(s.index) ?? []),
  }));
}

/**
 * Andrew's monotone chain. Fewer than three points enclose no area, so they
 * return nothing rather than a degenerate ring the canvas would draw as a
 * hairline nobody can interpret.
 */
export function convexHull(points: { e: number; n: number }[]): { e: number; n: number }[] {
  if (points.length < 3) return [];
  const pts = [...points].sort((a, b) => a.e - b.e || a.n - b.n);
  const cross = (
    o: { e: number; n: number },
    a: { e: number; n: number },
    b: { e: number; n: number }
  ) => (a.e - o.e) * (b.n - o.n) - (a.n - o.n) * (b.e - o.e);

  const half = (input: { e: number; n: number }[]) => {
    const out: { e: number; n: number }[] = [];
    for (const p of input) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };

  const hull = [...half(pts), ...half([...pts].reverse())];
  return hull.length >= 3 ? hull : [];
}

// ---------------------------------------------------------------------------
// Filling in what nobody has said
// ---------------------------------------------------------------------------

export type ApplyResult = {
  blocks: LayoutBlock[];
  /** How many arrays gained an angle they did not have. */
  filled: number;
  /** Arrays that were filled and sit across more than one plane. */
  straddling: string[];
};

/**
 * Give every undescribed array the angles of the plane it sits on.
 *
 * A FIGURE A PERSON ENTERED IS NEVER OVERWRITTEN, per field. A rep who set the
 * facing but not the pitch keeps their facing and gains a pitch; a rep who set
 * both is left entirely alone. That asymmetry is the point: this exists to fill
 * silence, not to arbitrate. When the two disagree the rep is the one standing
 * in front of the house.
 *
 * Used on BOTH sides of the wire — the designer for its live preview and
 * `recomputeDesignFigures` for what is stored — so the number on screen and the
 * number saved cannot be arrived at two different ways. Same discipline as
 * `solar-arrays`, and for the same reason.
 */
export function applyPlanes(
  blocks: LayoutBlock[],
  planes: RoofPlanes | null,
  m: ModuleMm
): ApplyResult {
  if (!planes) return { blocks, filled: 0, straddling: [] };
  const assigned = assignPlanes(blocks, planes, m);
  if (assigned.size === 0) return { blocks, filled: 0, straddling: [] };

  let filled = 0;
  const straddling: string[] = [];
  const next = blocks.map((b) => {
    const hit = assigned.get(b.id);
    if (!hit) return b;
    const needsAzimuth = b.azimuthDeg == null;
    const needsTilt = b.tiltDeg == null;
    if (!needsAzimuth && !needsTilt) return b;

    filled++;
    if (hit.planesSpanned > 1) straddling.push(b.id);
    return {
      ...b,
      ...(needsAzimuth ? { azimuthDeg: hit.azimuthDeg } : {}),
      ...(needsTilt ? { tiltDeg: hit.tiltDeg } : {}),
      // Only when the roof supplied BOTH. A block carrying a hand-typed facing
      // and a measured pitch is not "read from the roof", and labelling it so
      // would credit the tool with a rep's own judgement.
      ...(needsAzimuth && needsTilt ? { facingSource: "roof" as const } : {}),
    };
  });

  return { blocks: next, filled, straddling };
}
