import { describe, it, expect } from "vitest";
import {
  validateDesign,
  validateFinance,
  canGenerate,
  type DesignForValidation,
  type FinanceForValidation,
} from "@/lib/solar-validation";
import type { SolarAssumptions } from "@/lib/solar-money";

const A: SolarAssumptions = {
  derateFactor: 0.84,
  annualDegradationPct: 0.5,
  utilityEscalationPct: 3.5,
  kwhPerKwYear: 1450,
  utilityMeterFeeCents: 1000,
  companyDefaultBasePpwCents: 350,
  defaultDealerFeePct: 18,
  minOffsetPct: 0,
  maxOffsetPct: 150,
};

/** A storage deal with nothing wrong with it. */
const DESIGN: DesignForValidation = {
  systemType: "storage",
  systemSizeKwDc: 0,
  year1ProductionKwh: 0,
  annualUsageKwh: 12_000,
  offsetPct: 0,
  moduleQty: 0,
  moduleRatingW: null,
  avgMonthlyBillCents: 250_00,
  hasBattery: true,
  batteryQty: 2,
};

const FINANCE: FinanceForValidation = {
  systemType: "storage",
  product: "loan",
  grossPpwCents: 0,
  stickerPricePerBatteryCents: 17_333_33,
  batteryQty: 2,
  minBasePricePerBatteryCents: 9_000_00,
  financesStorageOnly: true,
  dealerFeePct: 25,
  contractPriceCents: 36_933_33,
  rateMillsPerKwh: null,
  monthlyPaymentCents: 450_00,
  escalatorPct: null,
  termYears: null,
  downPaymentCents: 0,
  loanMonthlyPaymentCents: 450_00,
  aprPct: 6.99,
  loanTermMonths: 300,
};

const codes = (i: { code: string }[]) => i.map((x) => x.code).join(" ");

describe("storage readiness", () => {
  it("does not ask a battery for an array", () => {
    const c = codes(validateDesign(DESIGN, A));
    expect(c).not.toMatch(/module|plane|production|offset|layout|tsrf|size_zero/i);
  });

  it("generates when the storage deal is complete", () => {
    expect(canGenerate([...validateDesign(DESIGN, A), ...validateFinance(FINANCE, A)])).toBe(true);
  });

  it("blocks on no battery", () => {
    expect(canGenerate(validateDesign({ ...DESIGN, hasBattery: false }, A))).toBe(false);
  });

  it("blocks on a zero battery count", () => {
    expect(canGenerate(validateDesign({ ...DESIGN, batteryQty: 0 }, A))).toBe(false);
  });

  it("blocks on missing usage — the document could state neither hours nor saving", () => {
    // A WARNING while runtime came from the company's list of named load
    // profiles: the hours were there either way and only the bill saving went
    // missing. Whole-home backup divides THIS house's usage, so a blank Energy
    // step now costs the document both of the two things a battery is bought
    // for, which leaves it nothing to say.
    const issues = validateDesign({ ...DESIGN, annualUsageKwh: null }, A);
    expect(canGenerate(issues)).toBe(false);
    expect(codes(issues)).toContain("storage.no_usage");
  });

  it("does not block a battery deal that has usage", () => {
    expect(codes(validateDesign(DESIGN, A))).not.toContain("storage.no_usage");
  });

  it("blocks on a zero price per battery", () => {
    expect(
      canGenerate(validateFinance({ ...FINANCE, stickerPricePerBatteryCents: 0 }, A))
    ).toBe(false);
  });

  it("blocks under the lender's per-battery floor", () => {
    // $11,000 sticker at a 25% fee leaves $8,250 — under a $9,000 floor.
    expect(
      canGenerate(validateFinance({ ...FINANCE, stickerPricePerBatteryCents: 11_000_00 }, A))
    ).toBe(false);
  });

  it("blocks on loan paper that does not fund storage", () => {
    expect(canGenerate(validateFinance({ ...FINANCE, financesStorageOnly: false }, A))).toBe(false);
  });

  it("does NOT block cash on paper eligibility — cash has no lender", () => {
    const cash: FinanceForValidation = {
      ...FINANCE,
      product: "cash",
      dealerFeePct: 0,
      financesStorageOnly: false,
      minBasePricePerBatteryCents: null,
      aprPct: null,
      loanTermMonths: null,
      loanMonthlyPaymentCents: null,
      monthlyPaymentCents: null,
    };
    expect(canGenerate(validateFinance(cash, A))).toBe(true);
  });

  it("refuses a lease or PPA — a battery generates no electricity to sell", () => {
    for (const product of ["lease", "ppa"] as const) {
      expect(canGenerate(validateFinance({ ...FINANCE, product }, A))).toBe(false);
    }
  });
});

describe("a PV deal is judged exactly as before", () => {
  const PV: DesignForValidation = {
    systemType: "pv",
    systemSizeKwDc: 10.14,
    year1ProductionKwh: 14_500,
    annualUsageKwh: 15_000,
    offsetPct: 96,
    moduleQty: 26,
    moduleRatingW: 390,
    avgMonthlyBillCents: 250_00,
  };

  it("behaves identically with no systemType at all", () => {
    // A caller not yet updated must be judged as it was: absent means pv.
    const { systemType: _drop, ...legacy } = PV;
    expect(validateDesign(legacy as DesignForValidation, A)).toEqual(validateDesign(PV, A));
  });

  it("pv_storage takes the identical path to pv", () => {
    expect(validateDesign({ ...PV, systemType: "pv_storage" }, A)).toEqual(validateDesign(PV, A));
  });

  it("still demands an array", () => {
    expect(canGenerate(validateDesign({ ...PV, systemSizeKwDc: 0 }, A))).toBe(false);
  });
});
