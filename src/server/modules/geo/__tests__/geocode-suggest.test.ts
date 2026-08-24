import { describe, it, expect } from "vitest";
import { parseGeocodeSuggestions, geocodeSuggestFailure } from "../geocode-suggest";

/**
 * The real Google Geocoding answer for the address that broke on 2026-08-24.
 * Trimmed to the fields the parser reads.
 */
const KATY = {
  status: "OK",
  results: [
    {
      formatted_address: "23330 Wise Walk Dr, Katy, TX 77493, USA",
      address_components: [
        { long_name: "23330", short_name: "23330", types: ["street_number"] },
        { long_name: "Wise Walk Drive", short_name: "Wise Walk Dr", types: ["route"] },
        { long_name: "Katy", short_name: "Katy", types: ["locality", "political"] },
        { long_name: "Texas", short_name: "TX", types: ["administrative_area_level_1", "political"] },
        { long_name: "77493", short_name: "77493", types: ["postal_code"] },
      ],
      geometry: { location: { lat: 29.860225, lng: -95.7807588 }, location_type: "ROOFTOP" },
      types: ["street_address"],
    },
  ],
};

/** What Google hands back for a query too vague to be a house — a row that
 *  looks like an answer and is not one. */
const COUNTRY_ONLY = {
  status: "OK",
  results: [
    {
      formatted_address: "United States",
      address_components: [
        { long_name: "United States", short_name: "US", types: ["country", "political"] },
      ],
      geometry: { location: { lat: 37.09024, lng: -95.712891 }, location_type: "APPROXIMATE" },
      types: ["country"],
    },
  ],
};

/** The street itself, with no house on it. */
const STREET_ONLY = {
  status: "OK",
  results: [
    {
      formatted_address: "Wise Walk Dr, Texas 77493, USA",
      address_components: [
        { long_name: "Wise Walk Drive", short_name: "Wise Walk Dr", types: ["route"] },
        { long_name: "Texas", short_name: "TX", types: ["administrative_area_level_1", "political"] },
        { long_name: "77493", short_name: "77493", types: ["postal_code"] },
      ],
      geometry: { location: { lat: 29.8601, lng: -95.7808 }, location_type: "GEOMETRIC_CENTER" },
      types: ["route"],
    },
  ],
};

describe("parseGeocodeSuggestions", () => {
  it("offers the house that Places and OpenStreetMap both missed", () => {
    expect(parseGeocodeSuggestions(KATY, "address")).toEqual([
      {
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
      },
    ]);
  });

  it("reports Google's own precision instead of inferring one", () => {
    // A road match wearing a ROOFTOP label is the bug `resolve.ts` documents at
    // length: `isRooftop()` gates whether a stored pin may be overwritten, so an
    // invented ROOFTOP would let an interpolated point evict a real one.
    const interpolated = {
      ...KATY,
      results: [
        {
          ...KATY.results[0],
          geometry: { ...KATY.results[0].geometry, location_type: "RANGE_INTERPOLATED" },
        },
      ],
    };
    const out = parseGeocodeSuggestions(interpolated, "address");
    // Still offered — on new construction it is often the best Google has, and a
    // labelled approximation beats an empty dropdown.
    expect(out).toHaveLength(1);
    expect(out[0].parts.precision).toBe("RANGE_INTERPOLATED");
  });

  it("refuses to offer a country centroid to a house field", () => {
    expect(parseGeocodeSuggestions(COUNTRY_ONLY, "address")).toEqual([]);
  });

  it("refuses a street with no house number on it", () => {
    expect(parseGeocodeSuggestions(STREET_ONLY, "address")).toEqual([]);
  });

  it("allows a street or a ZIP when the field asked for one", () => {
    const out = parseGeocodeSuggestions(STREET_ONLY, "broad");
    expect(out).toHaveLength(1);
    expect(out[0].primary).toBe("Wise Walk Dr");
    // …but still not the bare country row, which answers nothing at any scope.
    expect(parseGeocodeSuggestions(COUNTRY_ONLY, "broad")).toEqual([]);
  });

  it("trusts `status`, not the HTTP code", () => {
    // Google answers 200 for these. Treating 200 as success is the classic way
    // to ship a silently broken integration.
    expect(parseGeocodeSuggestions({ status: "ZERO_RESULTS", results: [] })).toEqual([]);
    expect(parseGeocodeSuggestions({ status: "REQUEST_DENIED", results: KATY.results })).toEqual([]);
  });

  it("drops results with unusable coordinates, and handles junk", () => {
    const noLoc = { status: "OK", results: [{ ...KATY.results[0], geometry: {} }] };
    expect(parseGeocodeSuggestions(noLoc)).toEqual([]);
    expect(parseGeocodeSuggestions(null)).toEqual([]);
    expect(parseGeocodeSuggestions("nope")).toEqual([]);
  });
});

describe("geocodeSuggestFailure", () => {
  it("does not call an honest miss a failure", () => {
    expect(geocodeSuggestFailure({ status: "OK" })).toBeNull();
    // "No such address" is the provider working, not the provider broken — and
    // conflating the two is exactly what hid a disabled API for sixteen days.
    expect(geocodeSuggestFailure({ status: "ZERO_RESULTS" })).toBeNull();
  });

  it("names the fix when the key is the problem", () => {
    expect(geocodeSuggestFailure({ status: "REQUEST_DENIED" })).toMatch(/Geocoding API enabled/i);
    expect(geocodeSuggestFailure({ status: "OVER_QUERY_LIMIT" })).toMatch(/quota/i);
    expect(geocodeSuggestFailure({ status: "WEIRD" })).toMatch(/WEIRD/);
    expect(geocodeSuggestFailure(null)).toMatch(/unparseable/i);
  });
});
