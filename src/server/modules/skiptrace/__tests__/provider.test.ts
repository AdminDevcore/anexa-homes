import { describe, it, expect } from "vitest";
import { parseBatchData } from "../provider";

describe("parseBatchData", () => {
  it("maps a typical BatchData skip-trace response to names/phones/emails", () => {
    const payload = {
      results: {
        persons: [
          {
            name: { first: "John", last: "Doe", full: "John Doe" },
            phoneNumbers: [
              { number: "(214) 555-0100", type: "Wireless" },
              { number: "(214) 555-0199", type: "Landline" },
            ],
            emails: [{ email: "john.doe@example.com" }, { email: "jdoe@work.com" }],
          },
          {
            name: { first: "Mary", last: "Doe", full: "Mary Doe" },
            phoneNumbers: [{ number: "(214) 555-0100" }], // dup phone across persons
            emails: [{ email: "mary.doe@example.com" }],
          },
        ],
      },
    };
    const r = parseBatchData(payload);
    expect(r).not.toBeNull();
    expect(r!.source).toBe("BatchData");
    expect(r!.names).toEqual(["John Doe", "Mary Doe"]);
    // phone de-duplicated across persons
    expect(r!.phones).toEqual(["(214) 555-0100", "(214) 555-0199"]);
    expect(r!.emails).toEqual(["john.doe@example.com", "jdoe@work.com", "mary.doe@example.com"]);
  });

  it("returns null when there are no persons / no contact data", () => {
    expect(parseBatchData({ results: { persons: [] } })).toBeNull();
    expect(parseBatchData({})).toBeNull();
    expect(parseBatchData({ results: { persons: [{ name: {} }] } })).toBeNull();
  });

  it("tolerates string-form phones/emails and missing name fields", () => {
    const r = parseBatchData({
      results: { persons: [{ fullName: "A Owner", phones: ["555-1212"], emails: ["a@b.com"] }] },
    });
    expect(r!.names).toEqual(["A Owner"]);
    expect(r!.phones).toEqual(["555-1212"]);
    expect(r!.emails).toEqual(["a@b.com"]);
  });
});
