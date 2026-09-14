import { describe, it, expect } from "vitest";
import {
  NOT_SET,
  formatMoney,
  formatKw,
  formatPct,
  formatDateTime,
  phoneDigits,
  looksLikePhone,
  phoneMatches,
  zonedDayRange,
} from "../format";

describe("formatMoney — exact, never rounded", () => {
  it("drops .00 on whole dollars", () => {
    expect(formatMoney(5_080_000)).toBe("$50,800");
  });
  it("keeps the cents when there are cents", () => {
    expect(formatMoney(4_669_512)).toBe("$46,695.12");
  });
  it("says a missing figure is not set rather than $0", () => {
    expect(formatMoney(null)).toBe(NOT_SET);
    expect(formatMoney(undefined)).toBe(NOT_SET);
  });
  it("a real zero is still a zero", () => {
    expect(formatMoney(0)).toBe("$0");
  });
});

describe("system figures — the deal page's own precision", () => {
  it("kW to two decimals, like the System size tile", () => {
    expect(formatKw(11)).toBe("11.00 kW");
    expect(formatKw(10.559999)).toBe("10.56 kW");
  });
  it("an undrawn system (0 kW) is not set", () => {
    expect(formatKw(0)).toBe(NOT_SET);
    expect(formatKw(null)).toBe(NOT_SET);
  });
  it("offset as a whole percent, like the Offset tile", () => {
    expect(formatPct(104.4)).toBe("104%");
    expect(formatPct(null)).toBe(NOT_SET);
  });
});

describe("formatDateTime", () => {
  it("renders in the company's timezone with plain spaces", () => {
    // 19:00 UTC on 15 Sep 2026 is 2:00 PM in Chicago (CDT, UTC-5).
    expect(formatDateTime(new Date("2026-09-15T19:00:00Z"), "America/Chicago")).toBe(
      "Tue, Sep 15, 2026, 2:00 PM"
    );
  });
  it("null is not set", () => {
    expect(formatDateTime(null, "America/Chicago")).toBe(NOT_SET);
  });
});

describe("phones are stored in two shapes", () => {
  it("digits only", () => {
    expect(phoneDigits("(214) 555-0101")).toBe("2145550101");
    expect(phoneDigits(null)).toBe("");
  });
  it("recognises a spoken or typed number", () => {
    expect(looksLikePhone("214-555-0101")).toBe(true);
    expect(looksLikePhone("0101")).toBe(true);
    expect(looksLikePhone("Dana Whitfield")).toBe(false);
    expect(looksLikePhone("123 Main St")).toBe(false);
  });
  it("matches across formats, with or without a leading country code", () => {
    expect(phoneMatches("(214) 555-0101", "2145550101")).toBe(true);
    expect(phoneMatches("2145550101", "(214) 555-0101")).toBe(true);
    expect(phoneMatches("2145550101", "+1 214 555 0101")).toBe(true);
    expect(phoneMatches("(214) 555-0101", "555-0101")).toBe(true);
    expect(phoneMatches("(214) 555-0199", "555-0101")).toBe(false);
    expect(phoneMatches(null, "555-0101")).toBe(false);
  });
});

describe("zonedDayRange — whole days in the company's timezone", () => {
  it("covers from 00:00 on the first day to 00:00 after the last", () => {
    const r = zonedDayRange("2026-09-01", "2026-09-30", "America/Chicago");
    expect(r.start.toISOString()).toBe("2026-09-01T05:00:00.000Z");
    expect(r.endExclusive.toISOString()).toBe("2026-10-01T05:00:00.000Z");
  });
  it("a one-day range is one day long", () => {
    const r = zonedDayRange("2026-09-15", "2026-09-15", "America/Chicago");
    expect(r.endExclusive.getTime() - r.start.getTime()).toBe(86_400_000);
  });
  it("refuses a range that ends before it starts", () => {
    expect(() => zonedDayRange("2026-09-30", "2026-09-01", "America/Chicago")).toThrow();
  });
});
