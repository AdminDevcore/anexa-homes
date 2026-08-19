import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  pricePurchase,
  priceThirdParty,
  solarCommissionCents,
  year1Production,
  offsetPct,
  type SolarAssumptions,
} from "@/lib/solar-money";
import {
  validateDesign,
  validateFinance,
  canGenerate,
  type DesignForValidation,
  type FinanceForValidation,
} from "@/lib/solar-validation";

const A: SolarAssumptions = {
  derateFactor: 0.84,
  annualDegradationPct: 0.5,
  utilityEscalationPct: 3.5,
  kwhPerKwYear: 1450,
  defaultGrossPpwCents: 350,
  defaultDealerFeePct: 18,
  minOffsetPct: 0,
  maxOffsetPct: 150,
  minPpwCents: 150,
  maxPpwCents: 800,
};

// ---------------------------------------------------------------------------
// The four products are genuinely different
// ---------------------------------------------------------------------------
describe("cash vs loan: the dealer fee is the whole difference", () => {
  const base = { systemSizeKwDc: 10, grossPpwCents: 350, adderTotalCents: 0 };

  it("a cash deal has no dealer fee, so net PPW is the gross PPW", () => {
    const p = pricePurchase({ ...base, product: "cash", dealerFeePct: 0 });
    expect(p.grossPriceCents).toBe(3_500_000); // 10kW × $3.50/W
    expect(p.dealerFeeCents).toBe(0);
    expect(p.netPpwCents).toBe(350);
  });

  it("a loan embeds the lender's cut in gross, so net PPW is lower", () => {
    const p = pricePurchase({ ...base, product: "loan", dealerFeePct: 18 });
    expect(p.grossPriceCents).toBe(3_500_000);
    expect(p.dealerFeeCents).toBe(630_000); // 18%
    expect(p.netPriceCents).toBe(2_870_000);
    expect(p.netPpwCents).toBeCloseTo(287, 0); // $2.87/W is what we really net
  });

  it("ignores a dealer fee passed on a cash deal rather than applying it", () => {
    // Defence in depth: validation blocks this too, but the maths must not
    // quietly overprice a cash customer if it slips through.
    const p = pricePurchase({ ...base, product: "cash", dealerFeePct: 18 });
    expect(p.dealerFeeCents).toBe(0);
  });

  it("adders land on the contract price, on top of gross", () => {
    const p = pricePurchase({ ...base, product: "loan", dealerFeePct: 18, adderTotalCents: 450_000 });
    expect(p.contractPriceCents).toBe(3_950_000);
  });
});

describe("lease and PPA do not use the purchase model at all", () => {
  it("a PPA bills per kWh and falls as the array degrades", () => {
    const t = priceThirdParty(
      { product: "ppa", rateMillsPerKwh: 145, escalatorPct: 2.9, termYears: 25, year1ProductionKwh: 12_180, systemSizeKwDc: 10 },
      A
    );
    expect(t.year1CostCents).toBe(Math.round((12_180 * 145) / 10));
    expect(t.lifetimeCostCents).toBeGreaterThan(t.year1CostCents * 25 * 0.9);
    expect(t.effectiveRateMills).toBeGreaterThan(145); // escalator outruns degradation
  });

  it("a lease bills a fixed monthly regardless of output", () => {
    const t = priceThirdParty(
      { product: "lease", monthlyPaymentCents: 18_500, escalatorPct: 0, termYears: 20, year1ProductionKwh: 12_180, systemSizeKwDc: 10 },
      A
    );
    expect(t.year1CostCents).toBe(18_500 * 12);
    // No escalator = flat, so lifetime is exactly the monthly × term.
    expect(t.lifetimeCostCents).toBe(18_500 * 12 * 20);
  });
});

