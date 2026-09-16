import type { FinanceProduct } from "@prisma/client";
import type { DealerFeeSource } from "./solar-dealer-fee";
import {
  priceStoredPurchase,
  priceStorageStored,
  priceThirdParty,
  purchaseFromUnits,
  type FinalPpwMode,
  type PriceBasis,
  type PurchaseBreakdown,
  type SolarAssumptions,
  type ThirdPartyBreakdown,
} from "./solar-money";
import {
  buildCreditLadder,
  type CreditClaims,
  type CreditLine,
  type CreditRates,
} from "./solar-credit-ladder";

/**
 * ONE FUNCTION, BOTH CREDIT STATES.
 *
 * The federal credits are SOLD to a third-party monetizer, which pays roughly
 * fifty cents on the dollar. They reduce what the household signs; the
 * household does not claim them. That is the business model (§8.1), and it is
 * the opposite of what most of the comments on `ed3b832` said.
 *
 *     base          = sold $/W × watts
 *     gross         = base + adders + equipment charges
 *     final         = gross ÷ (1 − dealer fee)
 *     credit amount = final × Σ enabled credit rates
 *     net final     = final − credit amount − sign-today credit
 *     net gross     = net final × (1 − dealer fee)
 *     revenue       = net gross + credit amount × monetizer payout rate
 *
 * **Credits applied** is the default: it is what is signed, sent to the lender
 * and paid on. **Credits not applied** is for comparison only. Both are
 * computed here, in one pass, because the alternative — each screen deciding
 * for itself — is what produced a deal page and a builder quoting one house at
 * two prices.
 *
 * NOT CONNECTED TO ANYTHING YET. Stage 3 builds this and stops; Stage 4 points
 * the twenty-five price sites (§8.5) at it. Wiring it in is a separate,
 * approved step, so nothing here changes a number on a screen today.
 *
 * TWO INVARIANTS ARE STRUCTURAL, NOT PROMISED.
 *
 * 1. **Credits never move commission.** The base, the watts and the redline
 *    basis live on the result ITSELF, above both states — there is no
 *    per-state base for a commission to accidentally read. A credit state can
 *    only change what the household owes and what we collect.
 * 2. **The word "contract" is reserved for the signed document** (§8.2). No
 *    field below carries it. `PurchaseBreakdown.contractPriceCents` still does,
 *    and is mapped — not spread — at the boundary in `ladderFrom` below. Stage
 *    2 spent a day on what a spread across a vocabulary boundary costs.
 */

/** Which reading of the same deal. */
export type CreditStateKey = "applied" | "notApplied";

/** Where the dealer fee on this deal came from, for the margin indicator. */
/**
 * Re-exported, not declared. `solar-dealer-fee.ts` owns the precedence AND the
 * vocabulary for it, so that the resolver and the priced deal cannot drift into
 * describing the same three places with different words.
 */
export type { DealerFeeSource };

/**
 * One reading of the money, under one credit state.
 *
 * Every field here is downstream of the credits. Anything a commission is
 * measured on is deliberately NOT in this type.
 */
export type DealCreditState = {
  key: CreditStateKey;
  /** The credit rows, by name and rate. Empty on `notApplied`, always. */
  credits: CreditLine[];
  /** Σ of those rows, clamped at the final price. Zero on `notApplied`. */
  creditAmountCents: number;
  /**
   * The rep's own closing credit, cents.
   *
   * NOT a federal credit, so it applies in BOTH states — and it is inside the
   * lender amount (D2), which removes by construction the mismatch where the
   * lender was asked for more than the proposal said was financed.
   *
   * Clamped to what is left, so a rep typing $999,999 into a deal with $60,000
   * of room gets $60,000 rather than a negative bottom line on a page a
   * household reads.
   */
  signTodayCents: number;
  /** final − credits − sign-today. What is signed, funded and paid on. */
  netFinalPriceCents: number;
  /** That, per installed watt. Zero on a storage-only job, which has none. */
  netFinalPpwCents: number;
  /** net final × (1 − fee). What the company keeps before the monetizer. */
  netGrossPriceCents: number;
  /**
   * What the lender is asked to fund under this state — the net final,
   * sign-today credit included (D2).
   */
  lenderAmountCents: number;
  /**
   * net gross + credit amount × payout rate.
   *
   * NULL when no payout rate was supplied, which is the honest answer rather
   * than a guess: the rate is a company default overridable per programme and
   * per deal (D9), and that column does not exist yet — it lands with the model
   * flip in Stage 5. Passing it in keeps this function pure and keeps Stage 3
   * out of the schema.
   */
  revenueCents: number | null;
};

