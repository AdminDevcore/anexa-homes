/**
 * Google Places (New) — address suggestions with house numbers in them.
 *
 * The bug this exists for: typing "Shoreline Street" into the New Appointment
 * form offered four streets and no houses. The suggestions came from Nominatim,
 * and OpenStreetMap has no building on that street — only the TIGER-imported
 * road centreline — so there was no "404 Shoreline St" for it to offer. A rep
 * had to type the house number, city, state and ZIP by hand on every lead.
 *
 * That is the same data gap as the rooftop bug in `resolve.ts`, approached from
 * the other side: there Nominatim INVENTED a house number by interpolating along
 * the centreline; here it declines to invent one and hands back the street.
 * Google has the buildings, so it can offer the house.
 *
 * Places (New) is two calls by design, and the split drives the UI:
 *   autocomplete → predictions with a placeId, but NO coordinates and NO ZIP
 *   details      → the address components and the rooftop point
 * So a suggestion is cheap to list and only costs a second request when picked.
 *
 * Like `google.ts`, the key never reaches the browser: every call here is
 * server-side, sent as an `X-Goog-Api-Key` header, so the existing IP-restricted
 * key keeps working and no referrer restriction is needed.
 */

const AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";
const DETAILS_URL = "https://places.googleapis.com/v1/places";

/** One suggestion, before anyone has paid for its details. */
export type PlacePrediction = {
  placeId: string;
  /** Bold line — "404 Shoreline Street". */
  primary: string;
  /** Muted line — "Plano, TX, USA". */
  secondary: string;
  /** Both lines joined, for the fallback shape and for screen readers. */
  label: string;
};

/**
 * What one autocomplete call produced.
 *
 * `failure` is the load-bearing half. Places answers "the API is not enabled"
 * with an `error` envelope and no suggestions — byte-for-byte the same empty
 * list as "nothing matched" — so a caller that only sees `predictions` cannot
 * tell an unfindable address from an unreachable provider, and will happily
 * render "No matching address." over a live outage.
 */
export type PlacesAutocompleteResult = {
  predictions: PlacePrediction[];
  /** null = the call worked. A string = why it did not, for logs and health checks. */
  failure: string | null;
};

/** A picked address, resolved to everything the forms need. */
export type ResolvedAddress = {
  address: string;
  city: string;
  state: string;
  zip: string;
  lat: number;
  lng: number;
  formatted: string;
  /**
   * Expressed in Google Geocoding's vocabulary (ROOFTOP / APPROXIMATE) rather
   * than Places', so `isRooftop()` and the backfill's upgrade check keep working
   * against a single scale no matter which API produced the point.
   */
  precision: string;
};

/**
 * Place types whose coordinate sits on a building rather than a street or a
 * centroid. Places Details has no `location_type` field, so the type of the
 * place itself is what licenses the ROOFTOP claim — and the claim matters:
 * `isRooftop()` gates whether a stored pin may be replaced, so calling a road
 * match ROOFTOP would reintroduce the exact bug `resolve.ts` documents.
 */
const ROOFTOP_TYPES = new Set(["street_address", "premise", "subpremise"]);

/** Component types that mean "city", best first. Google picks one of several
 *  depending on how the municipality is administered. */
const CITY_TYPES = [
  "locality",
  "postal_town",
  "sublocality",
  "sublocality_level_1",
  "administrative_area_level_3",
  "neighborhood",
];

export type Component = { longText?: string; shortText?: string; types?: string[] };

function component(list: Component[], type: string): Component | undefined {
  return list.find((c) => (c.types ?? []).includes(type));
}

/**
 * Components → the four fields a form actually has.
 *
 * Exported because the Geocoding fallback in `geocode-suggest.ts` answers the
 * same question from a differently-spelled payload, and two copies of this
 * mapping is how "the city is blank on some addresses" gets shipped twice.
 */
