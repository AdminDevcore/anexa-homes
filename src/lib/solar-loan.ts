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

import { loanPaymentCents } from "@/lib/solar-money";

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

/**
 * WHAT ONE PROGRAMME'S TERMS ASK FOR ON A GIVEN PRINCIPAL.
 *
 * A deal now quotes a payment on TWO principals — the contract the household
 * signs, and what is left of it once the federal credits are against the loan —
 * and the second one is only honest if it comes off the same rate sheet as the
 * first. Derived any other way (a ratio of the headline, a fresh amortisation
 * that ignores a published factor) the two figures imply two different loans on
 * one screen, which is the failure this file already exists to prevent.
 *
 * The precedence is the one every payment on this product uses:
 *   1. the rate sheet's published payment factor — it bakes in the dealer fee
 *      and the promotional structure, so it does not equal (2)
 *   2. our amortisation of the quoted APR and term
 *
 * Null on a principal of nothing: no money owed is not a payment of zero, it is
 * no payment at all. `solar-proposal.ts` keeps its own copy of this because it
 * has a third source above both — a real approval, scaled — that belongs to a
 * generated document and to nothing else.
 */
export function programmeMonthlyCents(
  terms: PaymentFactors & { aprPct: number | null; termMonths: number | null },
  principalCents: number
): number | null {
  const principal = Math.round(principalCents);
  if (principal <= 0) return null;

  if (hasPaymentFactor(terms)) {
    const m = factorMonthlyCents(factorQuote(terms, principal));
    if (m != null) return m;
  }

  return loanPaymentCents({
    principalCents: principal,
    aprPct: terms.aprPct,
    termMonths: terms.termMonths,
  });
}

/**
 * Whether a quoted monthly payment was worked out from the money the customer
 * actually owes.
 *
 * The failure this exists to catch is a payment amortised from a DIFFERENT
 * PRINCIPAL than the one the document says is being financed — a page quoting
 * $328.89 a month on a balance the household is told is $48,400.
 *
 * A RATIO TO THE PRINCIPAL CANNOT SEPARATE THOSE, which is why this reads the
 * terms as well. $328.89 over 360 months is 2.4x a $48,400 principal, and a
 * perfectly ordinary thirty-year loan at 10% is 3.2x — so any bound wide enough
 * to admit the real loan admits the mistake. Measured against the STATED APR
 * and term the two separate cleanly: at 0% the most those terms can ask for is
 * $134.44, and $328.89 is two and a half times a figure that has no interest in
 * it to be explained by.
 *
 * A COARSE GUARD, deliberately, and not a re-derivation of the lender's own
 * arithmetic. A published payment factor carries a dealer fee and a promotional
 * structure and legitimately comes out above a straight amortisation of the
 * same principal — which is exactly why the factor outranks it everywhere else
 * — so the ceiling leaves a third of headroom above the amortised figure. What
 * it will not admit is a payment taken from a different principal altogether.
 *
 * THE PAYDOWN IS SUBTRACTED FIRST. On a programme structured around one, the
 * quoted monthly is the WITH-paydown figure and repays the principal less the
 * paydown — so a floor measured against the whole principal would reject every
 * such product. Null paydown, which is most of them, subtracts nothing.
 *
 * Null `monthlyCents` is not a failure: a cash deal has no payment, and a loan
 * with no quotable terms is caught by its own rule rather than by this one.
 */
export function monthlyReconciles(input: {
  financedAmountCents: number;
  aprPct?: number | null;
  termMonths: number | null | undefined;
  monthlyCents: number | null | undefined;
  /** The lump the quoted payment assumes will be applied. Usually none. */
  paydownCents?: number | null;
}): boolean {
  const monthly = input.monthlyCents;
  const term = input.termMonths;
  if (monthly == null) return true;
  if (!term || term <= 0) return true;

  const financed = input.financedAmountCents;
  if (financed <= 0) return monthly <= 0;

  // What the quoted payment is actually repaying.
  const paydown = Math.max(0, Math.min(input.paydownCents ?? 0, financed));
  const repaid = financed - paydown;
  if (repaid <= 0) return true;

  // THE FLOOR: a payment cannot repay less than the money it is repaying.
  // A tenth of slack for the re-amortisation a paydown causes mid-term.
  if (monthly * term < repaid * 0.9) return false;

  // THE CEILING: what these terms, on this principal, can honestly cost — plus
  // a third for a factor's fee and structure. A dollar of absolute slack keeps
  // a tiny principal from failing on rounding alone.
  const amortised = loanPaymentCents({
    principalCents: repaid,
    aprPct: input.aprPct ?? 0,
    termMonths: term,
  });
  if (amortised == null) return true;
  return monthly <= amortised * 1.35 + 100;
}
