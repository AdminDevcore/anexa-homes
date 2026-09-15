import { describe, expect, it } from "vitest";
import { validateDesign, type DesignForValidation } from "@/lib/solar-validation";
import { SOLAR_ASSUMPTION_DEFAULTS } from "@/server/modules/solar/settings";
import type { SolarAssumptions } from "@/lib/solar-money";

/**
 * WHAT A PROPOSAL CANNOT BE GENERATED WITHOUT (2026-09-15).
 *
 *  - the utility provider, consumption and — where savings are projected — a
 *    rate are BLOCKS, on an array and on a battery-only deal alike;
 *  - the minimum offset is enforced once it is DECIDED, and never invented for
 *    a workspace that has not decided it: an uninitialised or legacy workspace
 *    is warned, not stopped.
 *
 * These are the rules `readSolarReadiness` runs for both the builder's check
 * and generation itself, so a block here is a block on the server.
 */

const pv = (over: Partial<DesignForValidation> = {}): DesignForValidation => ({
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

const storage = (over: Partial<DesignForValidation> = {}): DesignForValidation => ({
  systemType: "storage",
  hasBattery: true,
  batteryQty: 2,
  systemSizeKwDc: 0,
  year1ProductionKwh: 0,
  annualUsageKwh: 14_000,
  offsetPct: 0,
  moduleQty: 0,
  moduleRatingW: null,
  utilityProvider: "Oncor",
  ...over,
});

const assume = (over: Partial<SolarAssumptions> = {}): SolarAssumptions => ({ ...SOLAR_ASSUMPTION_DEFAULTS, ...over });
const find = (issues: ReturnType<typeof validateDesign>, code: string) => issues.find((i) => i.code === code);

describe("utility provider, consumption and rate are required", () => {
  it("blocks an array with no utility provider, and says why and where", () => {
    for (const blank of [null, "", "   "]) {
      const issue = find(validateDesign(pv({ utilityProvider: blank }), assume(), "lead-1"), "utility.provider_missing");
      expect(issue?.severity).toBe("block");
      expect(issue?.message).toMatch(/utility provider/i);
      expect(issue?.action?.href).toContain("lead-1");
    }
  });

  it("blocks a battery-only deal with no utility provider", () => {
    expect(find(validateDesign(storage({ utilityProvider: null }), assume()), "utility.provider_missing")?.severity).toBe("block");
  });

  it("does not raise it when the caller has no provider field to judge", () => {
    const { utilityProvider: _omit, ...rest } = pv();
    expect(find(validateDesign(rest as DesignForValidation, assume()), "utility.provider_missing")).toBeUndefined();
  });

  it("blocks with no consumption, on both shapes of deal", () => {
    expect(find(validateDesign(pv({ annualUsageKwh: null }), assume()), "utility.usage_missing")?.severity).toBe("block");
    expect(find(validateDesign(storage({ annualUsageKwh: 0 }), assume()), "storage.no_usage")?.severity).toBe("block");
  });

  it("blocks an array with no way to a rate — the savings projection stands on it", () => {
    const issue = find(validateDesign(pv({ avgMonthlyBillCents: null, annualUsageKwh: 14_000 }), assume()), "utility.rate_missing");
    expect(issue?.severity).toBe("block");
  });

  it("passes a complete array and a complete battery deal", () => {
    expect(validateDesign(pv(), assume({ minOffsetPct: 80, minOffsetConfigured: true })).filter((i) => i.severity === "block")).toEqual([]);
    expect(validateDesign(storage(), assume()).filter((i) => i.severity === "block")).toEqual([]);
  });
});

describe("minimum offset: configured, deliberately zero, or never set up", () => {
  const undersized = pv({ offsetPct: 40 });
  const codes = (a: SolarAssumptions) => validateDesign(undersized, a).map((i) => `${i.severity}:${i.code}`);

  it("CONFIGURED above zero: generation is blocked below it", () => {
    expect(codes(assume({ minOffsetPct: 80, minOffsetConfigured: true }))).toContain("block:design.offset_below_min");
  });

  it("a minimum above zero is a decision even on a row that predates the flag", () => {
    expect(codes(assume({ minOffsetPct: 80, minOffsetConfigured: false }))).toContain("block:design.offset_below_min");
  });

  it("DELIBERATE zero: nothing is raised — no block, no nagging", () => {
    const c = codes(assume({ minOffsetPct: 0, minOffsetConfigured: true }));
    expect(c.filter((x) => x.includes("offset_below_min") || x.includes("min_offset_unset"))).toEqual([]);
  });

  it("NEVER SET UP (a new or legacy workspace): a warning, never a block", () => {
    const c = codes(assume({ minOffsetPct: 0, minOffsetConfigured: false }));
    expect(c).toContain("warn:config.min_offset_unset");
    expect(c.filter((x) => x.startsWith("block:"))).toEqual([]);
  });

  it("the defaults a workspace with no settings row gets are 'never set up' — no invented minimum", () => {
    expect(SOLAR_ASSUMPTION_DEFAULTS.minOffsetPct).toBe(0);
    expect(SOLAR_ASSUMPTION_DEFAULTS.minOffsetConfigured).toBe(false);
    const c = codes(SOLAR_ASSUMPTION_DEFAULTS);
    expect(c).toContain("warn:config.min_offset_unset");
    expect(c.filter((x) => x.startsWith("block:"))).toEqual([]);
  });

  it("the unset warning tells an admin where to fix it", () => {
    const issue = find(validateDesign(undersized, assume({ minOffsetPct: 0, minOffsetConfigured: false })), "config.min_offset_unset");
    expect(issue?.message).toMatch(/Solar Settings/);
  });
});
