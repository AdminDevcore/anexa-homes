import {
  placesAutocomplete,
  placesConfigured,
  type PlacePrediction,
  type PlaceScope,
  type ResolvedAddress,
} from "./places";

/**
 * One answer to "what addresses might this half-typed line be", for every form
 * that asks — the same role `resolve.ts` plays for "where is this house".
 *
 * Places first, Nominatim only when Places can't answer. A free coarse
 * suggestion beats an empty dropdown, but it must never outrank a paid exact
 * one: Nominatim's best offer for a TIGER-only street is the street itself,
 * which is what sent reps back to typing house numbers by hand.
 *
 * The two geocoders disagree about WHEN the coordinates are known, and the shape
 * below is that disagreement made explicit. Places gives a placeId now and the
 * details later; Nominatim gives everything at once. A suggestion therefore
 * carries either a `placeId` to resolve or the `parts` themselves, and the
 * second round-trip happens only on the Google path and only on pick.
 */

export type AddressSuggestion = {
  /** Full line, for the a11y label. */
  label: string;
  /** Bold line — "404 Shoreline Street". */
  primary: string;
  /** Muted line — "Plano, TX 75075". */
  secondary: string;
  /** Set on Places hits; resolve via `/api/geocode/place` before use. */
  placeId: string | null;
  /** Set on Nominatim hits, which arrive complete. */
  parts: ResolvedAddress | null;
};

export type SuggestSource = "google" | "nominatim" | "none";
export type SuggestResult = { results: AddressSuggestion[]; source: SuggestSource };

/** Below this, a query is too generic to be worth a billable request. */
export const MIN_QUERY = 3;

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

type NominatimAddress = {
  house_number?: string;
  road?: string;
  city?: string;
  town?: string;
  village?: string;
  hamlet?: string;
  municipality?: string;
  county?: string;
  state?: string;
  postcode?: string;
  ["ISO3166-2-lvl4"]?: string;
};

/**
 * Full state name → USPS code. Nominatim spells the state out ("Texas") and the
 * form's State field holds the code. Places needs none of this — it returns
 * "TX" directly — so this table is fallback-only.
 */
const STATE_ABBR: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", "district of columbia": "DC",
  florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL",
  indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI",
  wyoming: "WY", "puerto rico": "PR",
};

/** Prefer the ISO3166-2 tag ("US-TX"), then the spelled-out name. */
function stateCode(a: NominatimAddress): string {
  const iso = a["ISO3166-2-lvl4"];
  if (iso && /^US-[A-Z]{2}$/.test(iso)) return iso.slice(3);
  const name = (a.state ?? "").trim().toLowerCase();
  return STATE_ABBR[name] ?? (a.state ?? "");
}

function cityName(a: NominatimAddress): string {
  return a.city ?? a.town ?? a.village ?? a.hamlet ?? a.municipality ?? "";
}

/** Parse Nominatim's search response into the shared suggestion shape. */
export function parseNominatimSuggestions(data: unknown): AddressSuggestion[] {
  if (!Array.isArray(data)) return [];

  return data
    .map((d: { lat?: string; lon?: string; display_name?: string; address?: NominatimAddress }): AddressSuggestion | null => {
      const lat = Number(d.lat);
      const lng = Number(d.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

      const a = d.address ?? {};
      const label = d.display_name ?? "";
      const street = [a.house_number, a.road].filter(Boolean).join(" ").trim();
      const city = cityName(a);
      const state = stateCode(a);
      const zip = a.postcode ?? "";

      return {
        label,
        primary: street || label.split(",")[0]?.trim() || "",
        secondary: [city, [state, zip].filter(Boolean).join(" ")].filter(Boolean).join(", "),
        placeId: null,
        parts: {
          address: street || label.split(",")[0]?.trim() || "",
          city,
          state,
          zip,
          lat,
          lng,
          formatted: label,
          // Never ROOFTOP. This is the geocoder that interpolates a house number
          // along 436 m of road centreline; see the note atop `resolve.ts`.
          precision: "APPROXIMATE",
        },
      };
    })
    .filter((s): s is AddressSuggestion => s !== null && !!s.label);
}

/** Ask Nominatim for suggestions. Polite User-Agent + US scope, as elsewhere. */
async function nominatimSuggest(q: string): Promise<AddressSuggestion[]> {
  try {
    const url =
      `${NOMINATIM_URL}?format=jsonv2&addressdetails=1&countrycodes=us&limit=6` +
      `&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "AnexaHomesCRM/1.0 (lead-form)", "Accept-Language": "en-US" },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return [];
    return parseNominatimSuggestions(await res.json());
  } catch {
    return [];
  }
}

type Deps = {
  places: (input: string, sessionToken: string, scope: PlaceScope) => Promise<PlacePrediction[]>;
  nominatim: (q: string) => Promise<AddressSuggestion[]>;
  hasPlaces: () => boolean;
};

const REAL: Deps = {
  places: (input, sessionToken, scope) => placesAutocomplete(input, sessionToken, { scope }),
  nominatim: nominatimSuggest,
  hasPlaces: () => placesConfigured(),
};

/**
 * Suggest addresses for a partial line.
 *
 * Dependencies are injected so the routing is unit-testable without stubbing
 * global fetch; callers use the default. Never throws — a dropdown that fails
 * closed is a field the rep can still type into.
 */
export async function suggestAddresses(
  q: string,
  sessionToken: string,
  overrides: Partial<Deps> = {},
  scope: PlaceScope = "address"
): Promise<SuggestResult> {
  const { places, nominatim, hasPlaces } = { ...REAL, ...overrides };
  const query = q.trim();
  if (query.length < MIN_QUERY) return { results: [], source: "none" };

  if (hasPlaces()) {
    // A thrown Places call is a reason to fall back, not to fail the field —
    // the rep is mid-keystroke and an empty dropdown reads as "no such address".
    const hits = await places(query, sessionToken, scope).catch(() => [] as PlacePrediction[]);
    if (hits.length > 0) {
      return {
        source: "google",
        results: hits.map((h) => ({
          label: h.label,
          primary: h.primary,
          secondary: h.secondary,
          placeId: h.placeId,
          parts: null,
        })),
      };
    }
  }

  const osm = await nominatim(query).catch(() => [] as AddressSuggestion[]);
  return { results: osm, source: osm.length > 0 ? "nominatim" : "none" };
}