export function addressPartsFromComponents(parts: Component[]): {
  address: string;
  city: string;
  state: string;
  zip: string;
} {
  const number = component(parts, "street_number")?.longText ?? "";
  // shortText on a route is the postal abbreviation ("Shoreline St"), which is
  // what a mailing address wants and what the rest of the app stores.
  const route = component(parts, "route")?.shortText ?? component(parts, "route")?.longText ?? "";

  let city = "";
  for (const t of CITY_TYPES) {
    const hit = component(parts, t);
    if (hit?.longText) {
      city = hit.longText;
      break;
    }
  }

  return {
    address: [number, route].filter(Boolean).join(" ").trim(),
    city,
    // Already a two-letter code — the Nominatim path needs a 51-entry name→code
    // table to get here, Places just says "TX".
    state: component(parts, "administrative_area_level_1")?.shortText ?? "",
    zip: component(parts, "postal_code")?.longText ?? "",
  };
}

/** Does this address name a specific building? A suggestion without a house
 *  number sends the rep back to typing it by hand, which is the bug the whole
 *  Places path exists to kill. */
export function hasStreetNumber(parts: Component[]): boolean {
  return !!component(parts, "street_number")?.longText;
}

/** Split a flat "1 Main St, Dallas, TX, USA" line the way structuredFormat would. */
function splitFlat(text: string): { primary: string; secondary: string } {
  const i = text.indexOf(",");
  if (i === -1) return { primary: text, secondary: "" };
  return { primary: text.slice(0, i).trim(), secondary: text.slice(i + 1).trim() };
}

/**
 * Parse an autocomplete response. Pure so the failure modes are testable:
 * Places answers with an `error` envelope rather than an HTTP-shaped signal for
 * the case that will actually bite — the API not being enabled on the key — and
 * a caller that assumes `suggestions` exists just renders an empty list forever
 * without ever saying why.
 */
