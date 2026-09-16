import type { FinanceProduct } from "@prisma/client";
import {
  capStickerToFinalPpw,
  grossPpwFromNet,
  leaseMonthlyCents,
  pricePurchase,
  priceThirdParty,
  type FinalPpwMode,
  type PriceBasis,
} from "@/lib/solar-money";
import {
  factorQuote,
  factorMonthlyCents,
  hasPaymentFactor,
  programmeMonthlyCents,
} from "@/lib/solar-loan";
import { resolveSignToday, type SignTodayMode } from "@/lib/solar-sign-today";
import {
  buildCreditLadder,
  type CreditClaims,
  type CreditRates,
} from "@/lib/solar-credit-ladder";

/**
 * Four ways to pay, priced against each other on one basis.
 *
 * A rep at a kitchen table is not choosing between "a loan" and "a lease" — she
 * is choosing between Amos at 30 years, Amos at 20, Axess and Climate First,
 * and the homeowner wants to know what each one costs. That comparison is only
 * honest if every column is priced from the SAME system, the SAME adders and
 * the SAME net target; the moment one column is quoted at the rep's typed
 * sticker and the next at a derived one, the cheaper column is an artefact.
 *
 * So the basis is passed once and every offer is priced through it. Pure, in
 * cents, no I/O: the browser's live table and anything server-side that later
 * needs the same figures compute them from this one file.
 *
 * Every figure here is an ESTIMATE and is labelled as one wherever it is shown.
 * A real approval's monthly payment outranks all of it — see solar-loan.ts for
 * that order of precedence.
 */

/** The cash column has no lender product behind it, so it needs a stable id. */
export const CASH_OFFER_ID = "cash";

/** One row off a lender's rate sheet, plus who published it. */
export type OfferProduct = {
  id: string;
  lenderId: string;
  lenderName: string;
  label: string;
  product: FinanceProduct;
  aprPct: number | null;
  termMonths: number | null;
  dealerFeePct: number | null;
  leaseRateCentsPerKwMonth: number | null;
  rateMillsPerKwh: number | null;
  escalatorPct: number | null;
  termYears: number | null;
  factorWithPaydownMicros: number | null;
  factorWithoutPaydownMicros: number | null;
  paydownPct: number | null;
  paydownMonths: number | null;
  /**
   * The publishing LENDER's ceiling on what a homeowner signs per watt, fee and
   * adders included. Carried on the programme rather than looked up beside it
   * so that pricing a column needs one object and not two.
   */
  maxFinalPpwCents: number | null;
  /** Whether that figure is that lender's ceiling or its flat price. */
  finalPpwMode: FinalPpwMode;
  /** Which price that figure fixes on THIS programme. Absent reads as `final`. */
  ppwBasis?: PriceBasis;
  /**
   * That lender's sign-today rule, carried for the same reason as the cap —
   * and it has to be per COLUMN rather than per shelf, because two programmes
   * on the same screen can belong to two partners who hand back different
   * money. See `solar-sign-today`.
   */
  signTodayMode: SignTodayMode;
  signTodayFixedCents: number | null;
  signTodayCapPpwCents: number | null;
  isActive: boolean;
};

/** Cash is its own kind of offer: no lender, no rate sheet, no fee. */
export type CashOffer = { kind: "cash" };

export type Offer = OfferProduct | CashOffer;

const isCash = (o: Offer): o is CashOffer => "kind" in o && o.kind === "cash";

