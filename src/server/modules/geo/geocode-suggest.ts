import {
  addressPartsFromComponents,
  hasStreetNumber,
  type Component,
  type PlaceScope,
  type ResolvedAddress,
} from "./places";

/**
 * Address suggestions from the Google **Geocoding** API — the middle tier.
 *
 * The bug this exists for: on 2026-08-24 a rep typed "23330 wise walk drive
 * katy tx" into New Appointment and the dropdown said "No matching address."
 * The house is real, and Google knew it. What had happened is that Places API
 * (New) was never enabled on the project, so every autocomplete call came back
 * 403 PERMISSION_DENIED; `suggestAddresses` did the right thing and fell
 * through to Nominatim; and Nominatim has nothing at all for that street —
 * Katy 77493 is new construction and OpenStreetMap has neither the buildings
 * nor, in this case, the road. Two providers, both blind, one message that read
 * as "your customer's house does not exist".
 *
 * The fix is not only to enable Places. It is that a single console checkbox
 * should never have been able to take the address field down, when a *second*
 * Google API — already enabled, already billed, already trusted by `resolve.ts`
 * for rooftop coordinates — answers the same question correctly:
 *
 *     GET /maps/api/geocode/json?address=23330+wise+walk
 *       → ROOFTOP, 23330 Wise Walk Dr, Katy, TX 77493
 *
 * Geocoding is not an autocomplete and does not pretend to be. It usually
 * returns one result and it wants a fairly complete line. That is exactly right
 * for a fallback: it only runs when Places produced nothing, and one correct
 * suggestion beats an empty dropdown every time.
 *
 * What it must NOT do is lie about precision. `resolve.ts` documents at length
 * why a road match wearing a ROOFTOP label is dangerous — `isRooftop()` gates
 * whether a stored pin may be overwritten. So precision here is Google's own
 * `location_type`, copied verbatim, never inferred from the result's `types`
 * the way the Places-details path has to.
 */

const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

/** A suggestion from this tier. Arrives complete, like a Nominatim hit — the
 *  coordinates come back with the match, so picking one costs no second call. */
export type GeocodeCandidate = {
  label: string;
  primary: string;
  secondary: string;
  parts: ResolvedAddress;
};

export type GeocodeSuggestResult = {
  candidates: GeocodeCandidate[];
  /** null = the call worked. A string = why it did not. */
  failure: string | null;
};

/** Google Geocoding's component shape, which spells everything differently from
 *  Places' — the only reason an adapter exists rather than a second parser. */
type GeocodeComponent = { long_name?: string; short_name?: string; types?: string[] };

type GeocodeResult = {
  formatted_address?: string;
  address_components?: GeocodeComponent[];
  geometry?: { location?: { lat?: number; lng?: number }; location_type?: string };
  types?: string[];
};

/** `{long_name, short_name}` → `{longText, shortText}`, so one mapping serves
 *  both Google address APIs. */
function toPlacesComponents(list: GeocodeComponent[]): Component[] {
  return list.map((c) => ({ longText: c.long_name, shortText: c.short_name, types: c.types }));
}

/**
 * Precision tiers this tier will offer for a house-level field.
 *
 * RANGE_INTERPOLATED is included deliberately and is still labelled as itself:
 * on new construction it is often the best Google has, it is a far better
 * starting point than a blank field, and because the label survives, the
 * rooftop cron can still come back and improve the pin later. Excluding it
 * would recreate the empty dropdown for exactly the newest subdivisions —
 * the ones a solar rep is most likely to be standing in.
 */
const HOUSE_PRECISION = new Set(["ROOFTOP", "RANGE_INTERPOLATED"]);

/** Component types that make a `broad` result worth offering. Without this a
 *  half-typed query resolves to the bare "United States" centroid, which is a
 *  row that looks like an answer and is not one. */
const BROAD_TYPES = ["route", "locality", "postal_code", "administrative_area_level_1"];

/**
 * Parse a Geocoding response into suggestions.
 *
 * Pure, so the filtering — the part that decides whether a rep is shown a house
 * or the middle of Texas — is testable without stubbing fetch. Google answers
 * HTTP 200 for ZERO_RESULTS and for REQUEST_DENIED alike, so `status` is the
 * only real signal, exactly as `parseGoogleGeocode` warns.
 */
