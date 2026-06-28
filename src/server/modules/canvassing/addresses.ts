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

  // Roof-centered placement: prefer building-footprint centroids (the dot lands
  // on the house), and use address NODES only for their precise address — snapped
  // to the building that contains them — or as a fallback dot where there's no
  // building. OSM `addr:housenumber` nodes are often dropped at the street/
  // driveway, so using them for placement put dots off the roof. Multi-unit
  // buildings (>= 2 addresses) keep per-unit door dots.
  type P = { lat: number; lng: number; addr: string | null };
  const buildings: (P & { matched: P[] })[] = [];
  const nodes: P[] = [];
  for (const el of data.elements) {
    const tags = el.tags;
    const building = tags?.building;
    if (building && SKIP_BUILDINGS.has(building)) continue;
    const addr = fmtAddress(tags);
    if (el.type === "way" && el.geometry && el.geometry.length >= 3) {
      const p = interiorPoint(el.geometry.map((g) => ({ lat: g.lat, lng: g.lon })));
      buildings.push({ lat: p.lat, lng: p.lng, addr, matched: [] });
    } else if (addr) {
      const lat = el.lat ?? el.center?.lat;
      const lng = el.lon ?? el.center?.lon ?? el.center?.lng;
      if (typeof lat === "number" && typeof lng === "number") nodes.push({ lat, lng, addr });
    }
  }

  // Grid-index building centroids; snap each address node to the nearest one
  // within ~38m so the dot sits on the roof while keeping the node's address.
  const CELL = 0.0004;
  const cellKey = (lat: number, lng: number) => `${Math.round(lat / CELL)},${Math.round(lng / CELL)}`;
  const grid = new Map<string, number[]>();
  buildings.forEach((b, i) => {
    const k = cellKey(b.lat, b.lng);
    const arr = grid.get(k);
    if (arr) arr.push(i);
    else grid.set(k, [i]);
  });
  const MAX_SNAP = 0.00035; // ~38m
  const leftover: P[] = [];
  for (const n of nodes) {
    const cy = Math.round(n.lat / CELL);
    const cx = Math.round(n.lng / CELL);
    let best = -1;
    let bestD = Infinity;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const i of grid.get(`${cy + dy},${cx + dx}`) ?? []) {
          const b = buildings[i];
          const d = (b.lat - n.lat) ** 2 + (b.lng - n.lng) ** 2;
          if (d < bestD) { bestD = d; best = i; }
        }
      }
    }
    if (best >= 0 && Math.sqrt(bestD) <= MAX_SNAP) {
      const b = buildings[best];
      b.matched.push(n);
      if (!b.addr) b.addr = n.addr;
    } else {
      leftover.push(n);
    }
  }

  const out: AddressPoint[] = [];
  const seen = new Set<string>();
  const push = (lat: number, lng: number, addr: string | null) => {
    const k = coordKey(lat, lng);
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ lat, lng, address: addr ?? "Address pending" });
  };
  for (const b of buildings) {
    if (out.length >= cap) return out;
    if (b.matched.length >= 2) {
      for (const u of b.matched) {
        if (out.length >= cap) return out;
        push(u.lat, u.lng, u.addr); // multi-unit: keep each unit's door dot
      }
    } else {
      push(b.lat, b.lng, b.addr); // single house: dot on the roof centroid
    }
  }
  for (const n of leftover) {
    if (out.length >= cap) break;
    push(n.lat, n.lng, n.addr);
  }
  return out;
}

function metersBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const lat1 = (aLat * Math.PI) / 180, lat2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Snap a single point (a stored house dot) to the centroid of the nearest OSM
 * building footprint within `maxMeters`. Used by the recenter-house-dots cron to
 * pull off-center pins onto the actual rooftop. Returns null when there's no
 * building nearby (OSM coverage gap) — caller keeps the original coordinate.
 */
export async function nearestBuildingCentroid(
  lat: number,
  lng: number,
  maxMeters = 40
): Promise<{ lat: number; lng: number } | null> {
  const radius = Math.max(40, Math.ceil(maxMeters * 1.5));
  const query = `[out:json][timeout:25];
(way["building"](around:${radius},${lat},${lng}););
out geom 60;`;

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
  if (!data?.elements) return null;

  let best: { lat: number; lng: number } | null = null;
  let bestM = Infinity;
  for (const el of data.elements) {
    const b = el.tags?.building;
    if (b && SKIP_BUILDINGS.has(b)) continue;
    if (el.type !== "way" || !el.geometry || el.geometry.length < 3) continue;
    const c = interiorPoint(el.geometry.map((g) => ({ lat: g.lat, lng: g.lon })));
    const m = metersBetween(lat, lng, c.lat, c.lng);
    if (m < bestM) { bestM = m; best = c; }
  }
  return best && bestM <= maxMeters ? best : null;
}
