import { describe, it, expect, vi } from "vitest";
import { suggestAddresses, parseNominatimSuggestions, MIN_QUERY } from "../suggest";
import type { PlacePrediction } from "../places";

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

function deps(over: Partial<Parameters<typeof suggestAddresses>[2]> = {}) {
  return {
    hasPlaces: () => true,
    places: vi.fn(async () => [PREDICTION]),
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
    const d = deps({ places: vi.fn(async () => []) });
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
    const d = deps({ places: vi.fn(async () => []), nominatim: vi.fn(async () => []) });
    const out = await suggestAddresses("zzzzzz", "sess-1", d);

    expect(out.source).toBe("none");
    expect(out.results).toEqual([]);
  });

  it("spends nothing on a query too short to mean anything", async () => {
    const d = deps();
    const out = await suggestAddresses("40", "sess-1", d);

    expect(out.results).toEqual([]);
    expect(d.places).not.toHaveBeenCalled();
    expect(d.nominatim).not.toHaveBeenCalled();
    expect("40".length).toBeLessThan(MIN_QUERY);
  });

  it("survives Places throwing, rather than failing the field", async () => {
    const d = deps({
      places: vi.fn(async () => {
        throw new Error("network");
      }),
    });
    const out = await suggestAddresses("404 Shoreline", "sess-1", d);
    expect(out.source).toBe("nominatim");
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
