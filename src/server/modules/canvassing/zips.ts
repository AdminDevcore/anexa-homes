import "server-only";

// ZIP (ZCTA) boundary overlay for the canvassing map. We fetch ZCTA polygons
// on-demand for the current viewport from the US Census TIGERweb ArcGIS service
// (free, authoritative, nationwide) and cache them briefly in-process so panning
// doesn't hammer the upstream. Coordinates are returned as [lat, lng] to match
// Leaflet + our Territory.polygon format (so a ZIP can become a territory as-is).

export type ZipFeature = {
  zcta: string;
  centroid: [number, number]; // [lat, lng]
  rings: [number, number][][]; // one outer ring per polygon, [lat, lng]
};

type Bounds = { minLat: number; minLng: number; maxLat: number; maxLng: number };

// 2020 Census ZIP Code Tabulation Areas (layer 2 of tigerWMS_Current).
const ZCTA_LAYER =
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/2/query";

// Widest viewport (in degrees) we'll fetch ZIPs for. Beyond this the request
// would return too many/huge polygons — the UI prompts the user to zoom in.
const MAX_SPAN_DEG = 1.5;
const CACHE_TTL_MS = 10 * 60 * 1000;

const cache = new Map<string, { at: number; data: ZipFeature[] }>();

function ringToLatLng(coords: number[][]): [number, number][] {
  // ArcGIS/GeoJSON is [lng, lat]; Leaflet wants [lat, lng].
  return coords.map(([lng, lat]) => [lat, lng] as [number, number]);
}

/** Thin a dense ring (keep first/last + every step-th point) to keep the overlay light. */
function thin(ring: [number, number][], max = 160): [number, number][] {
  if (ring.length <= max) return ring;
  const step = Math.ceil(ring.length / max);
  const out: [number, number][] = [];
  for (let i = 0; i < ring.length; i += step) out.push(ring[i]);
  const last = ring[ring.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

function ringCentroid(ring: [number, number][]): [number, number] {
  const n = ring.length || 1;
  const s = ring.reduce((a, p) => [a[0] + p[0], a[1] + p[1]] as [number, number], [0, 0] as [number, number]);
  return [s[0] / n, s[1] / n];
}

/** ZCTA polygons intersecting the viewport. Returns [] for too-wide views / upstream errors. */
export async function fetchZipsInBounds(b: Bounds): Promise<{ zips: ZipFeature[]; tooBig?: boolean }> {
  const span = Math.max(b.maxLat - b.minLat, b.maxLng - b.minLng);
  if (!(span > 0)) return { zips: [] };
  if (span > MAX_SPAN_DEG) return { zips: [], tooBig: true };

  const key = [b.minLat, b.minLng, b.maxLat, b.maxLng].map((n) => n.toFixed(2)).join(",");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { zips: hit.data };

  const params = new URLSearchParams({
    geometry: `${b.minLng},${b.minLat},${b.maxLng},${b.maxLat}`,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    outSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "ZCTA5,CENTLAT,CENTLON",
    returnGeometry: "true",
    geometryPrecision: "5",
    f: "geojson",
  });

  let json: { features?: Array<{ properties?: Record<string, unknown>; geometry?: { type: string; coordinates: number[][][] | number[][][][] } }> };
  try {
    const res = await fetch(`${ZCTA_LAYER}?${params.toString()}`, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) return { zips: [] };
    json = await res.json();
  } catch {
    return { zips: [] };
  }

  const zips: ZipFeature[] = [];
  for (const f of json.features ?? []) {
    const zcta = String(f.properties?.ZCTA5 ?? "").trim();
    const g = f.geometry;
    if (!zcta || !g) continue;
    const rings: [number, number][][] = [];
    if (g.type === "Polygon") {
      rings.push(thin(ringToLatLng((g.coordinates as number[][][])[0])));
    } else if (g.type === "MultiPolygon") {
      for (const poly of g.coordinates as number[][][][]) rings.push(thin(ringToLatLng(poly[0])));
    }
    if (!rings.length) continue;
    const clat = Number(f.properties?.CENTLAT);
    const clon = Number(f.properties?.CENTLON);
    const centroid: [number, number] =
      Number.isFinite(clat) && Number.isFinite(clon) ? [clat, clon] : ringCentroid(rings[0]);
    zips.push({ zcta, centroid, rings });
  }

  cache.set(key, { at: Date.now(), data: zips });
  return { zips };
}