export type CompareBasis = {
  systemSizeKwDc: number;
  year1ProductionKwh: number;
  /** The adders INSIDE each partner's price. See `PurchaseInput`. */
  adderTotalCents: number;
  /**
   * The adders financed ON TOP of it — a roof on a flat-rate partner.
   *
   * The same figure on every column, deliberately: whether a roof rides above
   * the price or comes out of it is a property of the WORK, and a comparison
   * that quoted a different job per lender would not be a comparison.
   */
  onTopAdderTotalCents: number;
  /**
   * The storage on this job, at its catalogue price — the same figure on every
   * column, for the same reason the on-top adders are. Whether a column's
   * partner takes its dealer fee on it is that partner's own switch.
   */
  batteryPriceCents?: number;
  downPaymentCents: number;
  /**
   * The deal's base price per watt, cents — what the company charges BEFORE any
   * lender takes its cut. Set on the deal in the System price card, seeded from
   * the company's figure, moved up and down per deal by the rep.
   *
   * Each column's sticker is derived from this and its OWN dealer fee, which is
   * what makes a dearer lender show up as a dearer system rather than as a
   * smaller margin — and what keeps a cash buyer from being charged a fee no
   * bank ever levied. Null only while the box is empty.
   */
  basePpwCents: number | null;
  /** Lease and PPA totals run across the term, so output has to decay. */
  annualDegradationPct: number;
  /**
   * The federal credits this JOB earns, and what the company states them at.
   *
   * On the basis rather than on each offer because they are a fact about the
   * house and its equipment: the same roof in the same census tract earns the
   * same bonus whoever funds it. Absent — a lease-only shelf, a caller that
   * has not wired them — simply means no column quotes an after-credit
   * payment, which is what every column did before 2026-09-08.
   *
   * `signTodayTypedCents` rides along because the ladder's last rung has to
   * match the card beside it — but unlike everything else here it is NOT a
   * fact about the house, and it is not even the answer: it is what the rep
   * typed, which only counts on a partner with no rule of its own. Each column
   * resolves its OWN partner's rule over it. See `solar-sign-today`.
   */
  credits?: {
    rates: CreditRates;
    claims: CreditClaims;
    signTodayTypedCents?: number;
  } | null;
};

export type CompareRow = {
  /** The lender product's id, or CASH_OFFER_ID. */
  id: string;
  lenderId: string | null;
  lenderName: string | null;
  label: string;
  product: FinanceProduct;
  /**
   * THE PAYMENT THIS COLUMN QUOTES — the credits this job earns already in it.
   *
   * A deal that claims credits is quoted on what is left of the contract once
   * they are against the loan, because that is the money the household
   * actually finances. The full-contract payment has not gone anywhere; it is
   * `withoutCreditsMonthlyCents` below, and it is what a household that never
   * files for the credit ends up paying.
   *
   * Null where a fixed monthly is not what this product quotes (cash, PPA).
   */
  monthlyCents: number | null;
  /**
   * PPA ONLY — what year one's twelve bills average out at.
   *
   * Separate from `monthlyCents` above, which is a figure the customer OWES
   * every month whatever the weather does. A PPA promises no such thing: the
   * bill is whatever the roof made that month at the agreed rate, so the twelve
   * differ and the one honest single number is their mean.
   *
   * It has to exist because the shelf is a comparison. Every other column
   * quotes a monthly and this one quoted a price per kilowatt-hour, which is
   * not a figure a homeowner can hold up against "$188 a month" — so the PPA
   * card was the one card on the screen nobody could compare, and a rep closing
   * one had to do the arithmetic at the table. Null on every other product:
   * cash has no monthly at all, and a loan's and a lease's are already above.
   */
  avgMonthlyCents: number | null;
  /**
   * THE SAME MONTHLY IN THE LAST YEAR OF THE TERM — lease and PPA.
   *
   * The honest floor of a third-party deal, and the counterpart to the loan
   * column's `monthlyWithoutPaydownCents` directly below: both are the figure a
   * headline is quietly hiding, printed under it rather than left to be found
   * out later. A PPA at a 3.99% escalator is sold on "about $145 a month" and
   * bills nearer $430 by year thirty; the screen that says the first has to say
   * the second.
   *
   * Null where it would not come out ABOVE the headline — a flat lease, a PPA
   * with no escalator — because the same number printed twice under two names
   * reads as two different payments.
   */
  finalYearMonthlyCents: number | null;
  /** Loan only: what the payment becomes if the paydown is never applied. */
  monthlyWithoutPaydownCents: number | null;
  /**
   * THE SAME PROGRAMME WITH NO CREDIT CLAIMED — the contract financed whole.
   *
   * The contrast to the figure above, and the honest floor of the deal: a
   * household that never files gets this one. Null where there is nothing to
   * contrast — cash and the third-party products, a basis carrying no credits,
   * a deal claiming none — and, deliberately, wherever it would not come out
   * ABOVE the quote. On a partner programme the ladder lands exactly on the
   * price the payment already came off, and the same number printed twice
   * under two names reads as a second, different loan.
   */
  withoutCreditsMonthlyCents: number | null;
  /** The contract less those credits — what the quoted payment is on. */
  netCostAfterCreditsCents: number | null;
  /** The lump sum the program expects, cents. Null when it has no paydown. */
  paydownCents: number | null;
  /** True when the payment came off a published factor, not our amortisation. */
  fromFactor: boolean;
  /** Purchase only. A lease or PPA sells electricity and has no sticker. */
  grossPpwCents: number | null;
  dealerFeePct: number | null;
  contractPriceCents: number | null;
  /**
   * What the company keeps per installed watt on this column — the gross, after
   * the lender's cut and after the adders are paid for, divided by the watts.
   *
   * Shown because under a price cap it is the figure that MOVES. Everywhere
   * else the customer's price absorbs a dear lender and this number sits still;
   * on a capped column it is the other way round, and a rep quoting one needs
   * to see what the deal is worth without opening the payroll module.
   */
  netPpwCents: number | null;
  /** The lender's stated $/W, when it has one, so the card can name it. */
  maxFinalPpwCents: number | null;
  /** Whether that figure is a ceiling or this partner's flat price. */
  finalPpwMode: FinalPpwMode;
  /** True when that rule actually moved this column's price. */
  capped: boolean;
  /** True when the adders alone exceed it — see `capStickerToFinalPpw`. */
  adderOverrun: boolean;
  /** Everything the customer hands over across the whole term. */
  totalPaidCents: number | null;
  /** Loan with a paydown: the same total if they never make it. */
  totalPaidWithoutPaydownCents: number | null;
  termLabel: string;
  escalatorPct: number | null;
  rateMillsPerKwh: number | null;
};