/** The margin reading, where both halves of it are actually known. */
export type DealMargin = {
  /** % of each credit dollar the monetizer pays. Null when not supplied. */
  monetizerPayoutRate: number | null;
  /**
   * TRUE WHEN EVERY CREDIT DOLLAR APPLIED LOSES MONEY — `payout + fee < 100%`.
   *
   * Applying a credit of C lowers the net final by C, which lowers net gross by
   * C × (1 − fee), while the monetizer adds C × payout. So
   *
   *     Δrevenue per credit dollar = payout + fee − 1
   *
   * At a 50% payout an 18% fee loses 32¢ per credit dollar and a 65% fee gains
   * 15¢. The condition first proposed (`fee > payout`) was inverted; this is
   * the one the owner confirmed on 2026-09-15.
   *
   * Null when the payout is unknown — "we cannot tell" is not "it is fine".
   */
  losesMoneyOnCreditDollars: boolean | null;
  /** Δrevenue per credit dollar applied, in percentage points. Null as above. */
  creditDollarMarginPct: number | null;
};

/** Whether a partner's price rule moved this deal, for a screen that must say so. */
export type DealPriceRule = {
  capped: boolean;
  adderOverrun: boolean;
};

export type DealPrice = {
  product: FinanceProduct;
  /** Installed watts. Zero on a storage-only job — the battery is the system. */
  systemWatts: number;

  // ── The ladder. Credit-independent, and therefore commission-safe ─────────

  /** BASE — the system alone, before the lender's cut. What a redline reads. */
  baseKeptCents: number;
  basePpwCents: number;
  /** ALL the extra work at catalogue price: inside the rule plus outside it. */
  addersCents: number;
  addersInsideRuleCents: number;
  addersOutsideRuleCents: number;
  /** The storage on the job at catalogue price. Zero without one. */
  equipmentChargesCents: number;
  grossPriceCents: number;
  grossPpwCents: number;
  dealerFeeCents: number;
  dealerFeePct: number;
  dealerFeeSource: DealerFeeSource;
  /** FINAL — gross with the fee in it, before any credit. */
  finalPriceCents: number;
  finalPpwCents: number;

  // ── The same money, split the way the household's own breakdown reads it ──

  baseFinalCents: number;
  baseFinalPpwCents: number;
  addersFinalCents: number;
  equipmentFinalCents: number;

  /** Null on cash, and on any deal whose partner publishes no rule. */
  priceRule: DealPriceRule | null;

  /** THE DEFAULT. Signed, sent to the lender, paid on. */
  applied: DealCreditState;
  /** For comparison only. Never the basis of a submission. */
  notApplied: DealCreditState;

  margin: DealMargin;

  /**
   * A lease or PPA sells electricity, not a system: there is no price ladder
   * under it and no credit to apply. Present so the twenty-five sites Stage 4
   * rewires can ask one function about any deal.
   */
  thirdParty: ThirdPartyBreakdown | null;
};

export type PriceDealInput = {
  product: FinanceProduct;
  /** Only `storage` changes the unit being counted. */
  systemType?: "pv" | "pv_storage" | "storage" | null;
  systemSizeKwDc: number;

  /** The rate the household is quoted for the system, fee already in it. */
  baseFinalPpwCents: number;
  /** Storage-only: what ONE battery stickers at, fee already in it. */
  baseFinalPerBatteryCents?: number;
  batteryQty?: number;

  dealerFeePct: number;
  dealerFeeSource?: DealerFeeSource;

  addersInsideRuleCents: number;
  addersOutsideRuleCents?: number;
  /** Storage on a deal that also has an array, at catalogue price. */
  equipmentChargesCents?: number;

  /** The partner's price rule. Null, or cash, means no rule at all. */
  priceRulePpwCents?: number | null;
  priceRuleMode?: FinalPpwMode;
  priceRulePerBatteryCents?: number | null;
  priceRuleBatteryMode?: FinalPpwMode;
  ppwBasis?: PriceBasis;
  batteryPriceBasis?: PriceBasis;

  rates?: CreditRates | null;
  claims?: CreditClaims | null;
  /** The rep's typed closing credit, cents. Applies in both states. */
  signTodayCreditCents?: number | null;

  /** % of each credit dollar the monetizer pays. Absent = revenue unknown. */
  monetizerPayoutRate?: number | null;

  /** Lease and PPA only. */
  rateMillsPerKwh?: number;
  leasePaymentCents?: number;
  escalatorPct?: number;
  termYears?: number;
  year1ProductionKwh?: number;
  assumptions?: SolarAssumptions;
};

