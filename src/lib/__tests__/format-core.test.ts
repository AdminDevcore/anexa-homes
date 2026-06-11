import { describe, it, expect } from "vitest";
import { makeMoney, makeDate } from "../format-core";

describe("format-core", () => {
  it("formats cents in USD/en-US", () => {
    const money = makeMoney({ currency: "USD", locale: "en-US" });
    expect(money(123456)).toBe("$1,235"); // rounds to whole dollars (maxFractionDigits 0)
  });

  it("formats cents in EUR/de-DE", () => {
    const money = makeMoney({ currency: "EUR", locale: "de-DE" });
    // de-DE uses "." thousands sep and a trailing € — assert the pieces, not exact spacing
    const out = money(123456);
    expect(out).toContain("€");
    expect(out).toContain("235");
  });

  it("formats a date in a fixed timezone", () => {
    const date = makeDate({ locale: "en-US", timeZone: "America/Chicago" });
    expect(date("2026-06-11T12:00:00Z")).toBe("Jun 11, 2026");
  });

  it("returns an em dash for null", () => {
    const date = makeDate({ locale: "en-US", timeZone: "UTC" });
    expect(date(null)).toBe("—");
  });
});
