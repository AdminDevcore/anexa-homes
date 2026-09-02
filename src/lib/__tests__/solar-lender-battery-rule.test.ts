import { describe, it, expect } from "vitest";
import {
  validateDesign,
  canGenerate,
  type DesignForValidation,
  type LenderBatteryRule,
} from "@/lib/solar-validation";
import type { SolarAssumptions } from "@/lib/solar-money";

/**
 * Whether a partner funds an array with no battery is the PARTNER'S rule.
 *
 * Before this the app held one opinion for everybody -- a note on every
 * batteryless design saying the proposal would tell the homeowner their system
 * shuts off in an outage. True, and unswitchable: an admin could neither
 * silence it for the lenders that do not care nor make it binding for the ones
 * that will decline the file.
 *
 * The default is the thing to hold still. Every deal on every lender in
 * production today is judged by `warn`, so a column that changed what any of
 * them does would be a migration that re-gated live work.
 */
const A: SolarAssumptions = {
  derateFactor: 0.84,
  annualDegradationPct: 0.5,
  utilityEscalationPct: 3.5,
  kwhPerKwYear: 1450,
  utilityMeterFeeCents: 1000,
  defaultGrossPpwCents: 350,
  defaultDealerFeePct: 18,
  minOffsetPct: 0,
  maxOffsetPct: 150,
};

/** A grid-tied PV design with nothing wrong with it except the missing battery. */
const PV: DesignForValidation = {
  systemType: "pv",
  systemSizeKwDc: 8,
  year1ProductionKwh: 11_600,
  annualUsageKwh: 12_000,
  offsetPct: 97,
  moduleQty: 20,
  moduleRatingW: 400,
  avgMonthlyBillCents: 250_00,
  hasLayoutImage: true,
  hasBattery: false,
};

const forRule = (rule: LenderBatteryRule | null | undefined) =>
  validateDesign({ ...PV, batteryRule: rule }, A);
const battery = (rule: LenderBatteryRule | null | undefined) =>
  forRule(rule).find((i) => i.code === "equipment.no_battery") ?? null;

describe("a lender decides what a batteryless array means", () => {
  it("`warn` flags it and still generates", () => {
    expect(battery("warn")?.severity).toBe("warn");
    expect(canGenerate(forRule("warn"))).toBe(true);
  });

  it("`optional` says nothing at all", () => {
    expect(battery("optional")).toBeNull();
    expect(canGenerate(forRule("optional"))).toBe(true);
  });

  it("`required` blocks the proposal", () => {
    expect(battery("required")?.severity).toBe("block");
    expect(canGenerate(forRule("required"))).toBe(false);
  });

  it("the finding keeps ONE code across all three, so a rep sees one issue change its mind", () => {
    expect(battery("warn")?.code).toBe("equipment.no_battery");
    expect(battery("required")?.code).toBe("equipment.no_battery");
  });

  /**
   * The two ways a caller arrives with no rule -- a cash deal, which has no
   * lender to ask, and a caller written before the field existed. Both are
   * judged exactly as every deal was judged yesterday.
   */
  it("no rule is `warn`, so nothing already quoted changes", () => {
    expect(battery(null)?.severity).toBe("warn");
    expect(battery(undefined)?.severity).toBe("warn");
    const legacy = { ...PV };
    delete (legacy as { batteryRule?: unknown }).batteryRule;
    expect(validateDesign(legacy, A)).toEqual(validateDesign({ ...PV, batteryRule: "warn" }, A));
  });

  it("a design that HAS a battery is never asked, whatever the lender says", () => {
    for (const rule of ["optional", "warn", "required"] as const) {
      const issues = validateDesign({ ...PV, hasBattery: true, batteryRule: rule }, A);
      expect(issues.find((i) => i.code === "equipment.no_battery")).toBeUndefined();
      expect(canGenerate(issues)).toBe(true);
    }
  });

  /**
   * A storage deal returns before the PV gates run and already blocks on a
   * missing battery with its own code. A `required` lender must not turn that
   * into two findings saying the same thing.
   */
  it("a storage deal keeps its own missing-battery block and gains no second one", () => {
    const issues = validateDesign(
      {
        systemType: "storage",
        systemSizeKwDc: 0,
        year1ProductionKwh: 0,
        annualUsageKwh: 12_000,
        offsetPct: 0,
        moduleQty: 0,
        moduleRatingW: null,
        hasBattery: false,
        batteryQty: 0,
        hasBackupProfile: true,
        batteryRule: "required",
      },
      A
    );
    expect(issues.filter((i) => i.code === "equipment.no_battery")).toHaveLength(0);
    expect(issues.find((i) => i.code === "storage.no_battery")?.severity).toBe("block");
  });
});