export function parseGeocodeSuggestions(
  data: unknown,
  scope: PlaceScope = "address"
): GeocodeCandidate[] {
  if (!data || typeof data !== "object") return [];
  const d = data as { status?: string; results?: GeocodeResult[] };
  if (d.status !== "OK") return [];

  return (d.results ?? [])
    .map((r): GeocodeCandidate | null => {
      const lat = r.geometry?.location?.lat;
      const lng = r.geometry?.location?.lng;
      if (typeof lat !== "number" || typeof lng !== "number") return null;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

      const components = toPlacesComponents(r.address_components ?? []);
      const precision = r.geometry?.location_type ?? "APPROXIMATE";

      // A house field gets houses. Anything vaguer than that is the "United
      // States" row, and offering it is worse than offering nothing.
      if (scope === "address") {
        if (!hasStreetNumber(components)) return null;
        if (!HOUSE_PRECISION.has(precision)) return null;
      } else if (!BROAD_TYPES.some((t) => components.some((c) => (c.types ?? []).includes(t)))) {
        return null;
      }

      const fields = addressPartsFromComponents(components);
      const formatted = r.formatted_address ?? "";
      const primary = fields.address || formatted.split(",")[0]?.trim() || "";
      if (!primary) return null;

      return {
        label: formatted || primary,
        primary,
        secondary: [fields.city, [fields.state, fields.zip].filter(Boolean).join(" ")]
          .filter(Boolean)
          .join(", "),
        parts: {
          ...fields,
          lat,
          lng,
          formatted,
          // Google's own word for it. Never upgraded, never guessed.
          precision,
        },
      };
    })
    .filter((c): c is GeocodeCandidate => c !== null);
}

/** Why a Geocoding call produced nothing, for logs and the health check.
 *  ZERO_RESULTS is not a failure — it is the honest answer "no such address". */
export function geocodeSuggestFailure(data: unknown): string | null {
  const d = data as { status?: string; error_message?: string } | null;
  const status = d?.status;
  if (status === "OK" || status === "ZERO_RESULTS") return null;
  const detail = d?.error_message ? ` — ${d.error_message}` : "";
  switch (status) {
    case "REQUEST_DENIED":
      return `key rejected — is the Geocoding API enabled?${detail}`;
    case "OVER_QUERY_LIMIT":
      return "quota or billing limit reached";
    case "INVALID_REQUEST":
      return "malformed request (empty address?)";
    default:
      return status ? `unexpected status ${status}${detail}` : "unparseable response";
  }
}

/**
 * Ask Google Geocoding for suggestions.
 *
 * Cached for an hour: the answer to "what is 23330 wise walk" does not change
 * between keystrokes, and with Places unavailable this tier absorbs every
 * lookup in the app. Google's terms allow temporary caching; an hour is well
 * inside them and turns a held-down key into one billed request.
 */
export async function googleGeocodeSuggest(
  q: string,
  scope: PlaceScope = "address",
  opts: { key?: string; signal?: AbortSignal } = {}
): Promise<GeocodeSuggestResult> {
  const key = opts.key ?? process.env.GOOGLE_MAPS_API_KEY;
  const query = q.trim();
  if (!key || !query) return { candidates: [], failure: null };

  try {
    const url =
      `${GEOCODE_URL}?address=${encodeURIComponent(query)}` +
      `&components=country:US&key=${encodeURIComponent(key)}`;
    const res = await fetch(url, { next: { revalidate: 3600 }, signal: opts.signal });
    if (!res.ok) return { candidates: [], failure: `HTTP ${res.status}` };

    const data = await res.json();
    const failure = geocodeSuggestFailure(data);
    if (failure) console.warn("[geo] geocode suggest failed:", failure);
    return { candidates: parseGeocodeSuggestions(data, scope), failure };
  } catch (err) {
    return { candidates: [], failure: `request failed — ${(err as Error)?.message ?? "unknown"}` };
  }
}
