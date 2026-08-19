import { describe, it, expect } from "vitest";
import { validateDesign, type DesignForValidation } from "@/lib/solar-validation";
import { SOLAR_ASSUMPTION_DEFAULTS } from "@/server/modules/solar/settings";

/**
 * A design is judged only on what the step still collects.
 *
 * Validation that asks for a field no form offers is worse than no validation:
 * it puts a blocker on a rep's screen with no way to clear it.
 */
const design = (over: Partial<DesignForValidation> = {}): DesignForValidation => ({
  systemSizeKwDc: 9.6,
  year1ProductionKwh: 13_900,
  annualUsageKwh: 14_000,
  offsetPct: 99,
  moduleQty: 24,
  moduleRatingW: 400,
  avgMonthlyBillCents: 18_000,
  utilityProvider: "Oncor",
  ...over,
});

describe("a design is judged only on what the form still collects", () => {
  // Cast on purpose: these keys are off the type now, and the point of the test
  // is that the RULES are deleted rather than merely skipped when the field is
  // absent. A stray value left on an old row must raise nothing.
  const withStrays = (over: Record<string, unknown>) =>
    validateDesign({ ...design(), ...over } as DesignForValidation, SOLAR_ASSUMPTION_DEFAULTS).map(
      (i) => i.code
    );

  it("raises nothing about TSRF, because nobody enters it any more", () => {
    expect(withStrays({ tsrfPct: 12 }).filter((c) => c.includes("tsrf"))).toEqual([]);
    expect(withStrays({ tsrfPct: null }).filter((c) => c.includes("tsrf"))).toEqual([]);
  });

  it("raises nothing about a rate plan", () => {
    expect(withStrays({ ratePlan: null })).not.toContain("utility.rate_plan_missing");
    expect(withStrays({ ratePlan: "" })).not.toContain("utility.rate_plan_missing");
  });

  it("blames the catalogue, not the rep, when there is no panel to size from", () => {
    const issues = validateDesign(
      design({ moduleRatingW: null, systemSizeKwDc: 0 }),
      SOLAR_ASSUMPTION_DEFAULTS,
      "lead-1"
    );
    const noModule = issues.find((i) => i.code === "equipment.no_module");
    expect(noModule?.severity).toBe("block");
    expect(noModule?.message).toContain("default");
    expect(noModule?.action?.href).toContain("/portal/settings/solar-equipment");
  });

  it("still blocks a design that is complete but physically implausible", () => {
    const codes = validateDesign(
      design({ offsetPct: 400, year1ProductionKwh: 56_000 }),
      SOLAR_ASSUMPTION_DEFAULTS
    ).map((i) => i.code);
    expect(codes).toContain("design.offset_above_max");
  });

  it("passes a complete design clean", () => {
    const blocking = validateDesign(design(), SOLAR_ASSUMPTION_DEFAULTS).filter(
      (i) => i.severity === "block"
    );
    expect(blocking).toEqual([]);
  });
});

describe("a quote needs a drawing", () => {
  it("blocks generation when no layout has been drawn or attached", () => {
    const issues = validateDesign(design({ hasLayoutImage: false }), SOLAR_ASSUMPTION_DEFAULTS, "lead-1");
    const found = issues.find((i) => i.code === "documents.no_layout");
    expect(found?.severity).toBe("block");
    expect(found?.action?.href).toContain("step=design");
  });

  it("says nothing when a layout is there", () => {
    const codes = validateDesign(design({ hasLayoutImage: true }), SOLAR_ASSUMPTION_DEFAULTS).map((i) => i.code);
    expect(codes).not.toContain("documents.no_layout");
  });
});

describe("a rate can come from either direction", () => {
  it("passes a design that entered the bill and the rate, with no derivable usage split", () => {
    // The whole reason utility.bill_missing had to go: this deal has a rate, it
    // just did not get one by dividing the bill by the usage.
    const codes = validateDesign(
      design({ utilityRateMills: 200, avgMonthlyBillCents: 20_000, annualUsageKwh: 12_000 }),
      SOLAR_ASSUMPTION_DEFAULTS
    ).map((i) => i.code);
    expect(codes).not.toContain("utility.rate_missing");
    expect(codes).not.toContain("utility.rate_implausible");
  });

  it("blocks when neither route gives a rate", () => {
    const codes = validateDesign(
      design({ utilityRateMills: null, avgMonthlyBillCents: null }),
      SOLAR_ASSUMPTION_DEFAULTS
    ).map((i) => i.code);
    expect(codes).toContain("utility.rate_missing");
  });

  it("warns on a rate nobody in the US actually pays", () => {
    const codes = validateDesign(
      design({ utilityRateMills: 900, avgMonthlyBillCents: 20_000 }),
      SOLAR_ASSUMPTION_DEFAULTS
    ).map((i) => i.code);
    expect(codes).toContain("utility.rate_implausible");
  });
});
