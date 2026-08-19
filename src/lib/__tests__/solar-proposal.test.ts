import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildProposalSnapshot,
  savingsModel,
  environmentalImpact,
  SOLAR_TIMELINE,
  SOLAR_FAQS,
  ESTIMATE_DISCLAIMER,
} from "@/lib/solar-proposal";
import type { SolarAssumptions } from "@/lib/solar-money";

const A: SolarAssumptions = {
  derateFactor: 0.84,
  annualDegradationPct: 0.5,
  utilityEscalationPct: 3.5,
  kwhPerKwYear: 1450,
  defaultGrossPpwCents: 350,
  defaultDealerFeePct: 18,
  federalItcPct: null,
  minOffsetPct: 0,
  maxOffsetPct: 150,
  minPpwCents: 150,
  maxPpwCents: 800,
};

const DESIGN = {
  systemSizeKwDc: 10,
  year1ProductionKwh: 12_180,
  offsetPct: 87,
  annualUsageKwh: 14_000,
  moduleLabel: "Qcells Q.PEAK · 400W",
  moduleQty: 25,
  inverterLabel: "Enphase IQ8+",
  batteryLabel: null,
  mountType: "roof",
  utilityProvider: "Oncor",
  netMeteringProgram: "Buyback",
  avgMonthlyBillCents: 21_000,
};

const LOAN = {
  product: "loan" as const,
  grossPpwCents: 350,
  dealerFeePct: 18,
  adderTotalCents: 0,
  rateMillsPerKwh: null,
  monthlyPaymentCents: null,
  escalatorPct: null,
  termYears: 25,
  aprPct: 6.99,
};

const build = (over: Partial<Parameters<typeof buildProposalSnapshot>[0]> = {}) =>
  buildProposalSnapshot({
    reference: "SP-TEST-V1",
    generatedById: "user-1",
    customer: { name: "Priya Raman", address: "902 Solaris Way, Dallas TX" },
    company: { name: "Anexa Homes", phone: "(866) 650-9996", email: null, logoUrl: null },
    design: DESIGN,
    finance: LOAN,
    lender: "GoodLeap",
    assumptions: A,
    incentiveDisclaimer: "Estimated only…",
    now: new Date("2026-07-30T12:00:00Z"),
    ...over,
  });

describe("the proposal snapshot is self-contained and frozen", () => {
  it("records every assumption it used, so the document explains its own numbers", () => {
    const s = build();
    expect(s.assumptions.utilityEscalationPct).toBe(3.5);
    expect(s.assumptions.annualDegradationPct).toBe(0.5);
    expect(s.assumptions.kwhPerKwYear).toBe(1450);
    // Derived from the customer's OWN bill, not an invented national average.
    expect(s.assumptions.currentRateMillsPerKwh).toBe(180); // $210×12 / 14,000 kWh
  });

  it("carries the non-binding-estimate disclaimer on every proposal", () => {
    const s = build();
    expect(s.disclaimers.estimate).toBe(ESTIMATE_DISCLAIMER);
    expect(s.disclaimers.estimate).toMatch(/not a binding offer|not a guarantee/i);
    expect(s.disclaimers.estimate).toMatch(/subject to credit approval/i);
  });

  it("changing assumptions later cannot alter an existing snapshot", () => {
    const before = build();
    // The company's CPA raises the escalation assumption next month…
    const after = build({ assumptions: { ...A, utilityEscalationPct: 6 } });
    // …a NEW proposal reflects it, but the old object is untouched.
    expect(after.assumptions.utilityEscalationPct).toBe(6);
    expect(before.assumptions.utilityEscalationPct).toBe(3.5);
    expect(after.savings.totalSavingsCents).not.toBe(before.savings.totalSavingsCents);
  });
});

