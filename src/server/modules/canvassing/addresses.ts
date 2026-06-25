import { pointInPolygon, type LatLng } from "@/lib/canvassing";

export type AddressPoint = { lat: number; lng: number; address: string };

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

type OverpassEl = {
  type: string;
  lat?: number;
  lon?: number;
  center?: { lat: number; lng?: number; lon?: number };
  // Present when querying `out geom` — the way's outline vertices.
  geometry?: { lat: number; lon: number }[];
  tags?: Record<string, string>;
};

/**
 * A point that lies INSIDE a building outline. The polygon centroid is used
 * when it falls inside; for concave footprints (L-shaped townhomes) where the
 * centroid lands off-building (e.g. in the driveway), we snap to the outline
 * vertex nearest the centroid instead. Prevents "house dot in the street".
 */
function interiorPoint(ring: { lat: number; lng: number }[]): { lat: number; lng: number } {
  let area = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const f = a.lng * b.lat - b.lng * a.lat;
    area += f; cx += (a.lng + b.lng) * f; cy += (a.lat + b.lat) * f;
  }
  if (Math.abs(area) < 1e-12) {
    const n = ring.length;
    return { lat: ring.reduce((s, p) => s + p.lat, 0) / n, lng: ring.reduce((s, p) => s + p.lng, 0) / n };
  }
  area *= 0.5;
  const c = { lat: cy / (6 * area), lng: cx / (6 * area) };
  const poly: LatLng[] = ring.map((p) => [p.lat, p.lng]);
  if (pointInPolygon([c.lat, c.lng], poly)) return c;
  let best = ring[0], bestD = Infinity;
  for (const p of ring) {
    const d = (p.lat - c.lat) ** 2 + (p.lng - c.lng) ** 2;
    if (d < bestD) { bestD = d; best = p; }
  }
  return { lat: best.lat, lng: best.lng };
}

function fmtAddress(tags: Record<string, string> | undefined): string | null {
  if (!tags) return null;
  const num = tags["addr:housenumber"];
  const street = tags["addr:street"];
  if (num && street) return `${num} ${street}`;
  if (street) return street;
  return num ?? null;
}

// Non-residential building types to skip when falling back to footprints.
const SKIP_BUILDINGS = new Set([
  "garage", "garages", "carport", "shed", "roof", "hut", "cabin", "commercial",
  "industrial", "retail", "warehouse", "office", "school", "university", "college",
  "church", "cathedral", "mosque", "synagogue", "hospital", "hangar", "service",
  "construction", "parking", "fuel", "kiosk", "supermarket", "stadium",
]);

/** 5-decimal coord key (~1.1m) to dedupe near-identical points. */
export function coordKey(lat: number, lng: number): string {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}

/**
 * Fast, approximate count of addressed buildings / address points inside the
 * polygon (same OSM union as fetchAddressesInPolygon, via Overpass `out count;`
 * so it returns just a number, not geometry). Returns null if upstream fails.
 */
export async function countAddressesInPolygon(polygon: LatLng[]): Promise<number | null> {
  if (polygon.length < 3) return 0;
  const poly = polygon.map(([lat, lng]) => `${lat} ${lng}`).join(" ");
  const query = `[out:json][timeout:25];
(
  node["addr:housenumber"](poly:"${poly}");
  way["building"](poly:"${poly}");
);
out count;`;
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "AnexaHomesCRM/1.0 (canvassing)" },
        body: "data=" + encodeURIComponent(query),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as { elements?: Array<{ tags?: Record<string, string> }> };
      // Overpass `out count;` returns a single element with tags.total.
      const total = Number(data.elements?.[0]?.tags?.total ?? NaN);
      if (Number.isFinite(total)) return total;
    } catch {
      // try the next endpoint
    }
  }
  return null;
}

/**
 * Returns address points whose coordinates fall inside the polygon, sourced from
 * OpenStreetMap via the Overpass API (free, no API key — matches the OSM tiles).
 * Queries address nodes plus addressed building footprints (centroids). Capped.
 */
export async function fetchAddressesInPolygon(polygon: LatLng[], cap = 1500): Promise<AddressPoint[]> {
  if (polygon.length < 3) return [];
  // Overpass poly filter wants "lat lon lat lon ..." (space separated).
  const poly = polygon.map(([lat, lng]) => `${lat} ${lng}`).join(" ");
  // Prefer explicit address points; fall back to building footprints (much
  // better US coverage via the Microsoft footprints import) so reps still get a
  // pin per rooftop where per-house address tags are missing.
  // `out geom` returns each building's outline so we can place the dot INSIDE
  // the footprint (see interiorPoint) rather than at its bounding-box center.
  const query = `[out:json][timeout:25];
(
  node["addr:housenumber"](poly:"${poly}");
  way["building"](poly:"${poly}");
);
out geom ${cap};`;

  let data: { elements?: OverpassEl[] } | null = null;
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "AnexaHomesCRM/1.0 (canvassing)" },
        body: "data=" + encodeURIComponent(query),
      });
      if (!res.ok) continue;
      data = await res.json();
      break;
    } catch {
      // try next endpoint
    }
  }
  if (!data?.elements) return [];

  // Separate explicit addressed doors (one per unit — what canvassers knock)
  // from bare building footprints. Addressed doors win; a footprint dot is kept
  // only when no addressed door already represents that house, which removes the
  // duplicate "two dots per home" clutter.
  const seen = new Set<string>();
  const doors: AddressPoint[] = [];
  const footprints: AddressPoint[] = [];
  for (const el of data.elements) {
    const tags = el.tags;
    const building = tags?.building;
    if (building && SKIP_BUILDINGS.has(building)) continue;
    const addr = fmtAddress(tags);
    if (!addr && !building) continue;

    let lat: number | undefined;
    let lng: number | undefined;
    if (el.type === "way" && el.geometry && el.geometry.length >= 3) {
      const p = interiorPoint(el.geometry.map((g) => ({ lat: g.lat, lng: g.lon })));
      lat = p.lat; lng = p.lng;
    } else {
      lat = el.lat ?? el.center?.lat;
      lng = el.lon ?? el.center?.lon ?? el.center?.lng;
    }
    if (typeof lat !== "number" || typeof lng !== "number") continue;

    const key = coordKey(lat, lng);
    if (seen.has(key)) continue;
    seen.add(key);
    const pt = { lat, lng, address: addr ?? "Address pending" };
    if (addr && el.type === "node") doors.push(pt);
    else footprints.push(pt);
  }

  // Index addressed doors on a ~13m grid; drop any footprint dot that sits on
  // (or right next to) an addressed door — same house, keep the better-placed one.
  const CELL = 0.00012;
  const cell = (lat: number, lng: number) => `${Math.round(lat / CELL)},${Math.round(lng / CELL)}`;
  const occupied = new Set(doors.map((p) => cell(p.lat, p.lng)));
  const nearDoor = (lat: number, lng: number) => {
    const cy = Math.round(lat / CELL), cx = Math.round(lng / CELL);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (occupied.has(`${cy + dy},${cx + dx}`)) return true;
    }
    return false;
  };

  const out: AddressPoint[] = [];
  for (const p of doors) { out.push(p); if (out.length >= cap) return out; }
  for (const p of footprints) {
    if (nearDoor(p.lat, p.lng)) continue;
    out.push(p);
    if (out.length >= cap) break;
  }
  return out;
}
