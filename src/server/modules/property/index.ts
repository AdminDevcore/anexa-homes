import { prisma } from "@/server/db/client";
import {
  getPropertyEstimate,
  getPropertyValueProvider,
  fullAddress,
  type PropertyEstimate,
  type PropertyQuery,
} from "./provider";

export type { PropertyEstimate, PropertyQuery, Confidence } from "./provider";

const CACHE_TTL_DAYS = 30;

/** Stable cache key: normalized address when known, else rounded coordinates. */
export function propertyAddressKey(q: PropertyQuery): string | null {
  const line = [q.address, q.city, q.state, q.zip].filter(Boolean).join(", ").trim().toLowerCase();
  if (line) return line.replace(/\s+/g, " ");
  if (q.lat != null && q.lng != null) return `${q.lat.toFixed(5)},${q.lng.toFixed(5)}`;
  return null;
}

// Rooftop-level reverse geocode (OSM Nominatim) so we query the AVM by a precise,
// normalized street address — matching the right parcel is the #1 accuracy factor.
async function reverseGeocode(lat: number, lng: number): Promise<PropertyQuery | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&lat=${lat}&lon=${lng}`,
      { headers: { "User-Agent": "AnexaHomesCRM/1.0 (canvassing)", "Accept-Language": "en-US" }, next: { revalidate: 86400 } }
    );
    if (!res.ok) return null;
    const d = await res.json();
    const a = d.address ?? {};
    const street = [a.house_number, a.road].filter(Boolean).join(" ");
    if (!street) return null;
    return {
      address: street,
      city: a.city || a.town || a.village || a.hamlet || a.suburb || null,
      state: a.state || null,
      zip: a.postcode || null,
      lat,
      lng,
    };
  } catch {
    return null;
  }
}

export type ResolvedValue = PropertyEstimate & { address: string | null; cached: boolean };

const EMPTY = (source: string): PropertyEstimate => ({
  value: null,
  low: null,
  high: null,
  confidence: null,
  matched: false,
  source,
  asOfDate: new Date().toISOString().slice(0, 10),
  formattedAddress: null,
  lastSalePrice: null,
  lastSaleDate: null,
  assessedValue: null,
  beds: null,
  baths: null,
  sqft: null,
  yearBuilt: null,
});

/**
 * Return a real property estimate for a location, caching per address so we
 * never re-bill the AVM API for the same house. `value: null` / `matched: false`
 * means "unavailable / unverified" — we never fabricate a number.
 */
export async function resolvePropertyValue(input: PropertyQuery): Promise<ResolvedValue | null> {
  const provider = getPropertyValueProvider();

  // Precise address first (rooftop geocode) when the provider matches by address.
  let q: PropertyQuery = input;
  if (provider.needsAddress && !fullAddress(input) && input.lat != null && input.lng != null) {
    const geo = await reverseGeocode(input.lat, input.lng);
    if (geo) q = { ...geo };
    else q = input; // fall through; provider will likely no-match → "unavailable"
  }

  const key = propertyAddressKey(q) ?? propertyAddressKey(input);
  if (!key) return null;

  const hit = await prisma.propertyValue.findUnique({ where: { addressKey: key } });
  if (hit) {
    const ageDays = (Date.now() - hit.fetchedAt.getTime()) / 86_400_000;
    if (ageDays < CACHE_TTL_DAYS && hit.data) {
      const est = hit.data as unknown as PropertyEstimate;
      return { ...est, address: hit.address, cached: true };
    }
  }

  const est = (await getPropertyEstimate(q)) ?? EMPTY(provider.name);
  const address = fullAddress(q) ?? est.formattedAddress ?? null;

  await prisma.propertyValue.upsert({
    where: { addressKey: key },
    create: {
      addressKey: key,
      address,
      value: est.value,
      source: est.source,
      confidence: est.confidence,
      matched: est.matched,
      asOfDate: new Date(est.asOfDate),
      data: est as unknown as object,
    },
    update: {
      address,
      value: est.value,
      source: est.source,
      confidence: est.confidence,
      matched: est.matched,
      asOfDate: new Date(est.asOfDate),
      data: est as unknown as object,
      fetchedAt: new Date(),
    },
  });

  return { ...est, address, cached: false };
}

/** Read a cached estimate (no provider call) for carry-through at convert time. */
export async function getCachedPropertyEstimate(q: PropertyQuery): Promise<PropertyEstimate | null> {
  const key = propertyAddressKey(q);
  if (!key) return null;
  const hit = await prisma.propertyValue.findUnique({ where: { addressKey: key } });
  return hit?.data ? (hit.data as unknown as PropertyEstimate) : null;
}
