// Geospatial helpers for Storm Intelligence. No PostGIS — great-circle math in
// miles plus a bounding-box prefilter so the DB can do a cheap lat/lng range
// scan before the exact Haversine pass in app code.

export type LatLng = { lat: number; lng: number };

const EARTH_RADIUS_MI = 3958.8;
const MI_PER_DEG_LAT = 69;

/** Great-circle distance in miles between two coordinates (Haversine). */
export function haversineMiles(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Lat/lng bounding box around a center for a radius in miles — a cheap SQL
 *  prefilter (the box is slightly larger than the circle; filter exactly after). */
export function boundingBox(center: LatLng, radiusMiles: number) {
  const latDelta = radiusMiles / MI_PER_DEG_LAT;
  const cos = Math.cos((center.lat * Math.PI) / 180);
  const lngDelta = radiusMiles / (MI_PER_DEG_LAT * Math.max(0.01, Math.abs(cos)));
  return {
    minLat: center.lat - latDelta,
    maxLat: center.lat + latDelta,
    minLng: center.lng - lngDelta,
    maxLng: center.lng + lngDelta,
  };
}

/** Approximate a circle as a polygon ring of [lat,lng] pairs — used to spawn a
 *  canvassing Territory (which stores a polygon) from a storm zone. */
export function circlePolygon(center: LatLng, radiusMiles: number, points = 32): [number, number][] {
  const ring: [number, number][] = [];
  const cos = Math.max(0.01, Math.cos((center.lat * Math.PI) / 180));
  const latR = radiusMiles / MI_PER_DEG_LAT;
  const lngR = radiusMiles / (MI_PER_DEG_LAT * cos);
  for (let i = 0; i < points; i++) {
    const t = (i / points) * 2 * Math.PI;
    ring.push([center.lat + latR * Math.sin(t), center.lng + lngR * Math.cos(t)]);
  }
  return ring;
}

/** Dallas, TX — default storm search center. */
export const DALLAS: LatLng = { lat: 32.7767, lng: -96.797 };
export const DEFAULT_RADIUS_MILES = 100;