/** "25 yr" when it divides, "18 mo" when it does not — never a rounded lie. */
function loanTermLabel(months: number | null): string {
  if (!months || months <= 0) return "—";
  return months % 12 === 0 ? `${months / 12} yr` : `${months} mo`;
}

/**
 * The sticker this particular offer has to carry.
 *
 * One base price, grossed up by each lender's own fee: a 28% partner costs the
 * customer more than an 18% one for the same job, and that difference is the
 * single most useful number on the screen. Cash carries a fee of zero by
 * definition, so it is quoted at the base exactly.
 */
function stickerCents(basis: CompareBasis, dealerFeePct: number): number | null {
  if (basis.basePpwCents == null) return null;
  return grossPpwFromNet(basis.basePpwCents, dealerFeePct);
}

function purchaseRow(
  offer: Offer,
  basis: CompareBasis,
  meta: Pick<CompareRow, "id" | "lenderId" | "lenderName" | "label" | "product">
): CompareRow {
  const cash = isCash(offer);
  // Cash has no lender, so it has no fee to price around — and for the same
  // reason no maximum either. A ceiling belongs to a partner's paper; a
  // homeowner writing a cheque is buying from the company at the company's
  // price, and clamping that would be capping our own quote against a lender
  // nobody is borrowing from.
  const dealerFeePct = cash ? 0 : (offer as OfferProduct).dealerFeePct ?? 0;
  const maxFinalPpwCents = cash ? null : (offer as OfferProduct).maxFinalPpwCents ?? null;
  const finalPpwMode = cash ? undefined : (offer as OfferProduct).finalPpwMode;
  const uncappedPpwCents = stickerCents(basis, dealerFeePct);

  // The ceiling is applied to the sticker BEFORE pricing rather than to the
  // contract afterwards, so that every figure below — the monthly, the total
  // paid, the redline — is computed from the price the customer is actually
  // being quoted. Capping the headline and leaving the payment to the old one
  // would put two different deals on the same card.
  const cap =
    uncappedPpwCents == null
      ? null
      : capStickerToFinalPpw({
          stickerPpwCents: uncappedPpwCents,
          maxFinalPpwCents,
          mode: finalPpwMode,
          basis: cash ? undefined : (offer as OfferProduct).ppwBasis,
          systemSizeKwDc: basis.systemSizeKwDc,
          dealerFeePct,
          adderTotalCents: basis.adderTotalCents,
        });
  const grossPpwCents = cap?.stickerPpwCents ?? uncappedPpwCents;

  const priced =
    grossPpwCents != null && basis.systemSizeKwDc > 0
      ? pricePurchase({
          product: cash ? "cash" : "loan",
          systemSizeKwDc: basis.systemSizeKwDc,
          stickerPpwCents: grossPpwCents,
          dealerFeePct,
          adderTotalCents: basis.adderTotalCents,
          onTopAdderTotalCents: basis.onTopAdderTotalCents,
          batteryPriceCents: basis.batteryPriceCents ?? 0,
        })
      : null;

  const base: CompareRow = {
    ...meta,
    monthlyCents: null,
    // A purchase has a real monthly or none; there is nothing to average.
    avgMonthlyCents: null,
    // A loan's payment is the same in its last month as its first.
    finalYearMonthlyCents: null,
    monthlyWithoutPaydownCents: null,
    withoutCreditsMonthlyCents: null,
    netCostAfterCreditsCents: null,
    paydownCents: null,
    fromFactor: false,
    grossPpwCents,
    dealerFeePct,
    contractPriceCents: priced?.contractPriceCents ?? null,
    netPpwCents:
      priced && priced.systemWatts > 0 ? priced.grossPriceCents / priced.systemWatts : null,
    maxFinalPpwCents,
    finalPpwMode: finalPpwMode ?? "cap",
    capped: cap?.capped ?? false,
    adderOverrun: cap?.adderOverrun ?? false,
    totalPaidCents: null,
    totalPaidWithoutPaydownCents: null,
    termLabel: cash ? "—" : loanTermLabel((offer as OfferProduct).termMonths),
    escalatorPct: null,
    rateMillsPerKwh: null,
  };

  // Cash is over the moment it is signed: what they pay IS the contract.
  if (cash) return { ...base, totalPaidCents: priced?.contractPriceCents ?? null };

  const p = offer as OfferProduct;
  if (!priced) return base;

  // A down payment is not borrowed, so the factor and the amortisation both
  // work on what is left — but the customer still parts with it.
  const financedCents = priced.contractPriceCents - basis.downPaymentCents;
  const factors = hasPaymentFactor(p) ? factorQuote(p, financedCents) : null;
  const factorMonthly = factors ? factorMonthlyCents(factors) : null;

  /**
   * THE CONTRACT FINANCED WHOLE — the deal with no credit ever claimed.
   *
   * Not the quote any more, and not gone either: it is what the household pays
   * if they never file, and it is printed under the quote wherever the two
   * differ.
   */
  const contractMonthlyCents = programmeMonthlyCents(p, financedCents);

  /**
   * THE PAYMENT THIS DEAL IS QUOTED ON: the same programme, asked about what is
   * left after the household claims the credits this job earns.
   *
   * Identical arithmetic to `solar-proposal.ts`, on purpose: this is the figure
   * the customer's document opens on, and a shelf quoting a different one is
   * how a rep promises a payment the proposal then refuses to print.
   */
  /**
   * THE CLOSING CREDIT, resolved on THIS column's partner and THIS column's
   * price — not once for the shelf.
   *
   * Two programmes side by side can belong to two partners who hand back
   * different money: one gives a flat $1,000, the next gives whatever the
   * system is priced over its cap, and a third leaves it to the rep. Resolved
   * per row, the "with credits" figure under each card is that partner's
   * actual offer. Resolved once, every card would quote the deal's own
   * partner's credit under somebody else's name.
   *
   * Cash has no partner and therefore no rule, so it falls to the typed
   * figure — the same line every other lender rule on this shelf draws.
   */
  const signToday = resolveSignToday({
    rule: cash
      ? null
      : {
          mode: (offer as OfferProduct).signTodayMode ?? "none",
          fixedCents: (offer as OfferProduct).signTodayFixedCents ?? null,
          capPpwCents: (offer as OfferProduct).signTodayCapPpwCents ?? null,
        },
    // The array and the storage at sticker, less the credits this job claims:
    // what the household is actually left holding. The adders are the one
    // exclusion — separate work, and it raises the price and stays raised.
    systemPriceCents: priced.baseStickerCents,
    batteryPriceCents: priced.batteryStickerCents,
    systemWatts: priced.systemWatts,
    creditRates: basis.credits?.rates ?? null,
    creditClaims: basis.credits?.claims ?? null,
    typedCents: basis.credits?.signTodayTypedCents ?? 0,
  });

  const ladder = basis.credits
    ? buildCreditLadder({
        contractValueCents: priced.contractPriceCents,
        quotedPriceCents: priced.contractPriceCents,
        rates: basis.credits.rates,
        claims: basis.credits.claims,
        signTodayCreditCents: signToday.cents,
      })
    : null;
  const netMonthlyCents = ladder
    ? programmeMonthlyCents(p, ladder.netCostCents - basis.downPaymentCents)
    : null;
  const creditsApplies =
    netMonthlyCents != null &&
    contractMonthlyCents != null &&
    netMonthlyCents < contractMonthlyCents;

  /**
   * WHICH OF THE TWO THE CUSTOMER IS QUOTED.
   *
   * The credited one wherever this job earns credits, because the credits come
   * off the price and the household finances what is left. Where nothing is
   * claimed the contract IS what is financed and the two are the same figure.
   */
  const monthlyCents = creditsApplies ? netMonthlyCents : contractMonthlyCents;

  const months = p.termMonths ?? 0;
  /**
   * Everything the household hands over across the term.
   *
   * The programme's own paydown is added only where the credits were NOT
   * applied to the principal — where they were, that lump IS the credits and
   * charging for it again would bill the same money twice.
   */
  const total =
    monthlyCents != null && months > 0
      ? monthlyCents * months +
        basis.downPaymentCents +
        (creditsApplies ? 0 : (factors?.paydownCents ?? 0))
      : null;

  const without = factors?.withoutPaydownMonthlyCents ?? null;

  return {
    ...base,
    monthlyCents,
    monthlyWithoutPaydownCents: without,
    withoutCreditsMonthlyCents: creditsApplies ? contractMonthlyCents : null,
    netCostAfterCreditsCents: creditsApplies ? ladder!.netCostCents : null,
    paydownCents: factors?.paydownCents ?? null,
    fromFactor: factorMonthly != null,
    totalPaidCents: total,
    totalPaidWithoutPaydownCents:
      without != null && months > 0 ? without * months + basis.downPaymentCents : null,
  };
}

