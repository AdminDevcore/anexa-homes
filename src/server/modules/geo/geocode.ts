// Forward geocoding via OpenStreetMap Nominatim (free, no key). Used to turn a
// lead's text address into map coordinates. Be polite: send a real User-Agent
// and keep callers throttled to ~1 req/sec (Nominatim usage policy).

export type GeoResult = { lat: number; lng: number; displayName: string };

const NOMINATIM = "https://nominatim.openstreetmap.org/search";

/** Build a single geocode query string from address parts. */
export function addressQuery(p: {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}): string {
  return [p.address, p.city, p.state, p.zip].map((s) => (s ?? "").trim()).filter(Boolean).join(", ");
}

/** Parse a Nominatim response into a coordinate (pure — unit-tested). */
export function parseNominatim(data: unknown): GeoResult | null {
  if (!Array.isArray(data) || data.length === 0) return null;
  const r = data[0] as { lat?: string; lon?: string; display_name?: string };
  const lat = Number(r.lat);
  const lng = Number(r.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, displayName: r.display_name ?? "" };
}

/** Geocode a free-text query to a coordinate, or null on miss/error. */
export async function geocode(query: string): Promise<GeoResult | null> {
  const q = query.trim();
  if (!q) return null;
  try {
    const url = `${NOMINATIM}?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "AnexaHomesCRM/1.0 (canvassing)", "Accept-Language": "en-US" },
      next: { revalidate: 86400 },
    });
    if (!res.ok) return null;
    return parseNominatim(await res.json());
  } catch {
    return null;
  }
}
