import { describe, it, expect } from "vitest";
import {
  VERTICALS,
  LEGACY_VERTICALS,
  VERTICAL_LABEL,
  DEFAULT_VERTICAL,
  allowedVerticals,
  isActiveVertical,
  isVertical,
  verticalForServiceSlug,
} from "@/lib/vertical";
import { readVerticalConfig, writeVerticalConfig } from "@/lib/vertical-config";

/**
 * `others` is a retired enum value that still exists in Postgres so historical
 * rows validate. These tests are the contract that it can never come back:
 * it must not appear in the switcher, must not be selectable, and must not be
 * inherited from a stale grant list on an existing account.
 */
describe("retired verticals can never surface", () => {
  it("is not offered as a live vertical", () => {
    expect(VERTICALS).toEqual(["roofing", "solar"]);
    expect(VERTICALS).not.toContain("others");
    expect(LEGACY_VERTICALS).toContain("others");
  });

  it("is rejected as an active vertical even though the enum accepts it", () => {
    expect(isVertical("others")).toBe(true); // still a valid DB value
    expect(isActiveVertical("others")).toBe(false); // but never selectable
  });

  it("is stripped from a legacy grant list", () => {
    // Accounts created under the old default carried all three.
    expect(allowedVerticals(["roofing", "solar", "others"])).toEqual(["roofing", "solar"]);
  });

  it("falls back to roofing rather than locking a user out", () => {
    expect(allowedVerticals(["others"])).toEqual([DEFAULT_VERTICAL]);
    expect(allowedVerticals([])).toEqual([DEFAULT_VERTICAL]);
    expect(allowedVerticals(null)).toEqual([DEFAULT_VERTICAL]);
  });

  it("still has a label, so historical rows render instead of crashing", () => {
    expect(VERTICAL_LABEL.others).toMatch(/retired/i);
  });
});

describe("website enquiries route to a workspace", () => {
  it("sends solar enquiries to solar and everything else to roofing", () => {
    expect(verticalForServiceSlug("solar")).toBe("solar");
    expect(verticalForServiceSlug("roofing")).toBe("roofing");
    expect(verticalForServiceSlug("gutters")).toBe("roofing");
    expect(verticalForServiceSlug(null)).toBe("roofing");
    expect(verticalForServiceSlug(undefined)).toBe("roofing");
  });
});

describe("per-vertical config cannot bleed", () => {
  it("reads a legacy bare array as roofing's config only", () => {
    const legacy = ["Damage confirmed", "Denied"];
    expect(readVerticalConfig(legacy, "roofing")).toEqual(legacy);
    // Solar must NOT inherit roofing's list — it falls through to its own defaults.
    expect(readVerticalConfig(legacy, "solar")).toBeUndefined();
  });

  it("reads each vertical's own slice from the scoped shape", () => {
    const scoped = { roofing: ["A"], solar: ["B"] };
    expect(readVerticalConfig(scoped, "roofing")).toEqual(["A"]);
    expect(readVerticalConfig(scoped, "solar")).toEqual(["B"]);
  });

  it("writing solar leaves roofing byte-for-byte untouched", () => {
    const before = { roofing: ["Keep", "Me"], solar: ["Old"] };
    const after = writeVerticalConfig(before, "solar", ["New"]);
    expect(after.roofing).toEqual(["Keep", "Me"]);
    expect(after.solar).toEqual(["New"]);
    expect(before.solar).toEqual(["Old"]); // input not mutated
  });

  it("upgrading from the legacy shape preserves the roofing list", () => {
    const legacy = ["Roofing outcome"];
    const after = writeVerticalConfig(legacy, "solar", ["Solar outcome"]);
    expect(after).toEqual({ roofing: ["Roofing outcome"], solar: ["Solar outcome"] });
  });

  it("writing roofing does not invent a solar entry", () => {
    const after = writeVerticalConfig(undefined, "roofing", ["Only roofing"]);
    expect(after).toEqual({ roofing: ["Only roofing"] });
    expect(after.solar).toBeUndefined();
  });
});
