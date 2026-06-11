import type { LatLng } from "@/lib/canvassing";

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
  tags?: Record<string, string>;
};

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
  const query = `[out:json][timeout:25];
(
  node["addr:housenumber"](poly:"${poly}");
  way["building"](poly:"${poly}");
);
out center ${cap};`;

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

  const seen = new Set<string>();
  const out: AddressPoint[] = [];
  for (const el of data.elements) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon ?? el.center?.lng;
    if (typeof lat !== "number" || typeof lng !== "number") continue;

    const tags = el.tags;
    const building = tags?.building;
    // Skip clearly non-residential footprints.
    if (building && SKIP_BUILDINGS.has(building)) continue;
    // Require either an address or a building footprint.
    const addr = fmtAddress(tags);
    if (!addr && !building) continue;

    const key = coordKey(lat, lng);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ lat, lng, address: addr ?? "Address pending" });
    if (out.length >= cap) break;
  }
  return out;
}
