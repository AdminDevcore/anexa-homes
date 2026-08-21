import { describe, it, expect } from "vitest";
import { stormEnabled, insuranceEnabled } from "../vertical-features";
import { visibleSettingsSections, visibleSettingsGroups, SETTINGS_GROUPS } from "../settings-sections";
import { DEFAULT_FILTERS, parseFilters, withoutStormLayers, STORM_PARAMS } from "../field-map-filters";

describe("vertical features", () => {
  it("gives roofing storm and insurance, and solar neither", () => {
    expect(stormEnabled("roofing")).toBe(true);
    expect(insuranceEnabled("roofing")).toBe(true);
    expect(stormEnabled("solar")).toBe(false);
    expect(insuranceEnabled("solar")).toBe(false);
  });
});

describe("settings sections", () => {
  const titles = (v: "roofing" | "solar") => visibleSettingsSections(v).map((s) => s.title);

  it("keeps roofing's hub exactly as it was", () => {
    const roofing = titles("roofing");
    expect(roofing).toContain("Scope of Work Catalog");
    expect(roofing).toContain("Inspection Outcomes");
    expect(roofing).toContain("Storm & Homeowner Data");
    expect(roofing).not.toContain("Solar Settings");
    expect(roofing).not.toContain("Solar Equipment");
  });

  it("hides the insurance-restoration catalog from solar", () => {
    expect(titles("solar")).not.toContain("Scope of Work Catalog");
  });

  it("hides claim statuses from solar, which has no carrier", () => {
    expect(titles("roofing")).toContain("Claim Statuses");
    expect(titles("solar")).not.toContain("Claim Statuses");
  });

  it("renames rather than hides the cards solar still needs", () => {
    const solar = titles("solar");
    // Owner re-verify + county records survive; the storm search area does not.
    expect(solar).toContain("Homeowner Data");
    expect(solar).not.toContain("Storm & Homeowner Data");
  });

  it("hides inspection outcomes from solar, whose visit ends at the appointment", () => {
    // It was offered as "Site Survey Outcomes" while the solar deal page had a
    // dropdown to spend it on. That step is gone, so the list configures
    // nothing a solar user can reach.
    const solar = titles("solar");
    expect(solar).not.toContain("Site Survey Outcomes");
    expect(solar).not.toContain("Inspection Outcomes");
  });

  it("renamed cards still point at the same page", () => {
    const solar = visibleSettingsSections("solar");
    expect(solar.find((s) => s.title === "Homeowner Data")?.href).toBe("/portal/settings/storm-coverage");
  });

  it("shows solar its own configuration", () => {
    const solar = titles("solar");
    expect(solar).toContain("Solar Settings");
    expect(solar).toContain("Solar Equipment");
  });

  it("hides commission rules from solar, which pays reps off their own split", () => {
    // The rules only ever paid the crew and project-manager lines. Solar has
    // neither; a solar rep's cut is the split on his own profile, so the card
    // opened a page with nothing in it to set.
    expect(titles("roofing")).toContain("Commission Rules");
    expect(titles("solar")).not.toContain("Commission Rules");
  });

  it("leaves the vertical-agnostic cards in both", () => {
    for (const t of ["Pipeline Stages", "Production Checklist", "Branding"]) {
      expect(titles("roofing")).toContain(t);
      expect(titles("solar")).toContain(t);
    }
  });

  it("bands every visible card, losing none", () => {
    for (const v of ["roofing", "solar"] as const) {
      const banded = visibleSettingsGroups(v).flatMap((g) => g.sections.map((s) => s.title));
      // A card whose group key matched no band would silently vanish from the hub.
      expect(banded.sort()).toEqual(titles(v).sort());
    }
  });

  it("drops the bands this workspace has no card for", () => {
    const keys = (v: "roofing" | "solar") => visibleSettingsGroups(v).map((g) => g.key);
    expect(keys("solar")).toContain("solar");
    expect(keys("solar")).not.toContain("insurance");
    expect(keys("roofing")).toContain("insurance");
    expect(keys("roofing")).not.toContain("solar");
    // Bands stay in catalog order, so the hub reads the same on every visit.
    for (const v of ["roofing", "solar"] as const) {
      const order = SETTINGS_GROUPS.map((g) => g.key).filter((k) => keys(v).includes(k));
      expect(keys(v)).toEqual(order);
    }
  });
});

describe("withoutStormLayers", () => {
  it("forces every storm layer off", () => {
    const on = { ...DEFAULT_FILTERS, showRadar: true, showStormReports: true, showStormWarnings: true, showHeat: true, minScore: 90 };
    expect(withoutStormLayers(on)).toMatchObject({
      showRadar: false,
      showStormReports: false,
      showStormWarnings: false,
      showHeat: false,
      minScore: 0,
    });
  });

  it("ignores a shared link that tries to switch storm layers back on", () => {
    // The exact failure this guards: a roofing manager shares their map URL and
    // a solar rep opens it. Without the strip, that link renders hail swaths.
    const parsed = parseFilters(new URLSearchParams("hail=1&heat=1&reports=1&warnings=1&score=90&rep=abc"));
    const stripped = withoutStormLayers(parsed);
    expect(stripped.showRadar).toBe(false);
    expect(stripped.showHeat).toBe(false);
    expect(stripped.showStormReports).toBe(false);
    expect(stripped.showStormWarnings).toBe(false);
    expect(stripped.minScore).toBe(0);
    // Non-storm filters are untouched.
    expect(stripped.repId).toBe("abc");
  });

  it("leaves everything that isn't a storm layer alone", () => {
    const f = { ...DEFAULT_FILTERS, dispositions: new Set(["not_home"]), repId: "r1", showZips: true, basemap: "street" as const };
    const stripped = withoutStormLayers(f);
    expect(stripped.dispositions).toEqual(new Set(["not_home"]));
    expect(stripped.repId).toBe("r1");
    expect(stripped.showZips).toBe(true);
    expect(stripped.basemap).toBe("street");
    expect(stripped.showDeals).toBe(DEFAULT_FILTERS.showDeals);
  });

  it("names every storm query param, so none can leak into a storm-less URL", () => {
    // STORM_PARAMS is what use-map-filters deletes when serializing. If a new
    // storm layer is added with a new param, this list has to grow with it.
    expect([...STORM_PARAMS].sort()).toEqual(["hail", "heat", "reports", "score", "warnings"]);
  });
});
