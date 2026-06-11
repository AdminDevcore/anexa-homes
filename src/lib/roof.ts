// Roof-measurement math. Shared by the tracer (live preview) and the server
// (authoritative recompute on save). Areas are geodesic (projected to local
// meters, not pixels); sloped area applies a pitch multiplier.

export type LatLng = [number, number]; // [lat, lng]

export type EdgeType = "eave" | "rake" | "ridge" | "hip" | "valley" | "other";

export type Facet = {
  id: string;
  name?: string; // optional custom title for this facet/array
  points: LatLng[]; // polygon corners (open ring; closing edge implied)
  pitch: string; // e.g. "6/12"
  edgeTypes: EdgeType[]; // one per segment (points.length segments, closed ring)
};

export const PITCHES = [
  "2/12", "3/12", "4/12", "5/12", "6/12", "7/12", "8/12", "9/12", "10/12", "11/12", "12/12",
];

export const EDGE_TYPES: EdgeType[] = ["eave", "rake", "ridge", "hip", "valley", "other"];

const SQM_TO_SQFT = 10.7639;
const M_TO_FT = 3.28084;
const EARTH_M_PER_DEG_LAT = 110574;

/** Pitch slope multiplier: sloped length / horizontal run = sqrt(1 + (rise/run)^2). */
export function slopeMultiplier(pitch: string): number {
  const [rise, run] = pitch.split("/").map(Number);
  if (!run) return 1;
  return Math.sqrt(1 + (rise / run) ** 2);
}

function mPerDegLng(lat: number): number {
  return 111320 * Math.cos((lat * Math.PI) / 180);
}

/** Haversine-ish distance in feet between two coords (small distances). */
export function segmentFeet(a: LatLng, b: LatLng): number {
  const lat0 = (a[0] + b[0]) / 2;
  const dx = (b[1] - a[1]) * mPerDegLng(lat0);
  const dy = (b[0] - a[0]) * EARTH_M_PER_DEG_LAT;
  return Math.sqrt(dx * dx + dy * dy) * M_TO_FT;
}

/** Planar (footprint) area of a polygon in sq ft, via local-meters projection + shoelace. */
export function footprintSqFt(points: LatLng[]): number {
  if (points.length < 3) return 0;
  const lat0 = points[0][0];
  const lng0 = points[0][1];
  const mx = mPerDegLng(lat0);
  const xy = points.map(([lat, lng]) => [(lng - lng0) * mx, (lat - lat0) * EARTH_M_PER_DEG_LAT]);
  let area2 = 0;
  for (let i = 0, j = xy.length - 1; i < xy.length; j = i++) {
    area2 += xy[j][0] * xy[i][1] - xy[i][0] * xy[j][1];
  }
  return (Math.abs(area2) / 2) * SQM_TO_SQFT;
}

export type FacetResult = {
  id: string;
  pitch: string;
  footprint: number; // sq ft
  sloped: number; // sq ft
  segments: { feet: number; type: EdgeType }[];
  perimeter: number;
};

export type RoofResult = {
  facets: FacetResult[];
  footprintArea: number;
  roofArea: number; // sloped total
  squares: number; // roofArea / 100
  facetCount: number;
  predominantPitch: string;
  perimeterFt: number;
  byEdge: Record<EdgeType, number>;
  wastePct: number;
  squaresToOrder: number;
};

export function computeRoof(facets: Facet[], wastePct = 12): RoofResult {
  const byEdge: Record<EdgeType, number> = { eave: 0, rake: 0, ridge: 0, hip: 0, valley: 0, other: 0 };
  const pitchArea: Record<string, number> = {};
  let footprintArea = 0;
  let roofArea = 0;
  let perimeterFt = 0;

  const results: FacetResult[] = facets.map((f) => {
    const fp = footprintSqFt(f.points);
    const mult = slopeMultiplier(f.pitch);
    const sloped = fp * mult;
    const segments: { feet: number; type: EdgeType }[] = [];
    for (let i = 0; i < f.points.length; i++) {
      const a = f.points[i];
      const b = f.points[(i + 1) % f.points.length];
      const feet = segmentFeet(a, b);
      const type = (f.edgeTypes[i] ?? "eave") as EdgeType;
      segments.push({ feet, type });
      byEdge[type] += feet;
      perimeterFt += feet;
    }
    footprintArea += fp;
    roofArea += sloped;
    pitchArea[f.pitch] = (pitchArea[f.pitch] ?? 0) + sloped;
    return { id: f.id, pitch: f.pitch, footprint: fp, sloped, segments, perimeter: segments.reduce((s, x) => s + x.feet, 0) };
  });

  const predominantPitch = Object.entries(pitchArea).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "6/12";
  const squares = roofArea / 100;
  const squaresToOrder = Math.ceil(squares * (1 + wastePct / 100) * 10) / 10;

  return {
    facets: results,
    footprintArea,
    roofArea,
    squares,
    facetCount: facets.length,
    predominantPitch,
    perimeterFt,
    byEdge,
    wastePct,
    squaresToOrder,
  };
}

export const ROOF_DISCLAIMER =
  "Estimate based on aerial imagery and the pitch entered. Verify measurements on site before ordering.";