function thirdPartyRow(
  p: OfferProduct,
  basis: CompareBasis,
  meta: Pick<CompareRow, "id" | "lenderId" | "lenderName" | "label" | "product">
): CompareRow {
  const termYears = p.termYears ?? 0;
  const escalatorPct = p.escalatorPct ?? 0;

  // A lease quotes per kW-DC per month; a PPA quotes per kWh and therefore has
  // no fixed monthly at all.
  const monthlyCents =
    p.product === "lease" && p.leaseRateCentsPerKwMonth != null && basis.systemSizeKwDc > 0
      ? leaseMonthlyCents(p.leaseRateCentsPerKwMonth, basis.systemSizeKwDc)
      : null;

  const quotable =
    termYears > 0 &&
    (p.product === "lease" ? monthlyCents != null : (p.rateMillsPerKwh ?? 0) > 0 && basis.year1ProductionKwh > 0);

  const lifetime = quotable
    ? priceThirdParty(
        {
          product: p.product === "lease" ? "lease" : "ppa",
          rateMillsPerKwh: p.rateMillsPerKwh ?? 0,
          monthlyPaymentCents: monthlyCents ?? 0,
          escalatorPct,
          termYears,
          year1ProductionKwh: basis.year1ProductionKwh,
          systemSizeKwDc: basis.systemSizeKwDc,
        },
        // priceThirdParty reads only degradation off the assumptions; the rest
        // are irrelevant to a stream of payments and are passed as zeroes
        // rather than as plausible-looking numbers nobody uses.
        {
          derateFactor: 1,
          annualDegradationPct: basis.annualDegradationPct,
          utilityEscalationPct: 0,
          kwhPerKwYear: 0,
          utilityMeterFeeCents: 0,
          defaultGrossPpwCents: 0,
          defaultDealerFeePct: 0,
          minOffsetPct: 0,
          maxOffsetPct: 0,
        }
      )
    : null;

  /**
   * The last year over twelve months, but only where it says something new.
   * Both shapes escalate, so both get it; neither gets it flat.
   */
  const finalYearMonthlyCents = (): number | null => {
    if (!lifetime) return null;
    const last = Math.round(lifetime.finalYearCostCents / 12);
    const first =
      p.product === "lease" ? monthlyCents : Math.round(lifetime.year1CostCents / 12);
    return first != null && last > first ? last : null;
  };

  return {
    ...meta,
    monthlyCents,
    /**
     * A PPA's year one, over twelve months.
     *
     * Year ONE and not the term's mean, deliberately: the escalator makes the
     * last year's bill half as much again as the first, and averaging across
     * all of it would quote a homeowner a payment they never make in any month
     * of the agreement. Year one is the bill they start paying, which is the
     * figure every other column on this shelf is also quoting.
     */
    avgMonthlyCents:
      p.product === "ppa" && lifetime ? Math.round(lifetime.year1CostCents / 12) : null,
    finalYearMonthlyCents: finalYearMonthlyCents(),
    monthlyWithoutPaydownCents: null,
    // A lease or PPA buys electricity. The household never owns the array, so
    // it never claims a credit on one and there is no second payment to quote.
    withoutCreditsMonthlyCents: null,
    netCostAfterCreditsCents: null,
    paydownCents: null,
    fromFactor: false,
    // Electricity, not a system: no sticker, no fee, no contract price — and
    // therefore nothing for a maximum price per watt to cap. A lease sells
    // kilowatt-hours; there is no per-watt price on it to hold a ceiling over.
    grossPpwCents: null,
    dealerFeePct: null,
    contractPriceCents: null,
    netPpwCents: null,
    maxFinalPpwCents: null,
    finalPpwMode: "cap",
    capped: false,
    adderOverrun: false,
    totalPaidCents: lifetime?.lifetimeCostCents ?? null,
    totalPaidWithoutPaydownCents: null,
    termLabel: termYears > 0 ? `${termYears} yr` : "—",
    escalatorPct: p.escalatorPct,
    rateMillsPerKwh: p.rateMillsPerKwh,
  };
}