export function parseAutocomplete(data: unknown): PlacePrediction[] {
  if (!data || typeof data !== "object") return [];
  const d = data as {
    suggestions?: Array<{
      placePrediction?: {
        place?: string;
        placeId?: string;
        text?: { text?: string };
        structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
      };
    }>;
  };

  return (d.suggestions ?? [])
    .map((s) => {
      const p = s.placePrediction;
      // queryPredictions ("pizza near me") have no place behind them, so there
      // is nothing to resolve on pick. Drop them rather than render a dead row.
      if (!p) return null;

      const placeId = p.placeId || (p.place ?? "").replace(/^places\//, "");
      if (!placeId) return null;

      const label = p.text?.text ?? "";
      const main = p.structuredFormat?.mainText?.text;
      const secondary = p.structuredFormat?.secondaryText?.text;
      const flat = splitFlat(label);

      return {
        placeId,
        primary: main ?? flat.primary,
        secondary: secondary ?? flat.secondary,
        label: label || [main, secondary].filter(Boolean).join(", "),
      };
    })
    .filter((p): p is PlacePrediction => p !== null);
}

/**
 * Parse a Place Details response into the four fields a form actually has.
 * Returns null rather than throwing — an unresolvable place is an ordinary
 * state that leaves the typed text alone.
 */
export function parsePlaceDetails(data: unknown): ResolvedAddress | null {
  if (!data || typeof data !== "object") return null;
  const d = data as {
    formattedAddress?: string;
    location?: { latitude?: unknown; longitude?: unknown };
    types?: string[];
    addressComponents?: Component[];
  };

  const lat = d.location?.latitude;
  const lng = d.location?.longitude;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const parts = d.addressComponents ?? [];
  const types = d.types ?? [];
  return {
    ...addressPartsFromComponents(parts),
    lat,
    lng,
    formatted: d.formattedAddress ?? "",
    precision: types.some((t) => ROOFTOP_TYPES.has(t)) ? "ROOFTOP" : "APPROXIMATE",
  };
}

/** Human-readable reason a Places call failed, for the server log (never the UI). */
export function placesStatusReason(data: unknown): string {
  const err = (data as { error?: { status?: string; message?: string } } | null)?.error;
  switch (err?.status) {
    case "PERMISSION_DENIED":
      return `key rejected — is the Places API (New) enabled? ${err.message ?? ""}`.trim();
    case "RESOURCE_EXHAUSTED":
      return "quota or billing limit reached";
    case "INVALID_ARGUMENT":
      return `malformed request — ${err.message ?? "check the field mask"}`;
    default:
      return err?.status ? `unexpected status ${err.status}` : "unparseable response";
  }
}

/**
 * What kind of place a field is asking for.
 *
 * `address` is the default and the point of the exercise — house-number-level
 * results only. `broad` exists for the handful of fields that legitimately want
 * a city or a ZIP (the storm coverage centre says "address, city, or ZIP" on the
 * label); restricting those to houses would make them worse, not better.
 */
export type PlaceScope = "address" | "broad";

/** The autocomplete request body. Pure, so the type restriction is testable
 *  without stubbing fetch — it is the single option this whole change turns on. */
export function autocompleteBody(input: string, sessionToken: string, scope: PlaceScope = "address") {
  return {
    input,
    sessionToken,
    includedRegionCodes: ["us"],
    includedPrimaryTypes: [scope === "broad" ? "geocode" : "address"],
    languageCode: "en",
  };
}

/** Is a key configured at all? Drives Places-vs-Nominatim routing. */
export function placesConfigured(
  key: string | undefined = process.env.GOOGLE_MAPS_API_KEY
): boolean {
  return !!key && key.trim().length > 0;
}

/**
 * Suggest addresses for a partial input.
 *
 * `includedPrimaryTypes: ["address"]` is the load-bearing option: it restricts
 * results to house-number-level places, which is the entire point of the change.
 * Without it Google will happily suggest businesses, streets and cities, and the
 * rep is back to typing the number by hand.
 *
 * `sessionToken` groups the keystrokes of one lookup into a single billable
 * autocomplete session. Omitting it bills per request, which on a 350 ms debounce
 * is several times the cost for the same address.
 */
export async function placesAutocomplete(
  input: string,
  sessionToken: string,
  opts: { key?: string; signal?: AbortSignal; scope?: PlaceScope } = {}
): Promise<PlacesAutocompleteResult> {
  const key = opts.key ?? process.env.GOOGLE_MAPS_API_KEY;
  if (!key || !input.trim()) return { predictions: [], failure: null };

  try {
    const res = await fetch(AUTOCOMPLETE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key },
      body: JSON.stringify(autocompleteBody(input, sessionToken, opts.scope)),
      cache: "no-store",
      signal: opts.signal,
    });
    const data = await res.json();
    const predictions = parseAutocomplete(data);
    // An empty list is ordinary (nothing matched "zzz"); an error envelope is
    // not, and is the difference between "no such address" and "you never
    // enabled the API". That difference used to live only in this log line,
    // which is how the API sat disabled for sixteen days while the dropdown
    // told reps their customer's house did not exist.
    if (predictions.length === 0 && data && typeof data === "object" && "error" in data) {
      const failure = placesStatusReason(data);
      console.warn("[geo] places autocomplete failed:", failure);
      return { predictions, failure };
    }
    return { predictions, failure: null };
  } catch (err) {
    return { predictions: [], failure: `request failed — ${(err as Error)?.message ?? "unknown"}` };
  }
}

/**
 * Resolve a prediction to address parts and a coordinate. Pass the same
 * `sessionToken` used for the autocomplete calls — that is what closes the
 * billing session; a details call with a fresh token starts and bills a new one.
 */
export async function placeDetails(
  placeId: string,
  sessionToken: string,
  opts: { key?: string } = {}
): Promise<ResolvedAddress | null> {
  const key = opts.key ?? process.env.GOOGLE_MAPS_API_KEY;
  if (!key || !placeId) return null;

  try {
    const url = `${DETAILS_URL}/${encodeURIComponent(placeId)}?sessionToken=${encodeURIComponent(sessionToken)}`;
    const res = await fetch(url, {
      headers: {
        "X-Goog-Api-Key": key,
        // Field masks are mandatory on Places (New) and are what you are billed
        // against — asking for the whole place would move this call to a pricier
        // SKU for data no form here uses.
        "X-Goog-FieldMask": "id,formattedAddress,addressComponents,location,types",
      },
      cache: "no-store",
    });
    const data = await res.json();
    const parsed = parsePlaceDetails(data);
    if (!parsed) console.warn("[geo] places details failed:", placesStatusReason(data));
    return parsed;
  } catch {
    return null;
  }
}
