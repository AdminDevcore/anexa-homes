// Forward geocoding via OpenStreetMap Nominatim (free, no key). Used to turn a
// lead's text address into map coordinates. Be polite: send a real User-Agent
// and keep callers throttled to ~1 req/sec (Nominatim usage policy).

export type GeoResult = { lat: number; lng: number; displayName: string };

const NOMINATIM = "https://nominatim.openstreetmap.org/search";

export type AddressParts = {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
};

/** Build a single geocode query string from address parts. */
export function addressQuery(p: AddressParts): string {
  return [p.address, p.city, p.state, p.zip].map((s) => (s ?? "").trim()).filter(Boolean).join(", ");
}

/** Strip unit/lot/apt designators that Nominatim can't match (e.g. the
 *  "lot 143" in "5551 Parker Henderson Rd lot 143"). Returns the cleaned street
 *  line, or "" if cleaning leaves nothing useful. */
export function cleanAddressLine(address?: string | null): string {
  const a = (address ?? "").trim();
  if (!a) return "";
  const cleaned = a
    // "lot 143", "apt 5b", "unit 7", "ste 100", "suite 2", "bldg 4", "# 12", "fl 3", "rm 9"
    .replace(/\b(lot|apt|apartment|unit|ste|suite|bldg|building|fl|floor|rm|room|trlr|trailer|space|spc)\.?\s*#?\s*\w+\b/gi, "")
    .replace(/#\s*\w+\b/g, "")
    .replace(/[,\s]+$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned;
}

/** Geocode from address parts with a fallback: try the full address, then retry
 *  with unit/lot designators stripped (the common cause of a clean-looking
 *  address failing to resolve). Returns the first hit, or null. */
export async function geocodeParts(p: AddressParts): Promise<GeoResult | null> {
  const full = await geocode(addressQuery(p));
  if (full) return full;
  const cleaned = cleanAddressLine(p.address);
  if (cleaned && cleaned !== (p.address ?? "").trim()) {
    // Stay within Nominatim's ~1 req/sec policy before the retry.
    await new Promise((r) => setTimeout(r, 1100));
    return geocode(addressQuery({ ...p, address: cleaned }));
  }
  return null;
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
