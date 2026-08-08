import { describe, it, expect } from "vitest";
import {
  autocompleteBody,
  parseAutocomplete,
  parsePlaceDetails,
  placesConfigured,
  placesStatusReason,
} from "../places";

/**
 * A real-shaped Places API (New) autocomplete envelope. The house number in
 * `mainText` is the entire reason this module exists — Nominatim cannot produce
 * one for a TIGER-only street, so the lead form could only ever offer
 * "Shoreline Street".
 */
const AUTOCOMPLETE_OK = {
  suggestions: [
    {
      placePrediction: {
        place: "places/ChIJ_shoreline_404",
        placeId: "ChIJ_shoreline_404",
        text: { text: "404 Shoreline Street, Plano, TX, USA" },
        structuredFormat: {
          mainText: { text: "404 Shoreline Street" },
          secondaryText: { text: "Plano, TX, USA" },
        },
        types: ["street_address", "geocode"],
      },
    },
    {
      placePrediction: {
        place: "places/ChIJ_shoreline_408",
        placeId: "ChIJ_shoreline_408",
        text: { text: "408 Shoreline Street, Plano, TX, USA" },
        structuredFormat: {
          mainText: { text: "408 Shoreline Street" },
          secondaryText: { text: "Plano, TX, USA" },
        },
        types: ["street_address", "geocode"],
      },
    },
  ],
};

const DETAILS_OK = {
  id: "ChIJ_shoreline_404",
  formattedAddress: "404 Shoreline St, Plano, TX 75075, USA",
  location: { latitude: 33.0198, longitude: -96.6989 },
  types: ["street_address", "geocode"],
  addressComponents: [
    { longText: "404", shortText: "404", types: ["street_number"] },
    { longText: "Shoreline Street", shortText: "Shoreline St", types: ["route"] },
    { longText: "Plano", shortText: "Plano", types: ["locality", "political"] },
    { longText: "Collin County", shortText: "Collin County", types: ["administrative_area_level_2"] },
    { longText: "Texas", shortText: "TX", types: ["administrative_area_level_1", "political"] },
    { longText: "United States", shortText: "US", types: ["country", "political"] },
    { longText: "75075", shortText: "75075", types: ["postal_code"] },
  ],
};

/** What Google actually returns when Places API (New) isn't enabled on the key. */
const PERMISSION_DENIED = {
  error: {
    code: 403,
    message: "Places API (New) has not been used in project 1234 before or it is disabled.",
    status: "PERMISSION_DENIED",
  },
};

describe("autocompleteBody", () => {
  it("restricts to house-number-level places by default", () => {
    // Without this the dropdown suggests businesses and streets, and the rep is
    // back to typing the house number by hand — the bug this all exists for.
    expect(autocompleteBody("404 Shore", "sess-1").includedPrimaryTypes).toEqual(["address"]);
  });

  it("broadens to any geocodable place when asked", () => {
    // The storm coverage centre is legitimately a city or a ZIP, not a house.
    expect(autocompleteBody("Plano, TX", "sess-1", "broad").includedPrimaryTypes).toEqual(["geocode"]);
  });

  it("keeps results in the US and carries the session token", () => {
    const body = autocompleteBody("404 Shore", "sess-1");
    expect(body.includedRegionCodes).toEqual(["us"]);
    expect(body.sessionToken).toBe("sess-1");
    expect(body.input).toBe("404 Shore");
  });
});

describe("parseAutocomplete", () => {
  it("pulls the house-numbered predictions out of the envelope", () => {
    expect(parseAutocomplete(AUTOCOMPLETE_OK)).toEqual([
      {
        placeId: "ChIJ_shoreline_404",
        primary: "404 Shoreline Street",
        secondary: "Plano, TX, USA",
        label: "404 Shoreline Street, Plano, TX, USA",
      },
      {
        placeId: "ChIJ_shoreline_408",
        primary: "408 Shoreline Street",
        secondary: "Plano, TX, USA",
        label: "408 Shoreline Street, Plano, TX, USA",
      },
    ]);
  });

  it("skips queryPredictions, which carry no place to resolve", () => {
    const mixed = {
      suggestions: [
        { queryPrediction: { text: { text: "pizza near me" } } },
        AUTOCOMPLETE_OK.suggestions[0],
      ],
    };
    expect(parseAutocomplete(mixed)).toHaveLength(1);
    expect(parseAutocomplete(mixed)[0].placeId).toBe("ChIJ_shoreline_404");
  });

  it("falls back to the flat text when structuredFormat is missing", () => {
    const flat = {
      suggestions: [
        {
          placePrediction: {
            placeId: "ChIJ_flat",
            text: { text: "1 Main St, Dallas, TX, USA" },
          },
        },
      ],
    };
    expect(parseAutocomplete(flat)).toEqual([
      { placeId: "ChIJ_flat", primary: "1 Main St", secondary: "Dallas, TX, USA", label: "1 Main St, Dallas, TX, USA" },
    ]);
  });

  it("derives placeId from the resource name when the field is absent", () => {
    const named = {
      suggestions: [
        {
          placePrediction: {
            place: "places/ChIJ_from_resource",
            text: { text: "2 Oak Ave, Frisco, TX, USA" },
          },
        },
      ],
    };
    expect(parseAutocomplete(named)[0].placeId).toBe("ChIJ_from_resource");
  });

  it("returns empty for an error envelope, a blank body, or junk", () => {
    expect(parseAutocomplete(PERMISSION_DENIED)).toEqual([]);
    expect(parseAutocomplete({})).toEqual([]);
    expect(parseAutocomplete(null)).toEqual([]);
    expect(parseAutocomplete("nope")).toEqual([]);
  });
});

