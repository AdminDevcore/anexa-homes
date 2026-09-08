import type { FinanceProduct } from "@prisma/client";
import {
  capStickerToFinalPpw,
  pricePurchase,
  grossPpwFromNet,
  leaseMonthlyCents,
  type SolarAssumptions,
  type FinalPpwMode,
} from "./solar-money";

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
  /** The adders INSIDE the partner's price. See `PurchaseInput`. */
  adderTotalCents?: number;
  /** The adders financed ON TOP of it — a roof on a flat-rate partner. */
  onTopAdderTotalCents?: number;
  /**
   * The storage on this job, at its catalogue price, already resolved by
   * `batteryChargeCents`. Rides on top exactly as a roof does, so it is added
   * to the contract below and kept out of the ceiling solve above it.
   */
  batteryPriceCents?: number;
  rateMillsPerKwh?: number | null;
  monthlyPaymentCents?: number | null;
  escalatorPct?: number | null;
  termYears?: number | null;
  aprPct?: number | null;
  loanTermMonths?: number | null;
  downPaymentCents?: number | null;
  loanMonthlyPaymentCents?: number | null;
  lenderProductId?: string | null;
};

/**
 * The terms of one catalogue product, as data.
 *
 * Passed in rather than read here so this file stays pure and testable: the
 * action resolves the row from the database, having checked it belongs to this
 * company and to the lender the design was built for.
 */
export type LenderProductTerms = {
  id: string;
  product: FinanceProduct;
  aprPct: number | null;
  termMonths: number | null;
  dealerFeePct: number | null;
  leaseRateCentsPerKwMonth: number | null;
  rateMillsPerKwh: number | null;
  escalatorPct: number | null;
  termYears: number | null;
  /**
   * The publishing lender's ceiling on the final price per watt, cents. Read
   * off the LENDER, not the programme, and passed down with the terms because
   * it constrains the same number the dealer fee produces.
   */
  maxFinalPpwCents?: number | null;
  /** Whether that figure is a ceiling or the price itself. */
  finalPpwMode?: FinalPpwMode | null;
};

export type FinanceRow = {
  product: FinanceProduct;
  grossPpwCents: number;
  dealerFeePct: number;
  adderTotalCents: number;
  onTopAdderTotalCents: number;
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
  /** Provenance: which catalogue row these terms were taken from. */
  lenderProductId: string | null;
};

