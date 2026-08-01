import { describe, it, expect } from "vitest";
import {
  applyVerticalOverrides,
  writeVerticalOverrides,
  OVERRIDABLE_FIELDS,
  SHARED_ONLY_FIELDS,
  BRANDING_FIELDS,
  brandingLogoCategory,
} from "@/lib/vertical-settings";
import { resolveBranding } from "@/server/branding/defaults";

/** A settings row as it exists today: the company / Roofing values. */
const base = {
  logoUrl: "/anexa-homes.png",
  primaryColor: "#0B0B0C",
  accentColor: "#F4631E",
  faviconUrl: "/favicon.ico",
  fontFamily: "Inter",
  removePoweredBy: false,
  supportPhone: "555-0100",
  supportEmail: "help@anexahomes.com",
  emailFromName: "Anexa Homes",
  customDomain: "anexahomes.com",
  recordPrefix: "AH-",
  weeklyTaskRemindersEnabled: true,
  businessHours: { mon: "8-5" },
  currencyCode: "USD",
  bookkeepingApiKey: "secret",
  verticalOverrides: {},
};

describe("roofing is byte-for-byte unchanged", () => {
  // The whole safety argument: with no "roofing" key, every read returns the
  // exact column it returned before this feature existed.
  it("returns the identical object when no override exists", () => {
    expect(applyVerticalOverrides(base, "roofing")).toEqual(base);
  });

  it("is unchanged even when SOLAR has a full brand configured", () => {
    const withSolar = {
      ...base,
      verticalOverrides: {
        solar: { brandName: "Prime Solar", logoUrl: "/prime-solar.png", accentColor: "#1D9BF0" },
      },
    };
    const roofing = applyVerticalOverrides(withSolar, "roofing");
    expect(roofing!.logoUrl).toBe("/anexa-homes.png");
    expect(roofing!.accentColor).toBe("#F4631E");
  });

  it("no vertical at all (cron, pre-auth) keeps the company values", () => {
    expect(applyVerticalOverrides(base, null)).toEqual(base);
  });
});

describe("solar starts unset and INHERITS rather than rendering blank", () => {
  // Rule 3: nothing may render empty while Prime Solar's real values are still
  // being filled in — a half-configured brand shows the company's.
  it("inherits every field when solar has no overrides", () => {
    expect(applyVerticalOverrides(base, "solar")).toEqual(base);
  });

  it("inherits the fields solar has NOT set, while honouring the ones it has", () => {
    const s = {
      ...base,
      verticalOverrides: { solar: { logoUrl: "/prime-solar.png" } },
    };
    const solar = applyVerticalOverrides(s, "solar")!;
    expect(solar.logoUrl).toBe("/prime-solar.png"); // set
    expect(solar.accentColor).toBe("#F4631E"); // inherited, not blank
    expect(solar.supportPhone).toBe("555-0100"); // inherited
  });

  // A null in the JSON means "not set", not "set to nothing" — otherwise
  // clearing solar's logo would blank the brand instead of falling back.
  it("treats an explicit null as inherit, not as blank", () => {
    const s = { ...base, verticalOverrides: { solar: { logoUrl: null } } };
    expect(applyVerticalOverrides(s, "solar")!.logoUrl).toBe("/anexa-homes.png");
  });
});

describe("the overrides column is user-writable, so it is not trusted", () => {
  it("ignores shared-only fields smuggled into the JSON", () => {
    const s = {
      ...base,
      verticalOverrides: { solar: { currencyCode: "EUR", bookkeepingApiKey: "stolen" } },
    };
    const solar = applyVerticalOverrides(s, "solar")!;
    expect(solar.currencyCode).toBe("USD");
    expect(solar.bookkeepingApiKey).toBe("secret");
  });

  it("ignores unknown keys entirely", () => {
    const s = { ...base, verticalOverrides: { solar: { nonsense: true } } };
    expect(applyVerticalOverrides(s, "solar")).toEqual({ ...s });
  });

  it("survives a malformed column rather than throwing", () => {
    for (const bad of [null, "nope", 42, ["a"]]) {
      expect(() => applyVerticalOverrides({ ...base, verticalOverrides: bad }, "solar")).not.toThrow();
    }
  });
});

describe("shared fields can never become per-vertical", () => {
  // One legal entity: splitting the ledger credentials or the role matrix in
  // two would be a data-integrity bug, not a feature.
  it("no shared-only field is overridable", () => {
    for (const f of SHARED_ONLY_FIELDS) {
      expect(OVERRIDABLE_FIELDS).not.toContain(f);
    }
  });

  it("business hours stay shared", () => {
    expect(SHARED_ONLY_FIELDS).toContain("businessHours");
  });
});

describe("writing an override", () => {
  it("stores only the patched vertical, leaving the other untouched", () => {
    const next = writeVerticalOverrides(
      { roofing: { logoUrl: "/a.png" } },
      "solar",
      { logoUrl: "/b.png" }
    );
    expect(next).toEqual({ roofing: { logoUrl: "/a.png" }, solar: { logoUrl: "/b.png" } });
  });

  // "Clear this field" must mean "inherit again", so the key is REMOVED rather
  // than stored as "". Storing "" would render an empty brand.
  it("removes a cleared field so it inherits again", () => {
    const next = writeVerticalOverrides({ solar: { logoUrl: "/b.png" } }, "solar", { logoUrl: "" });
    expect(next).toEqual({});
  });

  it("refuses to write a shared-only field", () => {
    const next = writeVerticalOverrides({}, "solar", { bookkeepingApiKey: "nope" });
    expect(next).toEqual({});
  });
});

describe("the logo asset itself is per vertical", () => {
  // Roofing MUST keep the bare tag: every logoUrl already stored in the wild
  // points at it, so changing it would blank the live logo on the login page.
  it("roofing keeps the existing untagged category", () => {
    expect(brandingLogoCategory("roofing")).toBe("branding_logo");
    expect(brandingLogoCategory(null)).toBe("branding_logo");
    expect(brandingLogoCategory(undefined)).toBe("branding_logo");
  });

  it("solar gets its own, so uploading one cannot delete the other", () => {
    expect(brandingLogoCategory("solar")).toBe("branding_logo:solar");
    expect(brandingLogoCategory("solar")).not.toBe(brandingLogoCategory("roofing"));
  });
});

describe("brand name — the difference between two brands and one logo", () => {
  it("falls back to the company name, so roofing reads Anexa Homes", () => {
    const b = resolveBranding({ company: { name: "Anexa Homes" }, settings: base });
    expect(b.companyName).toBe("Anexa Homes");
  });

  it("uses the vertical's brand name when set, so solar reads Prime Solar", () => {
    const s = applyVerticalOverrides(
      { ...base, verticalOverrides: { solar: { brandName: "Prime Solar" } } },
      "solar"
    );
    const b = resolveBranding({ company: { name: "Anexa Homes" }, settings: s });
    expect(b.companyName).toBe("Prime Solar");
  });

  it("is one of the branding fields, not an afterthought", () => {
    expect(BRANDING_FIELDS).toContain("brandName");
  });
});
