import { describe, it, expect, vi } from "vitest";
import {
  suggestAddresses,
  parseNominatimSuggestions,
  forClient,
  DEGRADED_PUBLIC,
  MIN_QUERY,
} from "../suggest";
import type { PlacePrediction } from "../places";
import type { GeocodeCandidate } from "../geocode-suggest";

const PREDICTION: PlacePrediction = {
  placeId: "ChIJ_shoreline_404",
  primary: "404 Shoreline Street",
  secondary: "Plano, TX, USA",
  label: "404 Shoreline Street, Plano, TX, USA",
};

/** A Nominatim hit for the same street — note it has no house number, which is
 *  the whole reason Places is preferred. */
const NOMINATIM_HIT = [
  {
    lat: "33.0198",
    lon: "-96.6989",
    display_name: "Shoreline Street, Plano, Collin County, Texas, 75075, United States",
    address: {
      road: "Shoreline Street",
      city: "Plano",
      county: "Collin County",
      state: "Texas",
      postcode: "75075",
      "ISO3166-2-lvl4": "US-TX",
    },
  },
];

/** The Katy house that started all this: Google Geocoding resolves it to a
 *  rooftop, and neither Places (disabled) nor OpenStreetMap (no data) could. */
const GEOCODE_HIT: GeocodeCandidate = {
  label: "23330 Wise Walk Dr, Katy, TX 77493, USA",
  primary: "23330 Wise Walk Dr",
  secondary: "Katy, TX 77493",
  parts: {
    address: "23330 Wise Walk Dr",
    city: "Katy",
    state: "TX",
    zip: "77493",
    lat: 29.860225,
    lng: -95.7807588,
    formatted: "23330 Wise Walk Dr, Katy, TX 77493, USA",
    precision: "ROOFTOP",
  },
};

function deps(over: Partial<Parameters<typeof suggestAddresses>[2]> = {}) {
  return {
    hasPlaces: () => true,
    places: vi.fn(async () => ({ predictions: [PREDICTION], failure: null })),
    geocode: vi.fn(async () => ({ candidates: [] as GeocodeCandidate[], failure: null })),
    nominatim: vi.fn(async () => parseNominatimSuggestions(NOMINATIM_HIT)),
    ...over,
  };
}

describe("suggestAddresses", () => {
  it("prefers Places, and hands back predictions to resolve on pick", async () => {
    const d = deps();
    const out = await suggestAddresses("404 Shoreline", "sess-1", d);

    expect(out.source).toBe("google");
    expect(out.results).toEqual([
      {
        label: "404 Shoreline Street, Plano, TX, USA",
        primary: "404 Shoreline Street",
        secondary: "Plano, TX, USA",
        placeId: "ChIJ_shoreline_404",
        parts: null,
      },
    ]);
    expect(d.nominatim).not.toHaveBeenCalled();
  });

  it("falls back to Nominatim when Places returns nothing", async () => {
    const d = deps({ places: vi.fn(async () => ({ predictions: [], failure: null })) });
    const out = await suggestAddresses("404 Shoreline", "sess-1", d);

    expect(out.source).toBe("nominatim");
    expect(out.results[0].placeId).toBeNull();
    // The fallback already knows the coordinates, so picking costs no request.
    expect(out.results[0].parts).toMatchObject({ city: "Plano", state: "TX", zip: "75075" });
  });

  it("does not call Places at all when no key is configured", async () => {
    const d = deps({ hasPlaces: () => false });
    const out = await suggestAddresses("404 Shoreline", "sess-1", d);

    expect(d.places).not.toHaveBeenCalled();
    expect(out.source).toBe("nominatim");
  });

  it("reports 'none' when neither geocoder matched", async () => {
    const d = deps({
      places: vi.fn(async () => ({ predictions: [], failure: null })),
      nominatim: vi.fn(async () => []),
    });
    const out = await suggestAddresses("zzzzzz", "sess-1", d);

    expect(out.source).toBe("none");
    expect(out.results).toEqual([]);
    // Everyone answered; nobody knew it. That is a fact about the address, and
    // "No matching address." is the honest thing to render.
    expect(out.degraded).toBeNull();
  });

  it("spends nothing on a query too short to mean anything", async () => {
    const d = deps();
    const out = await suggestAddresses("40", "sess-1", d);

    expect(out.results).toEqual([]);
    expect(d.places).not.toHaveBeenCalled();
    expect(d.geocode).not.toHaveBeenCalled();
    expect(d.nominatim).not.toHaveBeenCalled();
    expect("40".length).toBeLessThan(MIN_QUERY);
  });

  // The 2026-08-24 regression, in one test. Places API (New) was never enabled
  // on the Google Cloud project, so tier 1 answered 403 on every keystroke, and
  // OpenStreetMap has nothing on a new-build street in Katy. Before the middle
  // tier existed this combination rendered "No matching address." over a real
  // house that Google could describe down to the roof.
  it("resolves the house from Geocoding when Places is disabled and OSM is blind", async () => {
    const d = deps({
      places: vi.fn(async () => ({
        predictions: [],
        failure: "key rejected — is the Places API (New) enabled?",
      })),
      geocode: vi.fn(async () => ({ candidates: [GEOCODE_HIT], failure: null })),
      nominatim: vi.fn(async () => []),
    });
    const out = await suggestAddresses("23330 wise walk drive katy tx", "sess-1", d);

    expect(out.source).toBe("google_geocode");
    expect(out.results[0].primary).toBe("23330 Wise Walk Dr");
    // Arrives complete, like a Nominatim hit — picking it costs no second call.
    expect(out.results[0].placeId).toBeNull();
    expect(out.results[0].parts).toMatchObject({ city: "Katy", zip: "77493", precision: "ROOFTOP" });
    // The rep got their house; the admin still gets told tier 1 is down.
    expect(out.degraded).toMatch(/Places API \(New\)/);
    expect(d.nominatim).not.toHaveBeenCalled();
  });

  it("never consults Geocoding when Places already answered", async () => {
    const d = deps();
    const out = await suggestAddresses("404 Shoreline", "sess-1", d);

    expect(out.source).toBe("google");
    expect(d.geocode).not.toHaveBeenCalled();
  });

  it("says a provider was unreachable rather than blaming the address", async () => {
    const d = deps({
      places: vi.fn(async () => ({ predictions: [], failure: "quota or billing limit reached" })),
      geocode: vi.fn(async () => ({ candidates: [], failure: "quota or billing limit reached" })),
      nominatim: vi.fn(async () => []),
    });
    const out = await suggestAddresses("23330 wise walk drive katy tx", "sess-1", d);

    expect(out.source).toBe("none");
    expect(out.degraded).toBe(
      "Places: quota or billing limit reached; Geocoding: quota or billing limit reached"
    );
  });

  it("treats a thrown Geocoding call as a fallback reason, not a dead field", async () => {
    const d = deps({
      places: vi.fn(async () => ({ predictions: [], failure: null })),
      geocode: vi.fn(async () => {
        throw new Error("network");
      }),
    });
    const out = await suggestAddresses("404 Shoreline", "sess-1", d);

    expect(out.source).toBe("nominatim");
    expect(out.degraded).toMatch(/Geocoding: request failed/);
  });

  it("survives Places throwing, rather than failing the field", async () => {
    const d = deps({
      places: vi.fn(async () => {
        throw new Error("network");
      }),
    });
    const out = await suggestAddresses("404 Shoreline", "sess-1", d);
    expect(out.source).toBe("nominatim");
    expect(out.degraded).toMatch(/Places: request failed/);
  });
});

