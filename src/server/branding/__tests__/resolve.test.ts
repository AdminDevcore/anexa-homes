import { describe, it, expect } from "vitest";
import { DEFAULT_BRANDING, resolveBranding } from "../defaults";

describe("resolveBranding", () => {
  it("returns defaults when no tenant data", () => {
    const b = resolveBranding({ company: { name: "Acme" }, settings: null });
    expect(b.companyName).toBe("Acme");
    expect(b.currencyCode).toBe(DEFAULT_BRANDING.currencyCode); // "USD"
    expect(b.locale).toBe("en-US");
    expect(b.recordPrefix).toBe("AC-"); // derived from initials when unset
  });

  it("overlays tenant settings over defaults", () => {
    const b = resolveBranding({
      company: { name: "Summit Roofing", timezone: "America/New_York" },
      settings: {
        currencyCode: "EUR",
        locale: "de-DE",
        recordPrefix: "SR-",
        supportPhone: "(111) 222-3333",
        primaryColor: "#123456",
        logoUrl: "https://x/logo.png",
      },
    });
    expect(b.currencyCode).toBe("EUR");
    expect(b.locale).toBe("de-DE");
    expect(b.timeZone).toBe("America/New_York");
    expect(b.recordPrefix).toBe("SR-");
    expect(b.supportPhone).toBe("(111) 222-3333");
    expect(b.primaryColor).toBe("#123456");
    expect(b.logoUrl).toBe("https://x/logo.png");
  });

  it("derives a prefix from multi-word names, capping at 3 letters", () => {
    expect(resolveBranding({ company: { name: "A B C D" }, settings: null }).recordPrefix).toBe("ABC-");
    expect(resolveBranding({ company: { name: "solo" }, settings: null }).recordPrefix).toBe("SO-");
  });
});
