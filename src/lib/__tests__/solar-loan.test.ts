import { describe, it, expect } from "vitest";
import {
  factorQuote,
  factorMonthlyCents,
  factorFromMicros,
  factorToMicros,
  formatFactor,
  hasPaymentFactor,
  type PaymentFactors,
} from "../solar-loan";
import { loanPaymentCents } from "../solar-money";

const program: PaymentFactors = {
  factorWithPaydownMicros: 5712, // 0.005712
  factorWithoutPaydownMicros: 8140, // 0.008140
  paydownPct: 30,
  paydownMonths: 18,
};

describe("factor conversion", () => {
  it("round-trips the decimal a rate sheet prints", () => {
    expect(factorToMicros(0.005712)).toBe(5712);
    expect(factorFromMicros(5712)).toBeCloseTo(0.005712, 9);
    expect(formatFactor(5712)).toBe("0.005712");
  });

  it("keeps null as null in both directions", () => {
    expect(factorToMicros(null)).toBeNull();
    expect(factorFromMicros(null)).toBeNull();
    expect(formatFactor(null)).toBe("");
  });

  it("does not lose the sixth decimal to floating point", () => {
    // The reason factors are integers at all.
    expect(factorToMicros(0.000001)).toBe(1);
    expect(factorToMicros(0.0123456)).toBe(12346);
  });
});

describe("factorQuote", () => {
  it("multiplies the financed amount by each factor", () => {
    const q = factorQuote(program, 5_000_000); // $50,000
    expect(q.withPaydownMonthlyCents).toBe(28_560); // $285.60
    expect(q.withoutPaydownMonthlyCents).toBe(40_700); // $407.00
  });

  it("computes the paydown the program expects", () => {
    const q = factorQuote(program, 5_000_000);
    expect(q.paydownCents).toBe(1_500_000); // 30% of $50,000
    expect(q.paydownMonths).toBe(18);
  });

  it("returns nulls, not $0, when the deal is not priced yet", () => {
    // "$0/mo" in front of a rep reads as a real quote; a blank does not.
    const q = factorQuote(program, 0);
    expect(q.withPaydownMonthlyCents).toBeNull();
    expect(q.withoutPaydownMonthlyCents).toBeNull();
    expect(q.paydownCents).toBeNull();
  });

  it("never invents a factor for a program that has none", () => {
    const none: PaymentFactors = { paydownPct: null, paydownMonths: null };
    expect(hasPaymentFactor(none)).toBe(false);
    const q = factorQuote(none, 5_000_000);
    expect(factorMonthlyCents(q)).toBeNull();
  });

  it("carries no paydown when the program has none", () => {
    const flat: PaymentFactors = { ...program, paydownPct: null, paydownMonths: null };
    const q = factorQuote(flat, 5_000_000);
    expect(q.paydownCents).toBeNull();
    expect(q.withPaydownMonthlyCents).toBe(28_560);
  });

  it("clamps a negative amount rather than quoting a negative payment", () => {
    const q = factorQuote(program, -100_000);
    expect(q.amountFinancedCents).toBe(0);
    expect(q.withPaydownMonthlyCents).toBeNull();
  });
});

describe("a factor is not an amortisation", () => {
  it("differs from the amortised figure for the same APR and term", () => {
    // This is the whole reason factors are stored rather than derived: the
    // sheet's factor bakes in the dealer fee and the promotional structure,
    // so amortising APR + term produces a DIFFERENT payment. Quoting the
    // derived one when the lender published a factor misquotes the customer.
    const amortised = loanPaymentCents({
      principalCents: 5_000_000,
      aprPct: 3.99,
      termMonths: 300,
    });
    const fromFactor = factorMonthlyCents(factorQuote(program, 5_000_000));
    expect(amortised).not.toBeNull();
    expect(fromFactor).toBe(28_560);
    expect(fromFactor).not.toBe(amortised);
  });
});

describe("factorMonthlyCents", () => {
  it("quotes the underwritten payment — the with-paydown one", () => {
    expect(factorMonthlyCents(factorQuote(program, 5_000_000))).toBe(28_560);
  });

  it("falls back to the without-paydown factor when it is the only one", () => {
    const only: PaymentFactors = { ...program, factorWithPaydownMicros: null };
    expect(factorMonthlyCents(factorQuote(only, 5_000_000))).toBe(40_700);
  });
});
