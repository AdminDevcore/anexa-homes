/**
 * Payment factors — what a solar lender actually publishes.
 *
 * A rate sheet quotes a PAYMENT FACTOR rather than expecting the dealer to
 * amortise: monthly payment = amount financed × factor. The factor already
 * carries the term, the dealer fee and whatever promotional structure the
 * program has, so it does NOT generally equal the amortised figure that
 * `loanPaymentCents` derives from APR and term.
 *
 * That difference is the whole reason this file exists, and it sets the order
 * of precedence for the payment a customer is quoted:
 *
 *   1. `SolarFinance.loanMonthlyPaymentCents` — the lender's figure from a real
 *      approval. Always wins.
 *   2. The payment factor here — the lender's own published number for this
 *      program, before any approval exists.
 *   3. `loanPaymentCents` — our amortised estimate, for a program whose sheet
 *      quotes an APR and no factor.
 *
 * Nothing here derives a factor. If a program has none on file, the payment
 * comes back null and the caller falls through to (3).
 *
 * Most programs quote two factors. The lower assumes the borrower applies a
 * paydown — usually the federal credit — by a set month; the higher is what the
 * payment becomes if they never do. Both are shown, never just the flattering
 * one.
 */

export type PaymentFactors = {
  /** Payment factor in millionths. 5712 = 0.005712 per dollar financed. */
  factorWithPaydownMicros?: number | null;
  factorWithoutPaydownMicros?: number | null;
  paydownPct?: number | null;
  paydownMonths?: number | null;
};

export const MICROS = 1_000_000;

/** Millionths back to the decimal a rate sheet prints. Null stays null. */
export function factorFromMicros(m: number | null | undefined): number | null {
  return m == null ? null : m / MICROS;
}

/** The decimal a rep types, as millionths. */
export function factorToMicros(f: number | null | undefined): number | null {
  return f == null ? null : Math.round(f * MICROS);
}

/** "0.005712" — the way a rate sheet writes it. Blank when unset. */
export function formatFactor(micros: number | null | undefined): string {
  const f = factorFromMicros(micros);
  return f == null ? "" : f.toFixed(6);
}

/** True when this program prices by factor at all. */
export function hasPaymentFactor(p: PaymentFactors): boolean {
  return p.factorWithPaydownMicros != null || p.factorWithoutPaydownMicros != null;
}

export type FactorQuote = {
  amountFinancedCents: number;
  /** Payment if the paydown IS applied, cents. Null when no factor is on file. */
  withPaydownMonthlyCents: number | null;
  /** Payment if it is NOT, cents. Null when no factor is on file. */
  withoutPaydownMonthlyCents: number | null;
  /** The lump sum the program expects, cents. Null when it has no paydown. */
  paydownCents: number | null;
  paydownPct: number | null;
  paydownMonths: number | null;
};

/**
 * What one program's factors cost on one amount.
 *
 * `amountFinancedCents` is the contract price less anything the customer puts
 * down — never the gross, because a down payment is not borrowed and applying
 * the factor to it would quote a payment on money nobody owes.
 *
 * A zero or negative amount returns nulls rather than a $0 payment: it means
 * the deal is not priced yet, and "$0/mo" in front of a rep reads as a real
 * quote in a way a blank never does.
 */
export function factorQuote(p: PaymentFactors, amountFinancedCents: number): FactorQuote {
  const amount = Math.max(0, Math.round(amountFinancedCents));
  const priced = amount > 0;
  const at = (micro: number | null | undefined) =>
    !priced || micro == null ? null : Math.round((amount * micro) / MICROS);

  return {
    amountFinancedCents: amount,
    withPaydownMonthlyCents: at(p.factorWithPaydownMicros),
    withoutPaydownMonthlyCents: at(p.factorWithoutPaydownMicros),
    paydownCents:
      priced && p.paydownPct != null ? Math.round((amount * p.paydownPct) / 100) : null,
    paydownPct: p.paydownPct ?? null,
    paydownMonths: p.paydownMonths ?? null,
  };
}

/**
 * The payment to quote from the factors when only one number fits.
 *
 * The WITH-paydown figure, because that is what the program is underwritten at
 * and what the lender's approval will state. The higher figure is never hidden
 * — every renderer using this also shows what happens if the paydown is skipped
 * — but it is not the headline.
 */
export function factorMonthlyCents(q: FactorQuote): number | null {
  return q.withPaydownMonthlyCents ?? q.withoutPaydownMonthlyCents;
}