describe("parseNominatimSuggestions", () => {
  it("turns a hit into the same shape a Places prediction uses", () => {
    expect(parseNominatimSuggestions(NOMINATIM_HIT)).toEqual([
      {
        label: "Shoreline Street, Plano, Collin County, Texas, 75075, United States",
        primary: "Shoreline Street",
        secondary: "Plano, TX 75075",
        placeId: null,
        parts: {
          address: "Shoreline Street",
          city: "Plano",
          state: "TX",
          zip: "75075",
          lat: 33.0198,
          lng: -96.6989,
          formatted: "Shoreline Street, Plano, Collin County, Texas, 75075, United States",
          // Never ROOFTOP: this is the interpolating geocoder that put a deal's
          // aerial view three houses off its own address.
          precision: "APPROXIMATE",
        },
      },
    ]);
  });

  it("keeps the house number when OSM happens to have one", () => {
    const withNumber = [
      { ...NOMINATIM_HIT[0], address: { ...NOMINATIM_HIT[0].address, house_number: "404" } },
    ];
    expect(parseNominatimSuggestions(withNumber)[0].parts!.address).toBe("404 Shoreline Street");
  });

  it("maps a spelled-out state when the ISO tag is missing", () => {
    const noIso = [
      {
        ...NOMINATIM_HIT[0],
        address: { ...NOMINATIM_HIT[0].address, "ISO3166-2-lvl4": undefined },
      },
    ];
    expect(parseNominatimSuggestions(noIso)[0].parts!.state).toBe("TX");
  });

  it("falls back through town / village / hamlet for the city", () => {
    const town = [
      {
        ...NOMINATIM_HIT[0],
        address: { ...NOMINATIM_HIT[0].address, city: undefined, town: "Prosper" },
      },
    ];
    expect(parseNominatimSuggestions(town)[0].parts!.city).toBe("Prosper");
  });

  it("drops hits with unusable coordinates, and handles junk", () => {
    expect(parseNominatimSuggestions([{ lat: "x", lon: "y", display_name: "nope" }])).toEqual([]);
    expect(parseNominatimSuggestions(null)).toEqual([]);
    expect(parseNominatimSuggestions({})).toEqual([]);
  });
});

describe("forClient", () => {
  it("keeps Google's console URL and project id off the wire", () => {
    const raw = {
      results: [],
      source: "none" as const,
      degraded:
        "Places: key rejected — is the Places API (New) enabled? Places API (New) has not been used in project 1048785747692 before or it is disabled.",
    };
    // The browser learns that the lookup failed, which is all the dropdown needs
    // to stop blaming the customer's house. Everything else stays server-side,
    // in the log and in the admin health check.
    expect(forClient(raw).degraded).toBe(DEGRADED_PUBLIC);
    expect(JSON.stringify(forClient(raw))).not.toMatch(/1048785747692|console\./);
  });

  it("leaves a healthy result exactly as it was", () => {
    const ok = { results: [], source: "none" as const, degraded: null };
    expect(forClient(ok)).toEqual(ok);
  });
});
