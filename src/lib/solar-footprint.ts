/**
 * Which way a roof falls, read off the shape of the building underneath it.
 *
 * `solar-roof-planes` gets the facing from Google's photogrammetric model, per
 * plane, and is strictly better than this. But that API is a switch somebody
 * has to flick, and it does not model every building — rural addresses, new
 * construction and poor imagery all come back empty. Today an array in that
 * state keeps a null facing, which means `planeFor` skips PVWatts and the whole
 * system prices on a flat market average that knows nothing about orientation.
 * On a south roof in Plano that understates production by 23%.
 *
 * So this is the floor, not the ceiling: an ordinary house has a ridge along
 * its long axis and slopes square to it, which is enough to tell south from
 * east — and telling south from east is most of the money.
 *
 * WHAT IT CANNOT DO, and the caller must say so out loud:
 *   - One ridge for the whole building. An L-plan, a cross-gable or a T is a
 *     roof with two ridges and this reports the dominant one.
 *   - It cannot tell the four faces of a hip apart. It offers the two the
 *     slopes of a simple gable would have.
 *   - It knows nothing about pitch. An array with no tilt stays unpriced.
 *
 * Which is why nothing here is ever labelled `facingSource: "roof"`. A figure
 * from this module is `"footprint"` — an inference from an outline — and the
 * proposal says as much. A rep who can see the house overrides it and their
 * figure wins, exactly as it does over Google's.
 *
 * Pure and network-free, like every other `solar-*` lib. The fetch and the
 * cache live in `@/server/modules/solar/footprint`.
 */

import { convexHull, norm360 } from "./solar-roof-planes";
import { blockPanelCount, type LayoutBlock } from "./solar-layout";

/** The Web Mercator sphere, as `solar-roof-planes` measures it. */
const EARTH_RADIUS_M = 6378137;
const M_PER_DEG_LAT = (Math.PI * EARTH_RADIUS_M) / 180;

/** A building outline, in ground metres east/north of the deal's coordinate. */
export type Footprint = {
  /** A closed ring — the first point repeats at the end. */
  points: { e: number; n: number }[];
  areaM2: number;
};

export type RidgeReading = {
  /** The ridge line's bearing, 0..179. A line has no direction, so neither has this. */
  ridgeDeg: number;
  /** The two facings a simple gable on this ridge would have, 180° apart. */
  facings: [number, number];
  /** The one to offer: whichever points nearer the equator. */
  facingDeg: number;
  longM: number;
  shortM: number;
  /** long ÷ short. Near 1 is a square, where the ridge is a coin toss. */
  rectangularity: number;
};

/**
 * How much longer than it is wide a footprint must be before its long axis is
 * worth believing.
 *
 * A 14 x 13 m house has a long axis in the arithmetic sense and none in the
 * architectural one — the ridge could run either way and the shape does not
 * say. Guessing there is worse than declining, because a wrong facing is
 * confidently wrong: it moves the production figure and looks like a
 * measurement. 1.25 keeps ordinary rectangular houses and drops the squares.
 */
export const MIN_RECTANGULARITY = 1.25;

/** Below this a footprint is a shed, a garage or a pool house, not the roof. */
export const MIN_FOOTPRINT_M2 = 40;

/** Ways nearer than this to the pin are candidates. Beyond it is next door. */
export const MAX_PIN_DISTANCE_M = 30;

// ---------------------------------------------------------------------------

type OverpassPoint = { lat: number; lon: number };

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Twice the signed area of a ring, and its centroid. Shoelace. */
function ringStats(points: { e: number; n: number }[]): {
  areaM2: number;
  centroid: { e: number; n: number };
} {
  let twice = 0;
  let ce = 0;
  let cn = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const cross = a.e * b.n - b.e * a.n;
    twice += cross;
    ce += (a.e + b.e) * cross;
    cn += (a.n + b.n) * cross;
  }
  if (twice === 0) return { areaM2: 0, centroid: { e: 0, n: 0 } };
  return {
    areaM2: Math.abs(twice / 2),
    centroid: { e: ce / (3 * twice), n: cn / (3 * twice) },
  };
}

/**
 * An Overpass `out geom` response → the building the pin is standing on.
 *
 * NEAREST, not biggest. A pin sits on one house, and the neighbour's garage
 * being larger says nothing about which roof the panels are going on.
 *
 * Flat-earth, for the same reason `toGroundPlanes` is: a residential lot is
 * tens of metres across, where the equirectangular error is under a millimetre.
 */
export function readOverpassFootprint(
  raw: unknown,
  origin: { lat: number; lng: number }
): Footprint | null {
  if (!raw || typeof raw !== "object") return null;
  const elements = (raw as { elements?: unknown }).elements;
  if (!Array.isArray(elements)) return null;

  const mPerDegLng = M_PER_DEG_LAT * Math.cos((origin.lat * Math.PI) / 180);

  let best: { footprint: Footprint; distance: number } | null = null;

  for (const element of elements) {
    if (!element || typeof element !== "object") continue;
    const geometry = (element as { geometry?: unknown }).geometry;
    if (!Array.isArray(geometry) || geometry.length < 4) continue;

    const points: { e: number; n: number }[] = [];
    let bad = false;
    for (const node of geometry as OverpassPoint[]) {
      const lat = num(node?.lat);
      const lon = num(node?.lon);
      if (lat == null || lon == null) {
        bad = true;
        break;
      }
      points.push({
        e: (lon - origin.lng) * mPerDegLng,
        n: (lat - origin.lat) * M_PER_DEG_LAT,
      });
    }
    if (bad) continue;

    // A building is a closed way. An open one is a wall or a bad extract, and
    // its "area" is whatever the shoelace makes of an unclosed ring.
    const first = points[0];
    const last = points[points.length - 1];
    if (Math.hypot(first.e - last.e, first.n - last.n) > 0.5) continue;

    const { areaM2, centroid } = ringStats(points);
    if (areaM2 < MIN_FOOTPRINT_M2) continue;

    const distance = Math.hypot(centroid.e, centroid.n);
    if (distance > MAX_PIN_DISTANCE_M) continue;
    if (!best || distance < best.distance) {
      best = { footprint: { points, areaM2 }, distance };
    }
  }

  return best?.footprint ?? null;
}

