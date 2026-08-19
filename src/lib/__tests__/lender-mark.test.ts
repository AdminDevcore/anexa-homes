import { describe, it, expect } from "vitest";
import {
  lenderLogoUrl,
  lenderInitials,
  lenderMarkColor,
  LENDER_MARK_COLORS,
} from "@/lib/lender-mark";

describe("lenderLogoUrl", () => {
  it("is null when the lender has no logo, so callers fall back to a monogram", () => {
    expect(lenderLogoUrl("abc", null)).toBeNull();
    expect(lenderLogoUrl("abc", undefined)).toBeNull();
  });

  it("busts the cache on the logo's own timestamp, not on render time", () => {
    const at = new Date("2026-08-19T12:00:00Z");
    const once = lenderLogoUrl("abc", at);
    const again = lenderLogoUrl("abc", at);
    expect(once).toBe(again);
    expect(once).toContain(`v=${at.getTime()}`);
  });

  it("escapes the id rather than pasting it into the query string raw", () => {
    expect(lenderLogoUrl("a b&c", 1)).toContain("lender=a%20b%26c");
  });
});

describe("lenderInitials", () => {
  it("takes one letter from each of the first two meaningful words", () => {
    expect(lenderInitials("Amos Capital Fund")).toBe("AC");
    expect(lenderInitials("Climate First")).toBe("CF");
  });

  it("skips corporate noise so a bank is not initialled from its suffix", () => {
    expect(lenderInitials("Bank of America, N.A.")).toBe("BA");
    expect(lenderInitials("Sunlight Financial LLC")).toBe("SF");
  });

  it("gives a one-word lender two letters, because one reads as unfinished", () => {
    expect(lenderInitials("GoodLeap")).toBe("GO");
  });

  it("still produces a mark for a name that is all punctuation and suffixes", () => {
    expect(lenderInitials("LLC")).toBe("LL");
    expect(lenderInitials("&&&")).toBe("?");
  });
});

describe("lenderMarkColor", () => {
  it("is stable for a name, so a partner keeps one colour everywhere", () => {
    expect(lenderMarkColor("Amos Capital Fund")).toEqual(lenderMarkColor("Amos Capital Fund"));
  });

  it("ignores case and surrounding space, which a rename would otherwise change", () => {
    expect(lenderMarkColor("  climate first ")).toEqual(lenderMarkColor("Climate First"));
  });

  it("only ever returns a pair from the fixed palette", () => {
    for (const name of ["Amos", "Climate First", "GoodLeap", "Mosaic", "Dividend", "EnFin"]) {
      expect(LENDER_MARK_COLORS).toContainEqual(lenderMarkColor(name));
    }
  });
});