export function financeRowForProduct(
  f: FinanceInput,
  ctx: {
    systemSizeKwDc: number;
    assumptions: SolarAssumptions;
    /**
     * The product this deal is quoted from, already resolved and authorised.
     * Its terms WIN over anything the caller sent for the same fields: a rate
     * sheet a rep can edit per deal is not a rate sheet, and the APR a customer
     * is quoted has to be one the lender actually offers.
     */
    lenderProduct?: LenderProductTerms | null;
    /**
     * What the company must keep per watt after the lender's cut, cents. Set,
     * and the sticker is derived from the product's fee instead of typed.
     */
    targetNetPpwCents?: number | null;
  }
): FinanceRow {
  const { assumptions } = ctx;
  const isPurchase = f.product === "cash" || f.product === "loan";
  const isLoan = f.product === "loan";
  const isThirdParty = f.product === "lease" || f.product === "ppa";

  // A product priced for a DIFFERENT product is not a product for this deal.
  // The rep switched after choosing, and letting a PPA's rate through onto a
  // loan row is the same defect this whole file exists to prevent. Cash never
  // carries one: it has no lender.
  const lp =
    ctx.lenderProduct && ctx.lenderProduct.product === f.product && f.product !== "cash"
      ? ctx.lenderProduct
      : null;

  // Cash has no lender, so it can never carry a dealer fee.
  const dealerFeePct = isLoan
    ? (lp?.dealerFeePct ?? f.dealerFeePct ?? assumptions.defaultDealerFeePct)
    : 0;

  // The sticker that leaves the target net after this product's fee.
  //
  // Only when the caller sent NO price. A rep who types one is overriding
  // deliberately, and quietly replacing their number with a derived one is how
  // a screen lies about what it saved — the panel fills the box with this same
  // figure when the product changes, so the two normally agree anyway. Falls
  // back to the typed price for every company that has set no target, which is
  // all of them until somebody does.
  const derivedGrossPpw =
    isPurchase && ctx.targetNetPpwCents != null && f.grossPpwCents == null
      ? grossPpwFromNet(ctx.targetNetPpwCents, dealerFeePct)
      : null;
  const uncappedPpwCents = derivedGrossPpw ?? f.grossPpwCents ?? assumptions.defaultGrossPpwCents;

  // The lender's ceiling, applied last and to the price the rep TYPED as well
  // as to the derived one.
  //
  // Deliberately not exempting a hand-entered price the way the target-net
  // derivation above does. That exemption exists because a rep who types a
  // price is overriding a default, and a default should yield to a person. A
  // maximum is not a default — it is what the partner will fund — and a rep
  // typing $16.23/W into a programme that pays $5.50 has not overridden
  // anything, they have written a contract the lender will send back.
  const cap = isPurchase
    ? capStickerToFinalPpw({
        stickerPpwCents: uncappedPpwCents,
        maxFinalPpwCents: lp?.maxFinalPpwCents ?? null,
        // A FLAT partner overrides the typed price outright rather than only
        // holding it down — see SolarFinalPpwMode. On such a lender the box a
        // rep types in stops being the price of anything the customer sees.
        mode: lp?.finalPpwMode ?? undefined,
        systemSizeKwDc: ctx.systemSizeKwDc,
        dealerFeePct,
        // Only the work the partner's figure is a price FOR. A roof rides on
        // top of it and is added to the contract below.
        adderTotalCents: f.adderTotalCents ?? 0,
      })
    : null;
  const grossPpwCents = cap?.stickerPpwCents ?? uncappedPpwCents;

  let contractPriceCents = 0;
  if (isPurchase) {
    const breakdown = pricePurchase({
      product: f.product as "cash" | "loan",
      systemSizeKwDc: ctx.systemSizeKwDc,
      stickerPpwCents: grossPpwCents,
      dealerFeePct,
      adderTotalCents: f.adderTotalCents ?? 0,
      onTopAdderTotalCents: f.onTopAdderTotalCents ?? 0,
      batteryPriceCents: f.batteryPriceCents ?? 0,
    });
    contractPriceCents = breakdown.contractPriceCents;
  }

  return {
    product: f.product,
    // Purchase block — zeroed for lease/PPA so nothing stale leaks onto a
    // third-party-owned proposal.
    grossPpwCents: isPurchase ? grossPpwCents : 0,
    dealerFeePct,
    adderTotalCents: isPurchase ? (f.adderTotalCents ?? 0) : 0,
    onTopAdderTotalCents: isPurchase ? (f.onTopAdderTotalCents ?? 0) : 0,
    contractPriceCents,
    // No incentive is quoted anywhere, so the column exists only to keep the
    // NOT NULL contract on rows written before incentives were removed.
    itcEstimateCents: 0,
    // Rate block — each figure belongs to exactly one product.
    rateMillsPerKwh: f.product === "ppa" ? (lp?.rateMillsPerKwh ?? f.rateMillsPerKwh ?? null) : null,
    // A lease product prices per kW-month; the row stores this system's actual
    // monthly, which is what every downstream calculation already consumes.
    monthlyPaymentCents:
      f.product === "lease"
        ? (lp?.leaseRateCentsPerKwMonth != null
            ? leaseMonthlyCents(lp.leaseRateCentsPerKwMonth, ctx.systemSizeKwDc)
            : (f.monthlyPaymentCents ?? null))
        : null,
    escalatorPct: isThirdParty ? (lp?.escalatorPct ?? f.escalatorPct ?? null) : null,
    // Term-in-years belongs to the third-party products. A loan's term is
    // `loanTermMonths`; carrying both invites the proposal to print whichever
    // it finds first.
    termYears: isThirdParty ? (lp?.termYears ?? f.termYears ?? null) : null,
    // Loan block — nulled for every other product.
    aprPct: isLoan ? (lp?.aprPct ?? f.aprPct ?? null) : null,
    loanTermMonths: isLoan ? (lp?.termMonths ?? f.loanTermMonths ?? null) : null,
    downPaymentCents: isLoan ? (f.downPaymentCents ?? null) : null,
    // NOT the product's to set. This is the lender's own figure from a real
    // approval, and it outranks anything computed from the rate sheet.
    loanMonthlyPaymentCents: isLoan ? (f.loanMonthlyPaymentCents ?? null) : null,
    lenderProductId: lp?.id ?? null,
  };
}
