import { describe, it, expect } from "vitest";
import { dealLabel } from "../deal-label";

describe("dealLabel", () => {
  it("is the customer and where the job is", () => {
    expect(dealLabel({ firstName: "Maria", lastName: "Lopez", address: "12 Elm St", city: "Dallas" })).toBe(
      "Maria Lopez · 12 Elm St, Dallas"
    );
  });

  it("leaves out what it does not know", () => {
    expect(dealLabel({ firstName: "Maria", lastName: "Lopez", address: null, city: " " })).toBe("Maria Lopez");
    expect(dealLabel({ firstName: " ", lastName: "", address: "12 Elm St", city: null })).toBe("Unnamed customer · 12 Elm St");
  });
});