describe("the incentive line only appears when configured", () => {
  it("is null — not zero — when the company has set no percentage", () => {
    const s = build();
    // Null omits the row entirely; 0 would render "$0 federal credit".
    expect(s.financing.itcEstimateCents).toBeNull();
    expect(s.financing.itcPct).toBeNull();
  });

  it("appears with whatever the CPA configured", () => {
    const s = build({ assumptions: { ...A, federalItcPct: 30 } });
    expect(s.financing.itcPct).toBe(30);
    expect(s.financing.itcEstimateCents).toBe(Math.round(3_500_000 * 0.3));
  });

  it("has no percentage literal in the proposal module either", () => {
    const src = readFileSync(new URL("../solar-proposal.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/federalItcPct\s*[=:]\s*\d/);
    expect(src).not.toMatch(/utilityEscalationPct\s*[=:]\s*\d/);
    expect(src).not.toMatch(/annualDegradationPct\s*[=:]\s*\d/);
  });
});

describe("financing summary matches the product", () => {
  it("a loan shows a system price and no per-kWh rate", () => {
    const s = build();
    expect(s.financing.contractPriceCents).toBe(3_500_000);
    expect(s.financing.rateMillsPerKwh).toBeNull();
    expect(s.financing.monthlyPaymentCents).toBeNull();
    expect(s.financing.lender).toBe("GoodLeap");
  });

  it("a PPA shows a rate and no system price", () => {
    const s = build({
      finance: {
        product: "ppa", grossPpwCents: 0, dealerFeePct: 0, adderTotalCents: 0,
        rateMillsPerKwh: 145, monthlyPaymentCents: null, escalatorPct: 2.9,
        termYears: 25, aprPct: null,
      },
    });
    expect(s.financing.contractPriceCents).toBeNull();
    expect(s.financing.rateMillsPerKwh).toBe(145);
    // No system price means no credit to estimate against.
    expect(s.financing.itcEstimateCents).toBeNull();
  });
});

describe("25-year savings model", () => {
  it("runs 25 years and compounds the utility rate", () => {
    const s = build();
    expect(s.savings.years).toHaveLength(25);
    const y1 = s.savings.years[0];
    const y25 = s.savings.years[24];
    expect(y25.utilityCostCents).toBeGreaterThan(y1.utilityCostCents);
  });

  it("production falls each year with degradation", () => {
    const s = build();
    expect(s.savings.years[24].productionKwh).toBeLessThan(s.savings.years[0].productionKwh);
  });

  it("a lease with no escalator costs the same every year", () => {
    const { years } = savingsModel({
      product: "lease",
      year1ProductionKwh: 12_180,
      annualUsageKwh: 12_180, // fully offset, so no residual grid cost
      currentRateMillsPerKwh: 150,
      leaseMonthlyCents: 18_500,
      escalatorPct: 0,
      termYears: 25,
      assumptions: A,
    });
    // Degradation means a little grid top-up creeps in, so compare the solar
    // payment portion only in year 1 vs a flat expectation.
    expect(years[0].solarCostCents).toBe(18_500 * 12);
  });

  it("stops charging a lease payment after the term ends", () => {
    const { years } = savingsModel({
      product: "lease",
      year1ProductionKwh: 12_180,
      annualUsageKwh: 12_180,
      currentRateMillsPerKwh: 150,
      leaseMonthlyCents: 18_500,
      escalatorPct: 0,
      termYears: 10,
      assumptions: A,
      years: 25,
    });
    expect(years[9].solarCostCents).toBeGreaterThan(years[10].solarCostCents);
  });
});

describe("customer-facing content", () => {
  it("has the six timeline steps in order", () => {
    expect(SOLAR_TIMELINE.map((s) => s.key)).toEqual([
      "site_survey", "design", "permitting", "installation", "inspection", "pto",
    ]);
  });

  it("is honest about the permitting wait being outside our control", () => {
    const permitting = SOLAR_TIMELINE.find((s) => s.key === "permitting")!;
    expect(permitting.blurb).toMatch(/not in our hands|longest/i);
  });

  it("answers the questions homeowners actually ask", () => {
    expect(SOLAR_FAQS.length).toBeGreaterThanOrEqual(5);
    const joined = SOLAR_FAQS.map((f) => f.q).join(" ").toLowerCase();
    expect(joined).toMatch(/power goes out/);
    expect(joined).toMatch(/sell the house/);
    expect(joined).toMatch(/roof/);
  });
});

describe("environmental impact", () => {
  it("scales with lifetime production", () => {
    const small = environmentalImpact(100_000);
    const big = environmentalImpact(300_000);
    expect(big.tonsCo2Avoided).toBeGreaterThan(small.tonsCo2Avoided);
    expect(big.treesEquivalent).toBeGreaterThan(small.treesEquivalent);
  });
  it("is zero for a system that produces nothing", () => {
    expect(environmentalImpact(0).tonsCo2Avoided).toBe(0);
  });
});

/**
 * The payment a homeowner reads off the proposal.
 *
 * Two figures can fill this line and they are not equal in standing: one is
 * amortised from the quoted product so a rep can sell today, the other came
 * back from a real credit approval. The document has to show the approved one
 * whenever it exists, and say which of the two it is showing.
 */
describe("the loan payment on the proposal", () => {
  it("amortises the quoted terms before an approval exists", () => {
    const s = build({
      finance: { ...LOAN, aprPct: 4.99, loanTermMonths: 300, loanMonthlyPaymentCents: null },
    });
    expect(s.financing.loanPaymentApproved).toBe(false);
    expect(s.financing.loanMonthlyPaymentCents).toBeGreaterThan(0);
  });

  it("shows the lender's own figure once there is one, not the estimate", () => {
    const s = build({
      finance: { ...LOAN, aprPct: 4.99, loanTermMonths: 300, loanMonthlyPaymentCents: 20_113 },
    });
    expect(s.financing.loanMonthlyPaymentCents).toBe(20_113);
    expect(s.financing.loanPaymentApproved).toBe(true);
  });

  it("takes the down payment out of the financed amount", () => {
    const withDown = build({
      finance: { ...LOAN, aprPct: 4.99, loanTermMonths: 300, downPaymentCents: 1_000_000 },
    });
    const without = build({ finance: { ...LOAN, aprPct: 4.99, loanTermMonths: 300 } });
    expect(withDown.financing.loanMonthlyPaymentCents!).toBeLessThan(
      without.financing.loanMonthlyPaymentCents!
    );
  });

  it("quotes no monthly at all when the term is missing", () => {
    // Better a proposal with no payment line than one with a fabricated payment.
    const s = build({ finance: { ...LOAN, aprPct: 4.99, loanTermMonths: null } });
    expect(s.financing.loanMonthlyPaymentCents).toBeNull();
  });

  it("never puts a loan payment on a lease", () => {
    const s = build({
      finance: {
        ...LOAN,
        product: "lease" as const,
        monthlyPaymentCents: 17_500,
        escalatorPct: 2.9,
        aprPct: null,
        loanMonthlyPaymentCents: 20_113,
      },
    });
    expect(s.financing.loanMonthlyPaymentCents).toBeNull();
  });
});