const isPurchase = (p: FinanceProduct) => p === "cash" || p === "loan";

/**
 * MAPPED, NEVER SPREAD.
 *
 * `PurchaseBreakdown` speaks the pricing library's vocabulary, which still says
 * `contractPriceCents`. Everything this module returns is the business's, which
 * reserves "contract" for the signed document. The translation is written out
 * key by key on purpose: a spread across a vocabulary boundary type-checks
 * perfectly, contributes keys nothing reads, and leaves the ones that ARE read
 * undefined — which in Stage 2 priced a $7,000 re-roof at nothing.
 */
function ladderFrom(b: PurchaseBreakdown, feePct: number, source: DealerFeeSource) {
  return {
    systemWatts: b.systemWatts,
    baseKeptCents: b.baseKeptCents,
    basePpwCents: b.basePpwCents,
    addersCents: b.adderTotalCents + b.onTopAdderTotalCents,
    addersInsideRuleCents: b.adderTotalCents,
    addersOutsideRuleCents: b.onTopAdderTotalCents,
    equipmentChargesCents: b.batteryPriceCents,
    grossPriceCents: b.grossPriceCents,
    grossPpwCents: b.grossPpwCents,
    dealerFeeCents: b.dealerFeeCents,
    dealerFeePct: feePct,
    dealerFeeSource: source,
    finalPriceCents: b.contractPriceCents,
    finalPpwCents: b.finalPpwCents,
    baseFinalCents: b.baseStickerCents,
    baseFinalPpwCents: b.systemWatts > 0 ? Math.round(b.baseStickerCents / b.systemWatts) : 0,
    addersFinalCents: b.adderStickerCents,
    equipmentFinalCents: b.batteryStickerCents,
  };
}

/**
 * One credit state, off a final price that is the same in both.
 *
 * The credit ROWS come from `buildCreditLadder` rather than from arithmetic
 * repeated here, so this function and the document ladder cannot round a credit
 * differently. It is called with `quotedPriceCents` equal to the final price,
 * which makes the old model's "derived incentive" rung exactly zero: that rung
 * existed to reconcile a separately quoted price against the credits, and in
 * the monetized model the price is DERIVED from them instead.
 */
function creditState(
  key: CreditStateKey,
  finalPriceCents: number,
  systemWatts: number,
  dealerFeePct: number,
  input: PriceDealInput
): DealCreditState {
  const ladder =
    key === "applied" && finalPriceCents > 0
      ? buildCreditLadder({
          contractValueCents: finalPriceCents,
          quotedPriceCents: finalPriceCents,
          rates: input.rates ?? { itcPct: 0, energyCommunityPct: 0, domesticContentPct: 0 },
          claims: input.claims,
          signTodayCreditCents: 0,
        })
      : null;

  const credits = ladder?.credits ?? [];
  const creditAmountCents = ladder?.creditTotalCents ?? 0;

  // Clamped at what is left, for the reason given on `signTodayCents`.
  const room = Math.max(0, finalPriceCents - creditAmountCents);
  const signTodayCents = Math.min(
    Math.max(0, Math.round(input.signTodayCreditCents ?? 0)),
    room
  );

  const netFinalPriceCents = room - signTodayCents;
  const netGrossPriceCents = Math.round(netFinalPriceCents * (1 - dealerFeePct / 100));

  const payout = input.monetizerPayoutRate;
  const revenueCents =
    payout == null || !Number.isFinite(payout)
      ? null
      : netGrossPriceCents + Math.round((creditAmountCents * payout) / 100);

  return {
    key,
    credits,
    creditAmountCents,
    signTodayCents,
    netFinalPriceCents,
    netFinalPpwCents: systemWatts > 0 ? Math.round(netFinalPriceCents / systemWatts) : 0,
    netGrossPriceCents,
    lenderAmountCents: netFinalPriceCents,
    revenueCents,
  };
}

/**
 * Price one deal, in both credit states.
 *
 * Cash carries no dealer fee and no partner price rule — the same line the
 * builder's price card and the finance-row save already draw.
 */
