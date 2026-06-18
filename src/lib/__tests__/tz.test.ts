import { describe, it, expect } from "vitest";
import { zonedWallClockToUtc } from "../tz";

describe("zonedWallClockToUtc", () => {
  it("interprets a Central (CDT, summer = UTC-5) wall clock as the right UTC instant", () => {
    // 2:00 PM Central on Jun 18 → 19:00 UTC (was wrongly stored as 14:00Z before the fix)
    expect(zonedWallClockToUtc("2026-06-18T14:00:00", "America/Chicago").toISOString()).toBe("2026-06-18T19:00:00.000Z");
  });

  it("handles datetime-local strings without seconds", () => {
    expect(zonedWallClockToUtc("2026-06-18T14:30", "America/Chicago").toISOString()).toBe("2026-06-18T19:30:00.000Z");
  });

  it("is DST-aware (Central CST, winter = UTC-6)", () => {
    // 2:00 PM Central on Jan 18 → 20:00 UTC
    expect(zonedWallClockToUtc("2026-01-18T14:00:00", "America/Chicago").toISOString()).toBe("2026-01-18T20:00:00.000Z");
  });

  it("respects a different zone (Eastern, EDT = UTC-4)", () => {
    expect(zonedWallClockToUtc("2026-06-18T09:00:00", "America/New_York").toISOString()).toBe("2026-06-18T13:00:00.000Z");
  });
});