/** Price every shortlisted offer on one basis, in the order given. */
export function compareOffers(offers: Offer[], basis: CompareBasis): CompareRow[] {
  return offers.map((offer) => {
    if (isCash(offer)) {
      return purchaseRow(offer, basis, {
        id: CASH_OFFER_ID,
        lenderId: null,
        lenderName: null,
        label: "Cash",
        product: "cash",
      });
    }
    const meta = {
      id: offer.id,
      lenderId: offer.lenderId,
      lenderName: offer.lenderName,
      label: offer.label,
      product: offer.product,
    };
    return offer.product === "lease" || offer.product === "ppa"
      ? thirdPartyRow(offer, basis, meta)
      : purchaseRow(offer, basis, meta);
  });
}

/**
 * What the deal is missing, and therefore why every column reads a dash.
 *
 * A purchase column is `size × sticker`, so with no system size there is no
 * contract price, no monthly payment and no total — and the shelf USED TO say
 * "the terms on this programme are incomplete" under a card whose terms were
 * perfectly complete. That sentence sent a rep to the rate sheet to fix a
 * lender that was not broken, when the answer was on the design step: the roof
 * had never been drawn.
 *
 * Deal-level on purpose: neither gap belongs to any one programme, so the shelf
 * says it once, at the top, next to the step that closes it.
 */
export type BasisGaps = {
  /** No array yet — nothing to multiply a price per watt by. */
  systemSize: boolean;
  /**
   * No base price on the deal at all. Blocks cash and loan; a lease or PPA
   * quotes off its own rate sheet and is unaffected.
   */
  pricePerWatt: boolean;
};

export function basisGaps(basis: CompareBasis): BasisGaps {
  return {
    systemSize: !(basis.systemSizeKwDc > 0),
    pricePerWatt: !(basis.basePpwCents != null && basis.basePpwCents > 0),
  };
}
