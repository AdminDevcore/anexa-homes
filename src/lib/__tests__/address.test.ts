import { describe, it, expect } from "vitest";
import { addressSearchText, addressContains } from "@/lib/address";
import { matchesAppointmentQuery } from "@/lib/appointment-filters";

const oak = { address: "1420 Oak St", city: "Plano", state: "TX", zip: "75024" };

describe("addressSearchText", () => {
  it("joins every part into one haystack", () => {
    expect(addressSearchText(oak)).toBe("1420 Oak St Plano TX 75024");
  });

  it("drops missing and blank parts instead of leaving gaps", () => {
    expect(addressSearchText({ address: "1420 Oak St", city: null, state: "  ", zip: "75024" })).toBe(
      "1420 Oak St 75024"
    );
  });

  it("is an empty string, never null, when there is no address at all", () => {
    expect(addressSearchText(null)).toBe("");
    expect(addressSearchText({})).toBe("");
  });
});

describe("addressContains", () => {
  it("matches the query case-insensitively against all four columns", () => {
    expect(addressContains("oak")).toEqual([
      { address: { contains: "oak", mode: "insensitive" } },
      { city: { contains: "oak", mode: "insensitive" } },
      { state: { contains: "oak", mode: "insensitive" } },
      { zip: { contains: "oak", mode: "insensitive" } },
    ]);
  });
});

describe("matchesAppointmentQuery", () => {
  const row = {
    name: "Jane Hayes",
    phone: "2148593329",
    email: "jane@example.com",
    address: addressSearchText(oak),
    repName: "Alex Slocum",
    sourceName: "Website",
    stage: { name: "Appointment Set" },
    outcome: null,
  };

  it("finds a deal by street, city or ZIP — not just by name", () => {
    expect(matchesAppointmentQuery(row, "oak st")).toBe(true);
    expect(matchesAppointmentQuery(row, "Plano")).toBe(true);
    expect(matchesAppointmentQuery(row, "75024")).toBe(true);
  });

  it("still matches the columns the list shows", () => {
    expect(matchesAppointmentQuery(row, "hayes")).toBe(true);
    expect(matchesAppointmentQuery(row, "slocum")).toBe(true);
    expect(matchesAppointmentQuery(row, "2148593329")).toBe(true);
  });

  it("misses what is genuinely absent, and an empty query keeps everything", () => {
    expect(matchesAppointmentQuery(row, "Frisco")).toBe(false);
    expect(matchesAppointmentQuery(row, "   ")).toBe(true);
  });

  it("does not break on a deal with no address on file", () => {
    expect(matchesAppointmentQuery({ ...row, address: null }, "oak")).toBe(false);
    expect(matchesAppointmentQuery({ ...row, address: null }, "hayes")).toBe(true);
  });
});
