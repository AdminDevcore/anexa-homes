import { describe, it, expect } from "vitest";
import { financeRowForProduct } from "@/lib/solar-finance-row";
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

const CTX = { systemSizeKwDc: 10, assumptions: A };

/**
 * Everything a rep could have typed before switching products. If a product
 * switch is going to strand a stale figure on the row, it will do it from here.
 */
const EVERYTHING = {
  grossPpwCents: 350,
  dealerFeePct: 18,
  adderTotalCents: 385_000,
  rateMillsPerKwh: 145,
  monthlyPaymentCents: 17_500,
  escalatorPct: 2.9,
  termYears: 25,
  aprPct: 6.99,
  loanTermMonths: 300,
  downPaymentCents: 500_000,
  loanMonthlyPaymentCents: 27_400,
};

describe("switching financing product cannot strand an incompatible figure", () => {
  it("a LEASE keeps only its own terms — and never a lender's APR", () => {
    // The defect: aprPct/loanTermMonths/termYears were written through
    // unconditionally, so Loan -> Lease left 6.99% APR on the row and the
    // customer-facing proposal renders an APR whenever one is present.
    const row = financeRowForProduct({ product: "lease", ...EVERYTHING }, CTX);

    expect(row.monthlyPaymentCents).toBe(17_500);
    expect(row.escalatorPct).toBe(2.9);
    expect(row.termYears).toBe(25);

    expect(row.aprPct).toBeNull();
    expect(row.loanTermMonths).toBeNull();
    expect(row.downPaymentCents).toBeNull();
    expect(row.loanMonthlyPaymentCents).toBeNull();
    // A lease is billed monthly, not per kWh.
    expect(row.rateMillsPerKwh).toBeNull();
    // No system price on a third-party-owned system.
    expect(row.grossPpwCents).toBe(0);
    expect(row.contractPriceCents).toBe(0);
    expect(row.dealerFeePct).toBe(0);
  });

  it("a PPA keeps its rate and never a fixed monthly", () => {
    const row = financeRowForProduct({ product: "ppa", ...EVERYTHING }, CTX);
    expect(row.rateMillsPerKwh).toBe(145);
    expect(row.escalatorPct).toBe(2.9);
    expect(row.termYears).toBe(25);
    expect(row.monthlyPaymentCents).toBeNull();
    expect(row.aprPct).toBeNull();
    expect(row.contractPriceCents).toBe(0);
  });

  it("CASH keeps a price and nothing that implies a lender", () => {
    const row = financeRowForProduct({ product: "cash", ...EVERYTHING }, CTX);
    // 10 kW × $3.50/W = $35,000, plus the $3,850 adder.
    expect(row.contractPriceCents).toBe(10_000 * 350 + 385_000);
    expect(row.dealerFeePct).toBe(0); // no lender, so no fee — ever
    expect(row.aprPct).toBeNull();
    expect(row.loanTermMonths).toBeNull();
    expect(row.downPaymentCents).toBeNull();
    expect(row.loanMonthlyPaymentCents).toBeNull();
    expect(row.monthlyPaymentCents).toBeNull();
    expect(row.escalatorPct).toBeNull();
    expect(row.termYears).toBeNull();
    expect(row.rateMillsPerKwh).toBeNull();
  });

  it("a LOAN keeps the lender's figures and none of the lease's", () => {
    const row = financeRowForProduct({ product: "loan", ...EVERYTHING }, CTX);
    expect(row.aprPct).toBe(6.99);
    expect(row.loanTermMonths).toBe(300);
    expect(row.downPaymentCents).toBe(500_000);
    expect(row.loanMonthlyPaymentCents).toBe(27_400);
    expect(row.dealerFeePct).toBe(18);

    // termYears is the LEASE's field; a loan's term is in months.
    expect(row.termYears).toBeNull();
    expect(row.escalatorPct).toBeNull();
    expect(row.monthlyPaymentCents).toBeNull();
    expect(row.rateMillsPerKwh).toBeNull();
  });

  it("round-trips a full Loan -> Lease -> Loan switch without leaking", () => {
    const asLoan = financeRowForProduct({ product: "loan", ...EVERYTHING }, CTX);
    // The rep switches to a lease. Whatever the form still holds, the ROW must
    // not carry the loan's terms forward.
    // `product` AFTER the spread: asLoan carries product:"loan", and spreading
    // it over the literal would quietly re-run the loan branch.
    const asLease = financeRowForProduct({ ...asLoan, product: "lease" }, CTX);
    expect(asLease.aprPct).toBeNull();
    expect(asLease.loanMonthlyPaymentCents).toBeNull();
    expect(asLease.contractPriceCents).toBe(0);
  });
});

describe("a legitimate zero is a value, not an absence", () => {
  it("keeps a 0% escalator instead of treating it as unset", () => {
    // A 0% escalator is the most customer-friendly lease there is. Collapsing it
    // to null makes the validator report "escalator must be between 0% and 5%"
    // about a lease that had a perfectly valid 0.
    const row = financeRowForProduct(
      { product: "lease", monthlyPaymentCents: 17_500, escalatorPct: 0, termYears: 25 },
      CTX
    );
    expect(row.escalatorPct).toBe(0);
    expect(row.escalatorPct).not.toBeNull();
  });

  it("keeps a $0 down payment on a loan", () => {
    const row = financeRowForProduct(
      { product: "loan", downPaymentCents: 0, aprPct: 0 },
      CTX
    );
    expect(row.downPaymentCents).toBe(0);
    expect(row.aprPct).toBe(0);
  });
});

describe("defaults come from settings, never from a constant", () => {
  it("falls back to the company's PPW and dealer fee when none is given", () => {
    const row = financeRowForProduct({ product: "loan" }, CTX);
    expect(row.grossPpwCents).toBe(A.defaultGrossPpwCents);
    expect(row.dealerFeePct).toBe(A.defaultDealerFeePct);
  });

  it("shows no federal credit at all when the company has not configured one", () => {
    const row = financeRowForProduct({ product: "cash" }, CTX);
    expect(row.itcEstimateCents).toBe(0);

    const configured = financeRowForProduct(
      { product: "cash" },
      { ...CTX, assumptions: { ...A, federalItcPct: 30 } }
    );
    expect(configured.itcEstimateCents).toBe(Math.round(configured.contractPriceCents * 0.3));
  });
});
