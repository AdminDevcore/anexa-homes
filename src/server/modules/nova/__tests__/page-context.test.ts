import { describe, it, expect } from "vitest";
import { dealIdFromPath } from "../page-context";

const ID = "3f2c9a1e-8b7d-4c6e-9f00-1a2b3c4d5e6f";

describe("dealIdFromPath — which deal the user is looking at", () => {
  it("reads the deal page", () => {
    expect(dealIdFromPath(`/portal/leads/${ID}`)).toBe(ID);
  });
  it("reads pages under the deal", () => {
    expect(dealIdFromPath(`/portal/leads/${ID}/solar-proposal/design`)).toBe(ID);
  });
  it("ignores anything that is not a deal id", () => {
    expect(dealIdFromPath("/portal/leads/new")).toBeNull();
    expect(dealIdFromPath("/portal/pipeline")).toBeNull();
    expect(dealIdFromPath(`/portal/team/${ID}`)).toBeNull();
    expect(dealIdFromPath(null)).toBeNull();
    expect(dealIdFromPath(`/portal/leads/${ID}x`)).toBeNull();
  });
});