/**
 * The ridge of an ordinary roof, from the tightest box its outline fits in.
 *
 * The box is found by rotating callipers on the convex hull: the minimum-area
 * rectangle around a convex polygon always has a side flush with one of its
 * edges, so trying each edge in turn finds it exactly. The hull first because
 * an L-plan house is not convex, and an edge of the notch is not a side of the
 * box.
 *
 * `lat` decides which of the two slopes is offered: the sun is in the south
 * from the northern hemisphere and in the north from the southern one, and a
 * default that ignores that is wrong for half the planet.
 *
 * Null when the shape does not carry the answer — see `MIN_RECTANGULARITY`.
 */
export function ridgeFrom(footprint: Footprint, lat: number): RidgeReading | null {
  if (footprint.areaM2 < MIN_FOOTPRINT_M2) return null;

  const hull = convexHull(footprint.points);
  if (hull.length < 3) return null;

  let best: { area: number; longM: number; shortM: number; axisDeg: number } | null = null;

  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const dx = b.e - a.e;
    const dy = b.n - a.n;
    const length = Math.hypot(dx, dy);
    if (length < 0.5) continue;

    const ux = dx / length;
    const uy = dy / length;
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const p of hull) {
      const u = p.e * ux + p.n * uy;
      const v = -p.e * uy + p.n * ux;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const w = maxU - minU;
    const h = maxV - minV;
    const area = w * h;
    if (best && area >= best.area) continue;

    // The long side is the ridge. `u` runs along this edge, `v` square to it.
    const alongIsLonger = w >= h;
    const axisX = alongIsLonger ? ux : -uy;
    const axisY = alongIsLonger ? uy : ux;
    best = {
      area,
      longM: Math.max(w, h),
      shortM: Math.min(w, h),
      // atan2(east, north) — a compass bearing, not a maths angle.
      axisDeg: (Math.atan2(axisX, axisY) * 180) / Math.PI,
    };
  }

  if (!best || best.shortM <= 0) return null;
  const rectangularity = best.longM / best.shortM;
  if (rectangularity < MIN_RECTANGULARITY) return null;

  // Rounded to a tenth of a degree. The precision is not real — it comes from
  // where a volunteer put the corners of a building in OpenStreetMap — and
  // `179.70871096740348` printed beside "Facing" claims a survey that nobody
  // did. A tenth is finer than the yield cache's own half-degree bucket, so
  // nothing downstream loses anything by it.
  const round1 = (deg: number) => Math.round(deg * 10) / 10;
  const ridgeDeg = round1(((best.axisDeg % 180) + 180) % 180);
  const facings: [number, number] = [norm360(ridgeDeg + 90), norm360(ridgeDeg + 270)];
  const equator = lat >= 0 ? 180 : 0;
  const away = (deg: number) => Math.abs(((deg - equator + 540) % 360) - 180);
  const facingDeg = away(facings[0]) <= away(facings[1]) ? facings[0] : facings[1];

  return {
    ridgeDeg,
    facings,
    facingDeg,
    longM: best.longM,
    shortM: best.shortM,
    rectangularity,
  };
}

// ---------------------------------------------------------------------------
// Putting it on the arrays
// ---------------------------------------------------------------------------

export type FootprintFill = { blocks: LayoutBlock[]; filled: number };

/**
 * Give every array with no facing the one the building's outline implies.
 *
 * Runs AFTER `applyPlanes`, never instead of it: Google's model is per plane
 * and this is one ridge for the whole house, so anything the roof could answer
 * has already been answered and this only reaches what is left.
 *
 * NEVER overwrites a facing, whoever set it — same rule `applyPlanes` follows,
 * and for the same reason: this exists to fill silence.
 *
 * PITCH IS NOT TOUCHED. An outline says which way a roof falls, not how
 * steeply, and there is no honest way to read one from the other — a 4/12 and
 * a 9/12 house have the same footprint. An array left with no tilt still has
 * no plane to price, which is the true state of it.
 *
 * `facingSource: "footprint"` and not `"roof"`, so the proposal can say the
 * figure was estimated from the building outline rather than measured off it.
 */
export function applyFootprintFacing(
  blocks: LayoutBlock[],
  reading: RidgeReading | null
): FootprintFill {
  if (!reading) return { blocks, filled: 0 };

  let filled = 0;
  const next = blocks.map((b) => {
    if (b.azimuthDeg != null) return b;
    // An empty block is a leftover rectangle, not an array. Filling it would
    // count toward "3 arrays took their facing from the outline" and send a rep
    // looking for one that is not on the roof.
    if (blockPanelCount(b) === 0) return b;
    filled++;
    return { ...b, azimuthDeg: reading.facingDeg, facingSource: "footprint" as const };
  });

  return { blocks: next, filled };
}
