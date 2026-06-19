import { describe, it, expect } from "vitest";
import { addressQuery, parseNominatim, cleanAddressLine } from "../geocode";

describe("addressQuery", () => {
  it("joins present parts, skipping blanks", () => {
    expect(addressQuery({ address: "404 Shoreline St", city: "Plano", state: "TX", zip: "75075" }))
      .toBe("404 Shoreline St, Plano, TX, 75075");
  });
  it("drops null/empty parts and trims", () => {
    expect(addressQuery({ address: " 1 Main ", city: "", state: null, zip: "75001" }))
      .toBe("1 Main, 75001");
  });
  it("returns empty when nothing present", () => {
    expect(addressQuery({})).toBe("");
  });
});

describe("cleanAddressLine", () => {
  it("strips a 'lot N' unit suffix (the real Barbara-savage case)", () => {
    expect(cleanAddressLine("5551 parker henderson rd lot 143")).toBe("5551 parker henderson rd");
  });
  it("strips apt / unit / suite / # designators", () => {
    expect(cleanAddressLine("100 Oak Ave Apt 5B")).toBe("100 Oak Ave");
    expect(cleanAddressLine("12 Elm St Unit 7")).toBe("12 Elm St");
    expect(cleanAddressLine("9 Pine Blvd Ste 200")).toBe("9 Pine Blvd");
    expect(cleanAddressLine("44 Maple Dr # 12")).toBe("44 Maple Dr");
  });
  it("leaves a clean street address unchanged", () => {
    expect(cleanAddressLine("404 Shoreline St")).toBe("404 Shoreline St");
  });
  it("handles null/empty", () => {
    expect(cleanAddressLine(null)).toBe("");
    expect(cleanAddressLine("")).toBe("");
  });
});

describe("parseNominatim", () => {
  it("parses the first result's lat/lon", () => {
    const r = parseNominatim([{ lat: "33.0198", lon: "-96.6989", display_name: "Plano, TX" }]);
    expect(r).toEqual({ lat: 33.0198, lng: -96.6989, displayName: "Plano, TX" });
  });
  it("returns null for empty / non-array", () => {
    expect(parseNominatim([])).toBeNull();
    expect(parseNominatim(null)).toBeNull();
    expect(parseNominatim({})).toBeNull();
  });
  it("returns null when coords aren't finite numbers", () => {
    expect(parseNominatim([{ lat: "abc", lon: "-96.7" }])).toBeNull();
  });
});