// ---------------------------------------------------------------------------
// Commission
// ---------------------------------------------------------------------------
describe("commission bases differ per product", () => {
  const loan = pricePurchase({
    product: "loan", systemSizeKwDc: 10, grossPpwCents: 350, dealerFeePct: 18,
    adderTotalCents: 0, equipmentCostCents: 2_000_000,
  });

  it("PPW pays per watt of system", () => {
    const c = solarCommissionCents("loan", { type: "ppw", ratePerWattCents: 25 }, { purchase: loan });
    expect(c).toBe(10_000 * 25);
  });

  it("margin pays on what the company keeps, net of the dealer fee", () => {
    // net 2,870,000 − cost 2,000,000 = 870,000 margin
    expect(loan.marginCents).toBe(870_000);
    const c = solarCommissionCents("loan", { type: "margin", percent: 40 }, { purchase: loan });
    expect(c).toBe(348_000);
  });

  it("a percentage basis uses NET, never gross — the rep is not paid on the lender's cut", () => {
    const c = solarCommissionCents("loan", { type: "percentage", percent: 10 }, { purchase: loan });
    expect(c).toBe(287_000); // 10% of net, not 350,000
  });

  it("a TPO rep is never left uncompensated: flat and per-watt both pay", () => {
    const t = priceThirdParty(
      { product: "ppa", rateMillsPerKwh: 145, escalatorPct: 2.9, termYears: 25, year1ProductionKwh: 12_180, systemSizeKwDc: 10 },
      A
    );
    // Margin genuinely does not exist — a third party owns the system, so there
    // is no cost basis of ours to take a margin on.
    expect(solarCommissionCents("ppa", { type: "margin", percent: 40 }, { thirdParty: t })).toBe(0);
    // But the array IS installed, so a per-watt rule must still pay. Returning
    // zero here would leave every TPO rep uncompensated, silently.
    expect(solarCommissionCents("ppa", { type: "ppw", ratePerWattCents: 25 }, { thirdParty: t })).toBe(
      10_000 * 25
    );
    // …as must flat and a percentage of year-one customer cost.
    expect(solarCommissionCents("ppa", { type: "flat", amountCents: 150_000 }, { thirdParty: t })).toBe(150_000);
    expect(solarCommissionCents("ppa", { type: "percentage", percent: 10 }, { thirdParty: t })).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// No incentive exists anywhere in the money layer
// ---------------------------------------------------------------------------
describe("no tax credit or incentive is quoted", () => {
  it("has no credit percentage, helper or literal in the money module", () => {
    // The company quotes no federal, state or local incentive. This guards
    // against someone "helpfully" restoring a 30% constant or an ITC helper.
    const src = readFileSync(new URL("../solar-money.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/federalItcPct/);
    expect(src).not.toMatch(/itcEstimateCents/);
    expect(src).not.toMatch(/\b0\.30\b|\bITC_PCT\b/);
  });
});

// ---------------------------------------------------------------------------
// Validation — the 10,814% offset problem
// ---------------------------------------------------------------------------
describe("a rep cannot generate a nonsense proposal", () => {
  const goodDesign: DesignForValidation = {
    systemSizeKwDc: 10,
    year1ProductionKwh: 12_180,
    annualUsageKwh: 14_000,
    offsetPct: 87,
    moduleQty: 25,
    moduleRatingW: 400,
  };

  it("accepts a sane design", () => {
    expect(canGenerate(validateDesign(goodDesign, A))).toBe(true);
  });

  it("BLOCKS the five-figure offset that ships on real competitor proposals", () => {
    const issues = validateDesign({ ...goodDesign, offsetPct: 10_814 }, A);
    expect(canGenerate(issues)).toBe(false);
    expect(issues.find((i) => i.field === "offsetPct")?.message).toMatch(/usage/i);
  });

  it("BLOCKS a design with no usage — the root cause of that number", () => {
    const issues = validateDesign({ ...goodDesign, annualUsageKwh: null }, A);
    expect(canGenerate(issues)).toBe(false);
    expect(issues.some((i) => i.field === "annualUsageKwh")).toBe(true);
  });

  it("BLOCKS negative offset", () => {
    expect(canGenerate(validateDesign({ ...goodDesign, offsetPct: -5 }, A))).toBe(false);
  });

  it("WARNS but allows a high-but-real offset for an EV owner", () => {
    const issues = validateDesign({ ...goodDesign, offsetPct: 120 }, A);
    expect(canGenerate(issues)).toBe(true);
    expect(issues.some((i) => i.severity === "warn")).toBe(true);
  });

  it("BLOCKS production that cannot come from that system size", () => {
    // 10 kW cannot make 60,000 kWh anywhere on earth.
    const issues = validateDesign({ ...goodDesign, year1ProductionKwh: 60_000 }, A);
    expect(canGenerate(issues)).toBe(false);
    expect(issues.some((i) => i.field === "year1ProductionKwh")).toBe(true);
  });

  it("BLOCKS a module count that disagrees with the system size", () => {
    const issues = validateDesign({ ...goodDesign, moduleQty: 40 }, A);
    expect(canGenerate(issues)).toBe(false);
  });

  it("BLOCKS out-of-range PPW", () => {
    const f: FinanceForValidation = {
      product: "loan", grossPpwCents: 1200, dealerFeePct: 18, contractPriceCents: 5_000_000,
      rateMillsPerKwh: null, monthlyPaymentCents: null, escalatorPct: null, termYears: null,
      downPaymentCents: null, loanMonthlyPaymentCents: null,
    };
    expect(canGenerate(validateFinance(f, A))).toBe(false);
  });

  it("BLOCKS a dealer fee on a cash deal", () => {
    const f: FinanceForValidation = {
      product: "cash", grossPpwCents: 350, dealerFeePct: 18, contractPriceCents: 3_500_000,
      rateMillsPerKwh: null, monthlyPaymentCents: null, escalatorPct: null, termYears: null,
      downPaymentCents: null, loanMonthlyPaymentCents: null,
    };
    const issues = validateFinance(f, A);
    expect(canGenerate(issues)).toBe(false);
    expect(issues.find((i) => i.field === "dealerFeePct")?.message).toMatch(/no lender/i);
  });

  it("BLOCKS a down payment that leaves nothing to finance", () => {
    // A COMPLETE loan — APR, term and the lender's monthly are all present —
    // so what this test isolates is the down-payment rule and nothing else.
    const base: FinanceForValidation = {
      product: "loan", grossPpwCents: 350, dealerFeePct: 18, contractPriceCents: 3_885_000,
      rateMillsPerKwh: null, monthlyPaymentCents: null, escalatorPct: null, termYears: null,
      downPaymentCents: null, loanMonthlyPaymentCents: 27_400,
      aprPct: 6.99, loanTermMonths: 300,
    };
    // A real down payment is fine.
    expect(canGenerate(validateFinance({ ...base, downPaymentCents: 500_000 }, A))).toBe(true);
    // One at or above the system price is the stray-decimal case.
    expect(canGenerate(validateFinance({ ...base, downPaymentCents: 3_885_000 }, A))).toBe(false);
    expect(canGenerate(validateFinance({ ...base, downPaymentCents: 9_000_000 }, A))).toBe(false);
  });

  it("BLOCKS loan-only money on products that have no lender", () => {
    const cash: FinanceForValidation = {
      product: "cash", grossPpwCents: 350, dealerFeePct: 0, contractPriceCents: 3_885_000,
      rateMillsPerKwh: null, monthlyPaymentCents: null, escalatorPct: null, termYears: null,
      downPaymentCents: null, loanMonthlyPaymentCents: null,
    };
    expect(canGenerate(validateFinance({ ...cash, downPaymentCents: 500_000 }, A))).toBe(false);
    expect(canGenerate(validateFinance({ ...cash, loanMonthlyPaymentCents: 27_400 }, A))).toBe(false);

    // …and a loan payment left behind after switching to a third-party product.
    const lease: FinanceForValidation = {
      product: "lease", grossPpwCents: 0, dealerFeePct: 0, contractPriceCents: 0,
      rateMillsPerKwh: null, monthlyPaymentCents: 18_500, escalatorPct: 2.9, termYears: 20,
      downPaymentCents: null, loanMonthlyPaymentCents: 27_400,
    };
    expect(canGenerate(validateFinance(lease, A))).toBe(false);
  });

  it("BLOCKS mixing lease and PPA fields", () => {
    const ppaWithMonthly: FinanceForValidation = {
      product: "ppa", grossPpwCents: 0, dealerFeePct: 0, contractPriceCents: 0,
      rateMillsPerKwh: 145, monthlyPaymentCents: 18_500, escalatorPct: 2.9, termYears: 25,
      downPaymentCents: null, loanMonthlyPaymentCents: null,
    };
    expect(canGenerate(validateFinance(ppaWithMonthly, A))).toBe(false);

    const leaseWithRate: FinanceForValidation = {
      product: "lease", grossPpwCents: 0, dealerFeePct: 0, contractPriceCents: 0,
      rateMillsPerKwh: 145, monthlyPaymentCents: 18_500, escalatorPct: 2.9, termYears: 20,
      downPaymentCents: null, loanMonthlyPaymentCents: null,
    };
    expect(canGenerate(validateFinance(leaseWithRate, A))).toBe(false);
  });

  it("bounds come from settings, so a market can widen them", () => {
    const f: FinanceForValidation = {
      product: "loan", grossPpwCents: 900, dealerFeePct: 18, contractPriceCents: 5_000_000,
      rateMillsPerKwh: null, monthlyPaymentCents: null, escalatorPct: null, termYears: null,
      downPaymentCents: null, loanMonthlyPaymentCents: 27_400,
      aprPct: 6.99, loanTermMonths: 300,
    };
    expect(canGenerate(validateFinance(f, A))).toBe(false);
    expect(canGenerate(validateFinance(f, { ...A, maxPpwCents: 1000 }))).toBe(true);
  });

  it("BLOCKS a loan that is missing the figures the lender issued", () => {
    // A loan quotes a monthly payment to the customer. Generating one without
    // the lender's own APR, term and payment means quoting a number nobody
    // issued — the proposal would be a guess wearing a lender's name.
    const bare: FinanceForValidation = {
      product: "loan", grossPpwCents: 350, dealerFeePct: 18, contractPriceCents: 3_885_000,
      rateMillsPerKwh: null, monthlyPaymentCents: null, escalatorPct: null, termYears: null,
      downPaymentCents: null, loanMonthlyPaymentCents: null,
    };
    const issues = validateFinance(bare, A);
    expect(canGenerate(issues)).toBe(false);
    expect(issues.map((i) => i.code)).toEqual(
      expect.arrayContaining([
        "financing.loan_monthly_missing",
        "financing.loan_apr_missing",
        "financing.loan_term_missing",
      ])
    );

    const complete: FinanceForValidation = {
      ...bare, loanMonthlyPaymentCents: 27_400, aprPct: 6.99, loanTermMonths: 300,
    };
    expect(canGenerate(validateFinance(complete, A))).toBe(true);
  });

  it("BLOCKS an APR left behind on a lease by a product switch", () => {
    // The defect this guards: switching Loan -> Lease used to leave aprPct on
    // the row, and the customer-facing proposal renders an APR whenever one is
    // present. A homeowner was one product switch away from being quoted an
    // interest rate on a lease, which has none.
    const lease: FinanceForValidation = {
      product: "lease", grossPpwCents: 0, dealerFeePct: 0, contractPriceCents: 0,
      rateMillsPerKwh: null, monthlyPaymentCents: 17_500, escalatorPct: 2.9, termYears: 25,
      downPaymentCents: null, loanMonthlyPaymentCents: null, aprPct: 6.99,
    };
    const issues = validateFinance(lease, A);
    expect(canGenerate(issues)).toBe(false);
    expect(issues.map((i) => i.code)).toContain("financing.tpo_apr");

    expect(canGenerate(validateFinance({ ...lease, aprPct: null }, A))).toBe(true);
  });
});

describe("production maths", () => {
  it("derives year-one production from size, irradiance and derate", () => {
    expect(year1Production(10, A)).toBe(Math.round(10 * 1450 * 0.84));
  });
  it("offset is production over usage", () => {
    expect(offsetPct(12_180, 14_000)).toBeCloseTo(87, 0);
    expect(offsetPct(12_180, 0)).toBe(0); // no divide-by-zero blowup
  });
});
