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

  it("writes a zero credit, because no incentive is quoted anywhere", () => {
    // The column is only still written to satisfy its NOT NULL default; there
    // is no configuration that can turn it into a number.
    expect(financeRowForProduct({ product: "cash" }, CTX).itcEstimateCents).toBe(0);
    expect(financeRowForProduct({ product: "loan" }, CTX).itcEstimateCents).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Lender products
// ---------------------------------------------------------------------------

const LOAN_PRODUCT = {
  id: "prod-loan",
  product: "loan" as const,
  aprPct: 4.99,
  termMonths: 300,
  dealerFeePct: 18,
  leaseRateCentsPerKwMonth: null,
  rateMillsPerKwh: null,
  escalatorPct: null,
  termYears: null,
};

const PPA_PRODUCT = {
  id: "prod-ppa",
  product: "ppa" as const,
  aprPct: null,
  termMonths: null,
  dealerFeePct: null,
  leaseRateCentsPerKwMonth: null,
  rateMillsPerKwh: 145,
  escalatorPct: 2.9,
  termYears: 25,
};

const LEASE_PRODUCT = {
  id: "prod-lease",
  product: "lease" as const,
  aprPct: null,
  termMonths: null,
  dealerFeePct: null,
  leaseRateCentsPerKwMonth: 1240,
  rateMillsPerKwh: null,
  escalatorPct: 2.9,
  termYears: 25,
};

/**
 * A quoted product is a rate sheet, so its terms are the terms. What the client
 * sent for those particular fields is ignored — otherwise the catalogue would
 * be a suggestion and every deal could carry an APR no lender ever offered.
 */
describe("financeRowForProduct with a lender product", () => {
  it("takes the loan's terms from the product, not from the form", () => {
    const row = financeRowForProduct(
      { product: "loan", aprPct: 1.99, loanTermMonths: 60, dealerFeePct: 0 },
      { ...CTX, lenderProduct: LOAN_PRODUCT }
    );
    expect(row.aprPct).toBe(4.99);
    expect(row.loanTermMonths).toBe(300);
    expect(row.dealerFeePct).toBe(18);
    expect(row.lenderProductId).toBe("prod-loan");
  });

  it("derives the sticker from the net target and the product's fee", () => {
    // 287 net at an 18% fee has to sticker at 350.
    const row = financeRowForProduct(
      { product: "loan" },
      { ...CTX, lenderProduct: LOAN_PRODUCT, targetNetPpwCents: 287 }
    );
    expect(row.grossPpwCents).toBe(350);
  });

  it("lets a typed price beat the derived one", () => {
    // Overriding has to mean something. Saving 350 over a rep's 375 without
    // saying so is worse than not offering the field.
    const row = financeRowForProduct(
      { product: "loan", grossPpwCents: 375 },
      { ...CTX, lenderProduct: LOAN_PRODUCT, targetNetPpwCents: 287 }
    );
    expect(row.grossPpwCents).toBe(375);
  });

  it("leaves the sticker as typed when no net target is set", () => {
    const row = financeRowForProduct(
      { product: "loan", grossPpwCents: 365 },
      { ...CTX, lenderProduct: LOAN_PRODUCT }
    );
    expect(row.grossPpwCents).toBe(365);
  });

  it("turns a lease product's per-kW rate into this system's monthly", () => {
    // $12.40/kW-month on a 10 kW system is $124.00.
    const row = financeRowForProduct(
      { product: "lease", monthlyPaymentCents: 1 },
      { ...CTX, lenderProduct: LEASE_PRODUCT }
    );
    expect(row.monthlyPaymentCents).toBe(12_400);
    expect(row.escalatorPct).toBe(2.9);
    expect(row.termYears).toBe(25);
  });

  it("takes a PPA's rate and escalator from the product", () => {
    const row = financeRowForProduct(
      { product: "ppa", rateMillsPerKwh: 999, escalatorPct: 9 },
      { ...CTX, lenderProduct: PPA_PRODUCT }
    );
    expect(row.rateMillsPerKwh).toBe(145);
    expect(row.escalatorPct).toBe(2.9);
    expect(row.termYears).toBe(25);
  });

  it("ignores a product of the wrong type rather than mixing the two", () => {
    // The rep switched product after choosing; a PPA rate must never reach a
    // loan row, and the stale pointer must not survive either.
    const row = financeRowForProduct(
      { product: "loan", aprPct: 3.5, loanTermMonths: 120 },
      { ...CTX, lenderProduct: PPA_PRODUCT }
    );
    expect(row.lenderProductId).toBeNull();
    expect(row.rateMillsPerKwh).toBeNull();
    expect(row.aprPct).toBe(3.5);
  });

  it("never carries a product onto a cash deal", () => {
    // Cash has no lender, so it can have no lender product.
    const row = financeRowForProduct({ product: "cash" }, { ...CTX, lenderProduct: LOAN_PRODUCT });
    expect(row.lenderProductId).toBeNull();
    expect(row.dealerFeePct).toBe(0);
    expect(row.aprPct).toBeNull();
  });

  it("keeps the approved monthly payment, which is not the product's to set", () => {
    // The product prices an ESTIMATE; this figure came back from a real credit
    // approval and outranks it.
    const row = financeRowForProduct(
      { product: "loan", loanMonthlyPaymentCents: 20_113 },
      { ...CTX, lenderProduct: LOAN_PRODUCT }
    );
    expect(row.loanMonthlyPaymentCents).toBe(20_113);
  });
});
