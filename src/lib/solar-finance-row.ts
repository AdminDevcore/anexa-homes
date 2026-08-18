import type { FinanceProduct } from "@prisma/client";
import { pricePurchase, itcEstimateCents, type SolarAssumptions } from "./solar-money";

/**
 * What actually gets written to SolarFinance for a given product.
 *
 * Extracted from the save action and made pure so the rule that matters here
 * can be tested exhaustively, product by product.
 *
 * THE RULE: every product-specific column is gated on the product. Not most of
 * them — all of them.
 *
 * The defect this exists to prevent: `aprPct`, `loanTermMonths` and `termYears`
 * used to be written through unconditionally while the rate and loan blocks were
 * gated. Switching a deal from Loan to Lease therefore left the lender's APR
 * sitting on the row, and the customer-facing proposal renders an APR whenever
 * one is present — so a homeowner was one product switch away from being quoted
 * an interest rate on a lease, which has none.
 *
 * `?? ` (not `||`) throughout: a legitimate ZERO — a 0% escalator, a $0 down
 * payment — is a real value and must not collapse into "unset".
 */
export type FinanceInput = {
  product: FinanceProduct;
  grossPpwCents?: number;
  dealerFeePct?: number;
  adderTotalCents?: number;
  rateMillsPerKwh?: number | null;
  monthlyPaymentCents?: number | null;
  escalatorPct?: number | null;
  termYears?: number | null;
  aprPct?: number | null;
  loanTermMonths?: number | null;
  downPaymentCents?: number | null;
  loanMonthlyPaymentCents?: number | null;
};

export type FinanceRow = {
  product: FinanceProduct;
  grossPpwCents: number;
  dealerFeePct: number;
  adderTotalCents: number;
  contractPriceCents: number;
  itcEstimateCents: number;
  rateMillsPerKwh: number | null;
  monthlyPaymentCents: number | null;
  escalatorPct: number | null;
  termYears: number | null;
  aprPct: number | null;
  loanTermMonths: number | null;
  downPaymentCents: number | null;
  loanMonthlyPaymentCents: number | null;
};

export function financeRowForProduct(
  f: FinanceInput,
  ctx: { systemSizeKwDc: number; assumptions: SolarAssumptions }
): FinanceRow {
  const { assumptions } = ctx;
  const isPurchase = f.product === "cash" || f.product === "loan";
  const isLoan = f.product === "loan";
  const isThirdParty = f.product === "lease" || f.product === "ppa";

  // Cash has no lender, so it can never carry a dealer fee.
  const dealerFeePct = isLoan ? (f.dealerFeePct ?? assumptions.defaultDealerFeePct) : 0;

  let contractPriceCents = 0;
  let itcCents = 0;
  if (isPurchase) {
    const breakdown = pricePurchase({
      product: f.product as "cash" | "loan",
      systemSizeKwDc: ctx.systemSizeKwDc,
      grossPpwCents: f.grossPpwCents ?? assumptions.defaultGrossPpwCents,
      dealerFeePct,
      adderTotalCents: f.adderTotalCents ?? 0,
    });
    contractPriceCents = breakdown.contractPriceCents;
    itcCents = itcEstimateCents(contractPriceCents, assumptions);
  }

  return {
    product: f.product,
    // Purchase block — zeroed for lease/PPA so nothing stale leaks onto a
    // third-party-owned proposal.
    grossPpwCents: isPurchase ? (f.grossPpwCents ?? assumptions.defaultGrossPpwCents) : 0,
    dealerFeePct,
    adderTotalCents: isPurchase ? (f.adderTotalCents ?? 0) : 0,
    contractPriceCents,
    itcEstimateCents: itcCents,
    // Rate block — each figure belongs to exactly one product.
    rateMillsPerKwh: f.product === "ppa" ? (f.rateMillsPerKwh ?? null) : null,
    monthlyPaymentCents: f.product === "lease" ? (f.monthlyPaymentCents ?? null) : null,
    escalatorPct: isThirdParty ? (f.escalatorPct ?? null) : null,
    // Term-in-years belongs to the third-party products. A loan's term is
    // `loanTermMonths`; carrying both invites the proposal to print whichever
    // it finds first.
    termYears: isThirdParty ? (f.termYears ?? null) : null,
    // Loan block — nulled for every other product.
    aprPct: isLoan ? (f.aprPct ?? null) : null,
    loanTermMonths: isLoan ? (f.loanTermMonths ?? null) : null,
    downPaymentCents: isLoan ? (f.downPaymentCents ?? null) : null,
    loanMonthlyPaymentCents: isLoan ? (f.loanMonthlyPaymentCents ?? null) : null,
  };
}
