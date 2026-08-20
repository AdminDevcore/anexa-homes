import type { FinanceProduct } from "@prisma/client";
import {
  grossPpwFromNet,
  leaseMonthlyCents,
  loanPaymentCents,
  pricePurchase,
  priceThirdParty,
} from "@/lib/solar-money";
import { factorQuote, factorMonthlyCents, hasPaymentFactor } from "@/lib/solar-loan";

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
  isActive: boolean;
};

/** Cash is its own kind of offer: no lender, no rate sheet, no fee. */
export type CashOffer = { kind: "cash" };

export type Offer = OfferProduct | CashOffer;

const isCash = (o: Offer): o is CashOffer => "kind" in o && o.kind === "cash";

export type CompareBasis = {
  systemSizeKwDc: number;
  year1ProductionKwh: number;
  adderTotalCents: number;
  downPaymentCents: number;
  /**
   * What the company keeps per watt after the lender's cut. Set, and each
   * column's sticker is derived from its OWN fee — which is exactly what makes
   * a dearer lender show up as a dearer system rather than as a smaller margin.
   */
  targetNetPpwCents: number | null;
  /** The sticker the rep typed, used when there is no net target to derive from. */
  typedGrossPpwCents: number | null;
  /** Lease and PPA totals run across the term, so output has to decay. */
  annualDegradationPct: number;
};

export type CompareRow = {
  /** The lender product's id, or CASH_OFFER_ID. */
  id: string;
  lenderId: string | null;
  lenderName: string | null;
  label: string;
  product: FinanceProduct;
  /** Null where a fixed monthly is not what this product quotes (cash, PPA). */
  monthlyCents: number | null;
  /** Loan only: what the payment becomes if the paydown is never applied. */
  monthlyWithoutPaydownCents: number | null;
  /** The lump sum the program expects, cents. Null when it has no paydown. */
  paydownCents: number | null;
  /** True when the payment came off a published factor, not our amortisation. */
  fromFactor: boolean;
  /** Purchase only. A lease or PPA sells electricity and has no sticker. */
  grossPpwCents: number | null;
  dealerFeePct: number | null;
  contractPriceCents: number | null;
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
 * With a net target, each lender's fee produces its own gross — a 28% partner
 * costs the customer more than an 18% one for the same job, and that difference
 * is the single most useful number on the screen. Without one, every column is
 * quoted at what the rep typed, because inventing a per-lender sticker from
 * nothing would make the comparison look precise while meaning nothing.
 */
function stickerCents(basis: CompareBasis, dealerFeePct: number): number | null {
  if (basis.targetNetPpwCents != null) {
    return grossPpwFromNet(basis.targetNetPpwCents, dealerFeePct);
  }
  return basis.typedGrossPpwCents;
}

function purchaseRow(
  offer: Offer,
  basis: CompareBasis,
  meta: Pick<CompareRow, "id" | "lenderId" | "lenderName" | "label" | "product">
): CompareRow {
  const cash = isCash(offer);
  // Cash has no lender, so it has no fee to price around, by definition.
  const dealerFeePct = cash ? 0 : (offer as OfferProduct).dealerFeePct ?? 0;
  const grossPpwCents = stickerCents(basis, dealerFeePct);

  const priced =
    grossPpwCents != null && basis.systemSizeKwDc > 0
      ? pricePurchase({
          product: cash ? "cash" : "loan",
          systemSizeKwDc: basis.systemSizeKwDc,
          grossPpwCents,
          dealerFeePct,
          adderTotalCents: basis.adderTotalCents,
        })
      : null;

  const base: CompareRow = {
    ...meta,
    monthlyCents: null,
    monthlyWithoutPaydownCents: null,
    paydownCents: null,
    fromFactor: false,
    grossPpwCents,
    dealerFeePct,
    contractPriceCents: priced?.contractPriceCents ?? null,
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

  const monthlyCents =
    factorMonthly ??
    loanPaymentCents({
      principalCents: financedCents,
      aprPct: p.aprPct,
      termMonths: p.termMonths,
    });

  const months = p.termMonths ?? 0;
  const total =
    monthlyCents != null && months > 0
      ? monthlyCents * months + basis.downPaymentCents + (factors?.paydownCents ?? 0)
      : null;

  const without = factors?.withoutPaydownMonthlyCents ?? null;

  return {
    ...base,
    monthlyCents,
    monthlyWithoutPaydownCents: without,
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
          defaultGrossPpwCents: 0,
          defaultDealerFeePct: 0,
          minOffsetPct: 0,
          maxOffsetPct: 0,
          minPpwCents: 0,
          maxPpwCents: 0,
        }
      )
    : null;

  return {
    ...meta,
    monthlyCents,
    monthlyWithoutPaydownCents: null,
    paydownCents: null,
    fromFactor: false,
    // Electricity, not a system: no sticker, no fee, no contract price.
    grossPpwCents: null,
    dealerFeePct: null,
    contractPriceCents: null,
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
