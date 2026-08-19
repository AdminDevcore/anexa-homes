import { describe, it, expect } from "vitest";
import { loanPaymentCents, grossPpwFromNet } from "@/lib/solar-money";
import { lenderProductLabel } from "@/lib/solar-lender-product";

/**
 * The two figures a lender product has to produce: what the customer pays each
 * month, and what we therefore have to charge to keep our margin.
 *
 * Both are quoted to a homeowner and both are checked against a lender's own
 * rate sheet, so the expected values here are computed from the standard
 * amortisation formula rather than from what the implementation happens to
 * return.
 */
describe("loanPaymentCents", () => {
  it("amortises a normal loan", () => {
    // $34,200 at 4.99% over 300 months. Textbook: P·r / (1 − (1+r)^−n),
    // r = 0.0499/12 → $199.73/mo, $59,919 repaid over the term.
    const p = loanPaymentCents({ principalCents: 3_420_000, aprPct: 4.99, termMonths: 300 });
    expect(p).toBe(19_973);
  });

  it("splits the principal evenly at 0% APR instead of dividing by zero", () => {
    // The interest-free promotional case is real, and r = 0 makes the standard
    // formula 0/0.
    expect(loanPaymentCents({ principalCents: 1_200_000, aprPct: 0, termMonths: 120 })).toBe(10_000);
  });

  it("treats a missing APR as 0%", () => {
    expect(loanPaymentCents({ principalCents: 1_200_000, aprPct: null, termMonths: 120 })).toBe(10_000);
  });

  it("returns null rather than a number when the terms cannot produce one", () => {
    // A payment of Infinity or NaN rendered to a customer is worse than no
    // payment at all, so every degenerate input declines to answer.
    expect(loanPaymentCents({ principalCents: 3_420_000, aprPct: 4.99, termMonths: 0 })).toBeNull();
    expect(loanPaymentCents({ principalCents: 3_420_000, aprPct: 4.99, termMonths: null })).toBeNull();
    expect(loanPaymentCents({ principalCents: 0, aprPct: 4.99, termMonths: 300 })).toBeNull();
    expect(loanPaymentCents({ principalCents: -100, aprPct: 4.99, termMonths: 300 })).toBeNull();
  });

  it("costs more per month on a shorter term, and less over a longer one", () => {
    const short = loanPaymentCents({ principalCents: 3_420_000, aprPct: 4.99, termMonths: 144 })!;
    const long = loanPaymentCents({ principalCents: 3_420_000, aprPct: 4.99, termMonths: 300 })!;
    expect(short).toBeGreaterThan(long);
  });
});

describe("grossPpwFromNet", () => {
  it("grosses up so the fee comes out of the customer, not the margin", () => {
    // 2.87 net at an 18% fee has to sticker at 3.50: 350 × 0.82 = 287.
    expect(grossPpwFromNet(287, 18)).toBe(350);
  });

  it("raises the sticker when the money gets more expensive", () => {
    // The whole point: 4.99%/18% and 3.99%/28% cannot share a price.
    expect(grossPpwFromNet(287, 28)).toBe(399);
    expect(grossPpwFromNet(287, 28)).toBeGreaterThan(grossPpwFromNet(287, 18)!);
  });

  it("passes the net straight through at a zero fee", () => {
    expect(grossPpwFromNet(287, 0)).toBe(287);
  });

  it("declines a fee of 100% or more instead of returning Infinity", () => {
    // net / (1 − 1) is a division by zero, and above 100% it goes negative —
    // a sticker price of −$4.20/W would be quoted without complaint.
    expect(grossPpwFromNet(287, 100)).toBeNull();
    expect(grossPpwFromNet(287, 120)).toBeNull();
  });

  it("declines a negative fee or a non-positive net", () => {
    expect(grossPpwFromNet(287, -5)).toBeNull();
    expect(grossPpwFromNet(0, 18)).toBeNull();
  });
});

describe("lenderProductLabel", () => {
  it("reads a loan the way a rate sheet does", () => {
    expect(
      lenderProductLabel({ product: "loan", aprPct: 4.99, termMonths: 300, dealerFeePct: 18 })
    ).toBe("25 yr · 4.99% · fee 18%");
  });

  it("keeps months when the term is not whole years", () => {
    expect(lenderProductLabel({ product: "loan", aprPct: 6.99, termMonths: 18, dealerFeePct: 8 })).toBe(
      "18 mo · 6.99% · fee 8%"
    );
  });

  it("prices a PPA per kWh and a lease per kW-month", () => {
    expect(
      lenderProductLabel({ product: "ppa", rateMillsPerKwh: 145, escalatorPct: 2.9, termYears: 25 })
    ).toBe("25 yr · esc 2.9% · $0.145/kWh");
    expect(
      lenderProductLabel({ product: "lease", leaseRateCentsPerKwMonth: 1240, escalatorPct: 2.9, termYears: 25 })
    ).toBe("25 yr · esc 2.9% · $12.40/kW-mo");
  });

  it("shows a zero escalator rather than dropping it", () => {
    // 0% is a selling point, not a missing value.
    expect(
      lenderProductLabel({ product: "ppa", rateMillsPerKwh: 169, escalatorPct: 0, termYears: 25 })
    ).toBe("25 yr · esc 0% · $0.169/kWh");
  });

  it("prefers a name when one was given", () => {
    expect(lenderProductLabel({ product: "loan", name: "Hero 25", aprPct: 4.99 })).toBe("Hero 25");
  });

  it("still renders something for a row with no terms yet", () => {
    expect(lenderProductLabel({ product: "loan" })).toBe("Loan");
  });
});