describe("parsePlaceDetails", () => {
  it("splits address components into the form's four fields", () => {
    const r = parsePlaceDetails(DETAILS_OK);
    expect(r).toMatchObject({
      address: "404 Shoreline St",
      city: "Plano",
      state: "TX",
      zip: "75075",
      lat: 33.0198,
      lng: -96.6989,
      formatted: "404 Shoreline St, Plano, TX 75075, USA",
    });
  });

  it("uses the two-letter state code Google already provides", () => {
    // The Nominatim path needs a 51-entry name->code map for this. Places
    // hands back shortText "TX" directly, so nothing has to be looked up.
    expect(parsePlaceDetails(DETAILS_OK)!.state).toBe("TX");
  });

  it("reports ROOFTOP for a street address, so the map may centre on it", () => {
    expect(parsePlaceDetails(DETAILS_OK)!.precision).toBe("ROOFTOP");
  });

  it("does not claim ROOFTOP for a street or a city centroid", () => {
    const route = { ...DETAILS_OK, types: ["route"] };
    expect(parsePlaceDetails(route)!.precision).toBe("APPROXIMATE");
    const city = { ...DETAILS_OK, types: ["locality", "political"] };
    expect(parsePlaceDetails(city)!.precision).toBe("APPROXIMATE");
  });

  it("treats a premise and a subpremise as rooftop too", () => {
    expect(parsePlaceDetails({ ...DETAILS_OK, types: ["premise"] })!.precision).toBe("ROOFTOP");
    expect(parsePlaceDetails({ ...DETAILS_OK, types: ["subpremise"] })!.precision).toBe("ROOFTOP");
  });

  it("falls back through the city-ish component types", () => {
    const noLocality = {
      ...DETAILS_OK,
      addressComponents: DETAILS_OK.addressComponents.map((c) =>
        c.types.includes("locality") ? { ...c, types: ["sublocality", "political"] } : c
      ),
    };
    expect(parsePlaceDetails(noLocality)!.city).toBe("Plano");
  });

  it("returns null when there is no usable coordinate", () => {
    expect(parsePlaceDetails({ ...DETAILS_OK, location: undefined })).toBeNull();
    expect(parsePlaceDetails({ ...DETAILS_OK, location: { latitude: "x", longitude: 1 } })).toBeNull();
  });

  it("returns null for an error envelope or junk", () => {
    expect(parsePlaceDetails(PERMISSION_DENIED)).toBeNull();
    expect(parsePlaceDetails(null)).toBeNull();
    expect(parsePlaceDetails({})).toBeNull();
  });

  it("survives a place with no street number (an unnumbered road match)", () => {
    const noNumber = {
      ...DETAILS_OK,
      types: ["route"],
      addressComponents: DETAILS_OK.addressComponents.filter((c) => !c.types.includes("street_number")),
    };
    expect(parsePlaceDetails(noNumber)!.address).toBe("Shoreline St");
  });
});

describe("placesConfigured", () => {
  it("is false for an unset or whitespace key", () => {
    expect(placesConfigured(undefined)).toBe(false);
    expect(placesConfigured("")).toBe(false);
    expect(placesConfigured("   ")).toBe(false);
  });
  it("is true for a real key", () => {
    expect(placesConfigured("AIza-not-a-real-key")).toBe(true);
  });
});

describe("placesStatusReason", () => {
  it("names the disabled-API case, which is the one that will actually happen", () => {
    expect(placesStatusReason(PERMISSION_DENIED)).toMatch(/Places API \(New\) enabled/i);
  });
  it("reports quota separately from permission", () => {
    expect(placesStatusReason({ error: { status: "RESOURCE_EXHAUSTED", message: "quota" } }))
      .toMatch(/quota/i);
  });
  it("falls back to the raw status, then to a generic line", () => {
    expect(placesStatusReason({ error: { status: "WEIRD" } })).toMatch(/WEIRD/);
    expect(placesStatusReason(null)).toMatch(/unparseable/i);
  });
});