export function priceDeal(input: PriceDealInput): DealPrice {
  const dealerFeePct = input.product === "cash" ? 0 : input.dealerFeePct;
  // Cash carries no fee at all, so its provenance is `none` rather than a
  // place a zero was read from. Mirrors the line above it.
  const source: DealerFeeSource =
    input.product === "cash" ? "none" : (input.dealerFeeSource ?? "programme");

  // ── Lease and PPA: electricity, not a system ─────────────────────────────
  if (!isPurchase(input.product)) {
    const thirdParty =
      input.assumptions != null
        ? priceThirdParty(
            {
              product: input.product === "ppa" ? "ppa" : "lease",
              rateMillsPerKwh: input.rateMillsPerKwh,
              monthlyPaymentCents: input.leasePaymentCents,
              escalatorPct: input.escalatorPct ?? 0,
              termYears: input.termYears ?? 0,
              year1ProductionKwh: input.year1ProductionKwh ?? 0,
              systemSizeKwDc: input.systemSizeKwDc,
            },
            input.assumptions
          )
        : null;

    const watts = Math.round(input.systemSizeKwDc * 1000);
    const zero = (key: CreditStateKey): DealCreditState => ({
      key,
      credits: [],
      creditAmountCents: 0,
      signTodayCents: 0,
      netFinalPriceCents: 0,
      netFinalPpwCents: 0,
      netGrossPriceCents: 0,
      lenderAmountCents: 0,
      revenueCents: null,
    });

    return {
      product: input.product,
      systemWatts: watts,
      baseKeptCents: 0,
      basePpwCents: 0,
      addersCents: 0,
      addersInsideRuleCents: 0,
      addersOutsideRuleCents: 0,
      equipmentChargesCents: 0,
      grossPriceCents: 0,
      grossPpwCents: 0,
      dealerFeeCents: 0,
      dealerFeePct: 0,
      dealerFeeSource: source,
      finalPriceCents: 0,
      finalPpwCents: 0,
      baseFinalCents: 0,
      baseFinalPpwCents: 0,
      addersFinalCents: 0,
      equipmentFinalCents: 0,
      priceRule: null,
      applied: zero("applied"),
      notApplied: zero("notApplied"),
      margin: { monetizerPayoutRate: null, losesMoneyOnCreditDollars: null, creditDollarMarginPct: null },
      thirdParty,
    };
  }

  const product = input.product === "cash" ? ("cash" as const) : ("loan" as const);
  const isStorage = input.systemType === "storage";

  // ── The ladder, over watts or over batteries ─────────────────────────────
  const priced = isStorage
    ? (() => {
        const r = priceStorageStored({
          product,
          batteryQty: input.batteryQty ?? 0,
          stickerPricePerBatteryCents: input.baseFinalPerBatteryCents ?? 0,
          dealerFeePct,
          adderTotalCents: input.addersInsideRuleCents,
          onTopAdderTotalCents: input.addersOutsideRuleCents,
          maxFinalPricePerBatteryCents: input.priceRulePerBatteryCents,
          finalBatteryPriceMode: input.priceRuleBatteryMode,
          batteryPriceBasis: input.batteryPriceBasis,
        });
        return { breakdown: purchaseFromUnits(r.breakdown), cap: r.cap };
      })()
    : priceStoredPurchase({
        product,
        systemSizeKwDc: input.systemSizeKwDc,
        stickerPpwCents: input.baseFinalPpwCents,
        dealerFeePct,
        adderTotalCents: input.addersInsideRuleCents,
        onTopAdderTotalCents: input.addersOutsideRuleCents,
        batteryPriceCents: input.equipmentChargesCents,
        maxFinalPpwCents: input.priceRulePpwCents,
        finalPpwMode: input.priceRuleMode,
        ppwBasis: input.ppwBasis,
      });

  const rungs = ladderFrom(priced.breakdown, dealerFeePct, source);

  const payout = input.monetizerPayoutRate;
  const known = payout != null && Number.isFinite(payout);

  return {
    product: input.product,
    ...rungs,
    priceRule:
      product === "cash" ? null : { capped: priced.cap.capped, adderOverrun: priced.cap.adderOverrun },
    applied: creditState("applied", rungs.finalPriceCents, rungs.systemWatts, dealerFeePct, input),
    notApplied: creditState("notApplied", rungs.finalPriceCents, rungs.systemWatts, dealerFeePct, input),
    margin: {
      monetizerPayoutRate: known ? payout! : null,
      losesMoneyOnCreditDollars: known ? payout! + dealerFeePct < 100 : null,
      creditDollarMarginPct: known ? payout! + dealerFeePct - 100 : null,
    },
    thirdParty: null,
  };
}
