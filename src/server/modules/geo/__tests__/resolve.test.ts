import { describe, it, expect, vi } from "vitest";
import { addressKey, addressChanged, isRooftop, resolveLeadLocation } from "../resolve";

/**
 * The real case behind every test here: 536 Greenway Drive, Saginaw, TX 76179.
 *
 * OSM has no building on that street — only the TIGER road way 10071831
 * (`tiger:reviewed=no`) — so Nominatim interpolated the house number along the
 * centreline and answered 32.8780887,-97.3838655. Google answers
 * 32.8781761,-97.3845346 with location_type ROOFTOP. Those are 63 m apart:
 * three houses. The deal page framed the wrong roof for months.
 */
const GREENWAY = { address: "536 Greenway Drive", city: "Saginaw", state: "TX", zip: "76179" };
const OSM_INTERPOLATED = { lat: 32.8780887, lng: -97.3838655, displayName: "536, Greenway Drive" };
const GOOGLE_ROOFTOP = {
  lat: 32.8781761,
  lng: -97.3845346,
  formatted: "536 Greenway Dr, Saginaw, TX 76179, USA",
  precision: "ROOFTOP",
};

describe("addressKey", () => {
  it("ignores case, padding and repeated whitespace", () => {
    expect(addressKey({ address: " 536  Greenway Drive ", city: "Saginaw", state: "TX", zip: "76179" }))
      .toBe(addressKey(GREENWAY));
  });

  it("separates the parts so a moved token is not the same house", () => {
    // Without a separator, {address:"1 Main", city:"St"} and
    // {address:"1 Main St"} would collide and skip a needed re-geocode.
    expect(addressKey({ address: "1 Main", city: "St" })).not.toBe(addressKey({ address: "1 Main St" }));
  });

  it("treats missing parts as blank rather than throwing", () => {
    expect(addressKey({})).toBe("|||");
    expect(addressKey({ address: null, city: undefined })).toBe("|||");
  });
});

describe("addressChanged", () => {
  it("is false when only the formatting differs", () => {
    expect(addressChanged(GREENWAY, { ...GREENWAY, address: "536  greenway drive " })).toBe(false);
  });

  it("is true when the house number changes", () => {
    expect(addressChanged(GREENWAY, { ...GREENWAY, address: "538 Greenway Drive" })).toBe(true);
  });

  it("is true when only the zip changes — same street name, different town", () => {
    expect(addressChanged(GREENWAY, { ...GREENWAY, zip: "76131" })).toBe(true);
  });

  it("is true when an address is cleared", () => {
    expect(addressChanged(GREENWAY, { address: null, city: null, state: null, zip: null })).toBe(true);
  });
});

describe("isRooftop", () => {
  it("accepts only an actual building", () => {
    expect(isRooftop("ROOFTOP")).toBe(true);
  });

  it("rejects a guess along the street — the 63 m error", () => {
    expect(isRooftop("RANGE_INTERPOLATED")).toBe(false);
    expect(isRooftop("GEOMETRIC_CENTER")).toBe(false);
    expect(isRooftop("APPROXIMATE")).toBe(false);
  });

  it("rejects an unknown or absent precision rather than assuming the best", () => {
    expect(isRooftop(null)).toBe(false);
    expect(isRooftop(undefined)).toBe(false);
  });
});

describe("resolveLeadLocation", () => {
  it("returns Google's rooftop answer, not OSM's interpolated one", async () => {
    const nominatim = vi.fn(async () => OSM_INTERPOLATED);
    const got = await resolveLeadLocation(GREENWAY, {
      hasGoogle: () => true,
      google: async () => GOOGLE_ROOFTOP,
      nominatim,
    });

    expect(got).toEqual({
      lat: 32.8781761,
      lng: -97.3845346,
      precision: "ROOFTOP",
      source: "google",
    });
    // The regression: OSM must not even be consulted once Google has answered.
    expect(nominatim).not.toHaveBeenCalled();
  });

  it("falls back to OSM when no Google key is configured", async () => {
    const google = vi.fn(async () => GOOGLE_ROOFTOP);
    const got = await resolveLeadLocation(GREENWAY, {
      hasGoogle: () => false,
      google,
      nominatim: async () => OSM_INTERPOLATED,
    });

    expect(got).toEqual({
      lat: 32.8780887,
      lng: -97.3838655,
      precision: null,
      source: "nominatim",
    });
    expect(google).not.toHaveBeenCalled();
  });

  it("falls back to OSM when Google has a key but cannot match the address", async () => {
    const got = await resolveLeadLocation(GREENWAY, {
      hasGoogle: () => true,
      google: async () => null,
      nominatim: async () => OSM_INTERPOLATED,
    });
    expect(got?.source).toBe("nominatim");
  });

  it("returns null when nothing can place the address", async () => {
    const got = await resolveLeadLocation(GREENWAY, {
      hasGoogle: () => true,
      google: async () => null,
      nominatim: async () => null,
    });
    expect(got).toBeNull();
  });

  it("keeps a non-rooftop Google answer rather than downgrading to OSM", async () => {
    // A brand-new subdivision Google can only interpolate is still a better
    // guess than OSM's, and the marker admits the uncertainty.
    const got = await resolveLeadLocation(GREENWAY, {
      hasGoogle: () => true,
      google: async () => ({ ...GOOGLE_ROOFTOP, precision: "RANGE_INTERPOLATED" }),
      nominatim: async () => OSM_INTERPOLATED,
    });
    expect(got?.source).toBe("google");
    expect(isRooftop(got?.precision)).toBe(false);
  });
});
