import type { FinanceProduct } from "@prisma/client";

/**
 * Solar pricing and commission maths.
 *
 * Pure functions, money in CENTS, no I/O — so the proposal builder, the
 * commission engine and the customer-facing presentation all compute the same
 * number from the same code.
 *
 * THE CENTRAL POINT: the four financing products are NOT variations of one
 * model. Cash and Loan sell a system at a price per watt. Lease and PPA sell
 * *electricity* — there is no system price in the same sense, and applying a
 * loan's dealer-fee maths to a PPA produces a number that means nothing. Each
 * product therefore has its own input shape and its own commission basis, and
 * the type system keeps them apart.
 */

// ---------------------------------------------------------------------------
// Assumptions — every one of these is DATA from SolarSettings, never a constant
// in this file. No tax credit or incentive appears here or anywhere else: this
// company quotes none, so a proposal never nets one out of a price.
// ---------------------------------------------------------------------------
export type SolarAssumptions = {
  derateFactor: number;
  annualDegradationPct: number;
  utilityEscalationPct: number;
  kwhPerKwYear: number;
  /**
   * The utility's FIXED monthly charge, in cents — meter/service/connection fee.
   *
   * The bill has two halves and only one of them is kilowatt-hours. Every
   * utility bills a standing charge for the meter itself, and it is billed in a
   * month the system covered 100% of the home's usage exactly as it is billed in
   * December. A model built only on kWh therefore drives the post-solar bill to
   * $0 on any system at or above full offset, and prints that $0 next to a
   * monthly payment on a document a homeowner keeps — who then opens a real bill
   * for $10 and reads the rest of the proposal differently.
   *
   * So it is added to what the household still owes the utility AFTER solar, and
   * deliberately NOT to the pre-solar utility cost: that side is derived from
   * the customer's own bill, which already contained the fee. Counting it twice
   * would inflate the saving; counting it once, on the side that is modelled
   * rather than observed, holds the projection on the conservative side.
   */
  utilityMeterFeeCents: number;
  defaultGrossPpwCents: number;
  defaultDealerFeePct: number;
  minOffsetPct: number;
  maxOffsetPct: number;
  minPpwCents: number;
  maxPpwCents: number;
};

// ---------------------------------------------------------------------------
// Production
// ---------------------------------------------------------------------------

/**
 * The margin every quoted kWh is held back by, as a percentage.
 *
 * NOT a loss and NOT part of the model. `derateFactor` is an estimate of what
 * the equipment actually loses — inverter, wiring, soiling — and PVWatts is a
 * simulation of what the sky actually delivers; both are attempts at the truth,
 * and both can be a little high. This is the company deliberately quoting
 * UNDER whichever of them answered, so that a system lands at or above what the
 * homeowner was promised rather than a few percent below it. A year-one figure
 * a customer beats is a referral; one they miss is a complaint.
 *
 * It is a constant rather than a Solar Settings field on purpose: it is a
 * promise the company makes about every quote, not a knob a branch tunes per
 * market. The one place to change it is here, and everything that prints a kWh
 * moves with it.
 *
 * Applied ONCE, at the leaves — `year1Production`,
 * `year1ProductionFromArrays`, the measured-plane branch of `systemTotals` and
 * the monthly curve. Everything downstream (offset, savings, the year-by-year
 * projection, the auto-prune's target) is built from those and inherits it, so
 * applying it anywhere else would take the 5% twice.
 */
export const PRODUCTION_MARGIN_PCT = 5;

/** What survives the margin: 0.95 at 5%. */
export const PRODUCTION_MARGIN_FACTOR = 1 - PRODUCTION_MARGIN_PCT / 100;

/**
 * A modelled kWh figure, held back by the margin above.
 *
 * Unrounded — the callers round, and rounding here would round twice.
 */
export function withProductionMargin(kwh: number): number {
  if (!Number.isFinite(kwh) || kwh <= 0) return 0;
  return kwh * PRODUCTION_MARGIN_FACTOR;
}

/**
 * The physical ceiling on TSRF, and the point below which a site is a shading
 * problem rather than a design. Both are sanity rails, not business policy —
 * a TSRF of 0 or 140 is a typo, and the proposal must not price it.
 */
export const TSRF_MIN_PCT = 30;
export const TSRF_MAX_PCT = 100;
/** Below this, the array is materially shaded and the rep should be told. */
export const TSRF_WARN_PCT = 75;

/**
 * Year-one kWh from system size, local irradiance, system losses and TSRF.
 *
 * TSRF (Total Solar Resource Fraction) is the share of the ideal annual
 * irradiance this particular roof plane actually receives once its tilt,
 * azimuth and shading are accounted for. It was being COLLECTED on the design
 * and then ignored, which meant a heavily shaded north-facing roof produced the
 * same headline number as a perfect south-facing one — the customer finds out
 * twelve months later, from their bill.
 *
 * Null TSRF means "not surveyed yet" and is treated as 100% (no shading
 * deduction) so an early estimate is not silently penalised; the readiness
 * validator asks for the real figure before a proposal can be generated.
 */
export function year1Production(
  systemSizeKwDc: number,
  a: SolarAssumptions,
  tsrfPct?: number | null
): number {
  if (systemSizeKwDc <= 0) return 0;
  const tsrf = tsrfPct == null ? 100 : tsrfPct;
  return Math.round(
    withProductionMargin(systemSizeKwDc * a.kwhPerKwYear * a.derateFactor * (tsrf / 100))
  );
}

/**
 * The only two assumptions production needs.
 *
 * Narrower than `SolarAssumptions` on purpose: this is the shape that crosses
 * the wire to the designer, and a company's pricing floors and dealer fees have
 * no business being in a browser to draw a roof.
 */
export type YieldAssumptions = Pick<SolarAssumptions, "kwhPerKwYear" | "derateFactor">;

/**
 * Year-one kWh when the arrays face different ways, which on a real house they
 * almost always do.
 *
 * `year1Production` above answers "how much does N kW make here" — one number
 * for the whole system, and therefore the same answer whichever side of the
 * ridge the panels are on. This one weights each array by the plane it is
 * actually mounted on before adding them up, so a south array and a north array
 * of the same size no longer contribute the same kWh.
 *
 * An array with no orientation recorded weighs 1 — the pre-orientation answer,
 * unchanged. That is what lets this replace the old call everywhere without
 * moving a single already-quoted number.
 */
export function year1ProductionFromArrays(
  arrays: { kwDc: number; orientationFactor: number }[],
  a: YieldAssumptions
): number {
  const kwh = arrays.reduce((sum, arr) => {
    if (!(arr.kwDc > 0)) return sum;
    const factor = Number.isFinite(arr.orientationFactor) ? arr.orientationFactor : 1;
    return sum + arr.kwDc * a.kwhPerKwYear * a.derateFactor * Math.max(0, factor);
  }, 0);
  return Math.round(withProductionMargin(kwh));
}

/**
 * The whole system's orientation factor: the production actually expected as a
 * share of what the same kW would make on this site's best plane.
 *
 * Shown to the rep rather than kept internal, because "your roof is at 84% of
 * ideal" is the sentence that explains why the panel count went up.
 */
export function blendedOrientationFactor(
  arrays: { kwDc: number; orientationFactor: number }[]
): number | null {
  const totalKw = arrays.reduce((n, arr) => n + Math.max(0, arr.kwDc), 0);
  if (totalKw <= 0) return null;
  const weighted = arrays.reduce(
    (n, arr) => n + Math.max(0, arr.kwDc) * Math.max(0, arr.orientationFactor),
    0
  );
  return weighted / totalKw;
}

/**
 * The customer's current blended rate, derived from their OWN bill.
 *
 * Returns null when it cannot be derived. That is the whole point: this used to
 * fall back to a hardcoded 150 mills ($0.15/kWh), which meant a proposal missing
 * a utility bill still produced a confident 25-year savings figure built on a
 * number nobody had ever seen. A null here becomes a blocking validation issue,
 * not an invented assumption.
 */
export function deriveUtilityRateMills(
  avgMonthlyBillCents: number | null | undefined,
  annualUsageKwh: number | null | undefined
): number | null {
  if (!avgMonthlyBillCents || avgMonthlyBillCents <= 0) return null;
  if (!annualUsageKwh || annualUsageKwh <= 0) return null;
  return Math.round(((avgMonthlyBillCents * 12) / annualUsageKwh) * 10);
}

/** What share of the home's usage the system covers. */
export function offsetPct(productionKwh: number, annualUsageKwh: number): number {
  if (annualUsageKwh <= 0) return 0;
  return (productionKwh / annualUsageKwh) * 100;
}

/** Production in a given year, after degradation. Year 1 = full output. */
export function productionInYear(year1Kwh: number, year: number, a: SolarAssumptions): number {
  if (year <= 1) return year1Kwh;
  return year1Kwh * Math.pow(1 - a.annualDegradationPct / 100, year - 1);
}

// ---------------------------------------------------------------------------
// Cash & Loan — a system, sold at a price per watt
// ---------------------------------------------------------------------------

export type PurchaseInput = {
  product: "cash" | "loan";
  systemSizeKwDc: number;
  /**
   * The rate per watt the CUSTOMER is quoted for the system — already grossed
   * up by the dealer fee. This is `SolarFinance.grossPpwCents`, and it is not
   * the base: a rep types $2.87/W and an 18% programme stickers it at $3.50/W.
   */
  stickerPpwCents: number;
  /** % the lender keeps of everything it advances. MUST be 0 for cash. */
  dealerFeePct: number;
  /** The extra work at its CATALOGUE price, before any dealer fee. */
  adderTotalCents: number;
  /** Our hard cost, for the margin basis. */
  equipmentCostCents?: number;
};

export type PurchaseBreakdown = {
  systemWatts: number;

  // ── The ladder, in the words the business uses ────────────────────────────

  /** BASE — the system alone, before the lender's cut. What the rep prices. */
  basePriceCents: number;
  /** Base per installed watt. The rate a redline is measured against. */
  basePpwCents: number;

  /** ADDERS — the extra work at its catalogue price, before the cut. */
  adderTotalCents: number;

  /** GROSS — base + adders, still before the cut. What the company keeps. */
  grossPriceCents: number;
  /** Gross per installed watt. */
  grossPpwCents: number;

  /** The lender's cut: final − gross. Zero on cash. */
  dealerFeeCents: number;

  /** FINAL — gross with the dealer fee in it. What the customer signs. */
  contractPriceCents: number;
  /** Final per installed watt. What the homeowner is really paying a watt. */
  finalPpwCents: number;

  // ── The same money, split the way the customer's breakdown reads it ───────

  /** The system at sticker, fee included, adders excluded. "System price". */
  baseStickerCents: number;
  /** The adders at sticker, fee included. "Additional work". */
  adderStickerCents: number;

  /** Gross minus our cost. Only meaningful when cost is known. */
  marginCents: number;
};

/**
 * Price a cash or loan deal.
 *
 * THE MODEL, in the words the business uses, because every expensive mistake
 * here has been a vocabulary mistake:
 *
 *     BASE      what the rep prices the system at, before any lender's cut
 *   + ADDERS    the extra work, at its catalogue price, likewise before the cut
 *   = GROSS     what the company keeps
 *   + FEE       the lender's cut
 *   = FINAL     what the customer signs
 *
 * THE FEE IS A PERCENTAGE OF FINAL, NOT A MARKUP ON GROSS. A 30% programme on
 * a $100,000 system leaves the company $70,000 — so final is `gross / (1 − f)`
 * and never `gross × (1 + f)`. Getting that backwards under-prices an 18%
 * programme by about three cents a watt on every deal.
 *
 * THE FEE APPLIES TO THE ADDERS TOO. The lender advances the whole contract and
 * keeps its percentage of ALL of it — the $14,500 re-roof included. Pricing the
 * fee on the system alone and bolting the adder on afterwards at face value
 * gives the lender's cut on that adder away out of margin, silently, on every
 * job carrying extra work. So the adder grosses up by the same fee the system
 * does, and the company is left holding exactly what the catalogue said.
 *
 * Cash has no lender and therefore no fee; passing one is rejected rather than
 * silently applied, because a cash deal quoted with a dealer fee is simply
 * overpriced.
 */
export function pricePurchase(input: PurchaseInput): PurchaseBreakdown {
  const systemWatts = Math.round(input.systemSizeKwDc * 1000);
  const adderTotalCents = Math.round(input.adderTotalCents);

  // A fee at or above 100% has no honest gross-up — it divides by zero or goes
  // negative. Standing the fee down beats putting an Infinity in front of a
  // homeowner; validation rejects one long before it reaches here.
  const rawPct = input.product === "cash" ? 0 : input.dealerFeePct;
  const f = Number.isFinite(rawPct) && rawPct > 0 && rawPct < 100 ? rawPct / 100 : 0;

  // The system at sticker. `stickerPpwCents` already carries the fee.
  const baseStickerCents = Math.round(systemWatts * input.stickerPpwCents);
  const basePriceCents = baseStickerCents - Math.round(baseStickerCents * f);

  // The adders, grossed up by the SAME fee, so that what survives the lender's
  // cut is the catalogue price and not 82% of it.
  const adderStickerCents = f > 0 ? Math.round(adderTotalCents / (1 - f)) : adderTotalCents;

  const contractPriceCents = baseStickerCents + adderStickerCents;
  const grossPriceCents = basePriceCents + adderTotalCents;

  // Subtracted rather than recomputed as `contract × f`: gross + fee has to
  // equal final EXACTLY, because a customer reads those three lines and adds
  // them up. A cent of rounding drift there is a phone call.
  const dealerFeeCents = contractPriceCents - grossPriceCents;

  const marginCents =
    input.equipmentCostCents === undefined ? 0 : grossPriceCents - input.equipmentCostCents;

  return {
    systemWatts,
    basePriceCents,
    basePpwCents: systemWatts > 0 ? basePriceCents / systemWatts : 0,
    adderTotalCents,
    grossPriceCents,
    grossPpwCents: systemWatts > 0 ? grossPriceCents / systemWatts : 0,
    dealerFeeCents,
    contractPriceCents,
    finalPpwCents: systemWatts > 0 ? contractPriceCents / systemWatts : 0,
    baseStickerCents,
    adderStickerCents,
    marginCents,
  };
}

/**
 * Split a total across weighted lines so the parts sum to it EXACTLY.
 *
 * Needed because the adders reach the customer twice: once as a grossed-up
 * total on the contract, and once as the named lines that make that total
 * answerable. Grossing each line up on its own and printing the total
 * separately leaves a breakdown that does not add up — three lines and a total
 * a few cents apart, in front of a homeowner with a calculator.
 *
 * Largest remainder: everyone gets their floor, and the leftover cents go to
 * whoever was rounded down hardest. The result is in the order it was given.
 */
export function apportionCents(totalCents: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const sum = weights.reduce((n, w) => n + Math.max(0, w), 0);
  if (sum <= 0 || totalCents === 0) return weights.map(() => 0);

  const exact = weights.map((w) => (Math.max(0, w) * totalCents) / sum);
  const out = exact.map((n) => Math.floor(n));
  let left = totalCents - out.reduce((n, v) => n + v, 0);

  const order = exact
    .map((n, i) => ({ i, frac: n - Math.floor(n) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  for (let k = 0; left > 0 && k < order.length; k++, left--) out[order[k].i] += 1;
  return out;
}

// ---------------------------------------------------------------------------
// Lender products — what the money costs, and what it therefore has to sticker
// ---------------------------------------------------------------------------

/**
 * The monthly payment on a loan, from the product's own terms.
 *
 * An ESTIMATE, and labelled as one wherever it is shown. Once a credit
 * application comes back, `SolarFinance.loanMonthlyPaymentCents` holds the
 * lender's own figure and that one wins everywhere — promotional periods, fees
 * and re-amortisation all mean a computed number can differ from the one the
 * customer is actually held to. This exists because a rep still has to quote a
 * payment on the day, before any approval exists, and typing one from memory is
 * how a transposed digit reaches a signed proposal.
 *
 * Returns null rather than a number whenever the terms cannot produce one. A
 * payment of NaN or Infinity rendered to a homeowner is worse than no payment.
 */
export function loanPaymentCents(input: {
  /** Contract price minus any down payment, cents. */
  principalCents: number;
  /** Null is read as 0% — the interest-free promotional case. */
  aprPct: number | null;
  termMonths: number | null;
}): number | null {
  const { principalCents, termMonths } = input;
  const aprPct = input.aprPct ?? 0;

  if (!termMonths || termMonths <= 0) return null;
  if (!(principalCents > 0)) return null;
  if (aprPct < 0) return null;

  // r = 0 makes the amortisation formula 0/0, so interest-free is its own case
  // rather than a limit the formula is trusted to reach.
  if (aprPct === 0) return Math.round(principalCents / termMonths);

  const r = aprPct / 100 / 12;
  const payment = (principalCents * r) / (1 - Math.pow(1 + r, -termMonths));
  return Number.isFinite(payment) ? Math.round(payment) : null;
}

/**
 * The sticker price per watt that leaves `netPpwCents` after the lender's cut.
 *
 * The dealer fee is a percentage OF GROSS, not a markup on net, so this is
 * `net / (1 - fee)` and not `net * (1 + fee)`. Getting that backwards
 * under-prices an 18% fee by about three cents a watt — roughly $300 on a
 * 10 kW system, silently, on every deal.
 *
 * Null when the arithmetic has no honest answer: a fee at or above 100% divides
 * by zero or goes negative, and a sticker price of -$4.20/W would otherwise be
 * quoted without complaint.
 */
export function grossPpwFromNet(netPpwCents: number, dealerFeePct: number): number | null {
  if (!(netPpwCents > 0)) return null;
  if (dealerFeePct < 0 || dealerFeePct >= 100) return null;
  return Math.round(netPpwCents / (1 - dealerFeePct / 100));
}

/**
 * What the company actually keeps per installed watt, out of a sticker it quoted.
 *
 * The exact inverse of `grossPpwFromNet` above — `sticker × (1 − fee)` where
 * that one is `base ÷ (1 − fee)` — and it exists as its own function because
 * the two directions are asked at different moments. Pricing a deal goes
 * forwards: here is the margin we want, what does it sticker at. Policing one
 * goes backwards: here is what was quoted, what did we actually end up with.
 *
 * THE BACKWARDS DIRECTION IS THE HONEST ONE UNDER A CAP. `capStickerToFinalPpw`
 * can lower the sticker after the fact — a capped partner funds one number
 * whatever was typed — and once it has, the base a rep entered is no longer the
 * base anybody is getting. Amos at $5.50/W and a 65% fee leaves $1.93/W however
 * confidently $3.00 was typed into the box.
 *
 * A fee this file would stand down (negative, or 100% and over) is stood down
 * here too, so the answer never disagrees with `pricePurchase` about the same
 * deal.
 */
export function basePpwFromSticker(stickerPpwCents: number, dealerFeePct: number): number {
  const f =
    Number.isFinite(dealerFeePct) && dealerFeePct > 0 && dealerFeePct < 100
      ? dealerFeePct / 100
      : 0;
  return Math.round(stickerPpwCents * (1 - f));
}

/**
 * Is this deal leaving the company less per watt than the lender demands?
 *
 * The one place the floor rule lives, because it is asked in three — the
 * builder as the rep types, the readiness check before a proposal generates,
 * and the re-price action behind a proposal already sent. Three copies of a
 * comparison is three chances to get the null case backwards, and getting it
 * backwards here blocks every deal on every lender that has no floor at all.
 *
 * Null or non-positive floor means no floor: the default, and every lender
 * until somebody sets one.
 */
export function underBaseFloor(
  stickerPpwCents: number,
  dealerFeePct: number,
  minBasePpwCents: number | null | undefined
): boolean {
  if (minBasePpwCents == null || !(minBasePpwCents > 0)) return false;
  return basePpwFromSticker(stickerPpwCents, dealerFeePct) < minBasePpwCents;
}

/**
 * What a capped lender does to a deal.
 *
 * `stickerPpwCents` is what to hand `pricePurchase`; the rest is what the rep
 * needs told, because a price that silently moved is a price nobody trusts.
 */
/** Whether a partner's stated $/W is a ceiling or the price itself. */
export type FinalPpwMode = "cap" | "flat";

export type FinalPpwCap = {
  /** The system sticker to price with. Unchanged when the cap did not bite. */
  stickerPpwCents: number;
  /** True when the cap actually lowered the price. */
  capped: boolean;
  /**
   * True when the adders alone, grossed up, already exceed the cap — there is
   * no system price low enough to get under it, so the sticker floors at zero
   * and the contract comes out ABOVE the cap. The one case this function
   * cannot honour, surfaced rather than swallowed.
   */
  adderOverrun: boolean;
};

/**
 * Hold a lender's contract to its maximum price per watt.
 *
 * THE CAP IS ON THE CONTRACT, NOT THE STICKER. "Five fifty a watt, fee
 * included" is a statement about the number at the bottom of the agreement —
 * the system and the re-roof and the lender's cut, all of it, divided by the
 * installed watts. Capping the sticker instead would let a $14,500 adder push
 * the real figure to $7.15/W while every screen went on claiming $5.50.
 *
 * So the contract is pinned first and the system sticker is solved backwards
 * out of it. The adders still gross up by the fee — the lender advances them
 * too and keeps its percentage of them, and that does not stop being true
 * because a ceiling exists — which leaves the SYSTEM as the only line with any
 * give in it. That is the whole behaviour in one sentence: under a cap, extra
 * work comes out of the company's side, and the homeowner's number never moves.
 *
 * TWO RULES, ONE SOLVE — `mode` decides which.
 *
 * `cap` is a CEILING. A deal already priced under it is left exactly where it
 * is: protection against quoting a partner more than they fund, not a floor
 * that drags cheap deals up to it.
 *
 * `flat` is THE PRICE. The partner's paper is this figure per watt and nothing
 * moves it — not the base a rep typed, not the extra work, not the size of the
 * array — so the solve runs in both directions and a deal that would have come
 * out cheaper is written at the partner's own number. Amos Capital Fund sells
 * this way: $5.50/W, and the only thing anybody chooses is which of their
 * products it goes on.
 *
 * The arithmetic is identical either way, which is the point of not writing it
 * twice: pin the contract, solve the system sticker backwards out of it, leave
 * the adders grossing up by the fee. Only the question "does this rule bite?"
 * differs, and on `flat` the answer is always yes.
 */
export function capStickerToFinalPpw(input: {
  /** What this deal would sticker at with no rule — base ÷ (1 − fee). */
  stickerPpwCents: number;
  /** The lender's figure, cents per watt. Null or ≤ 0 means no rule at all. */
  maxFinalPpwCents: number | null | undefined;
  /**
   * Whether that figure is a ceiling or the price. Defaults to `cap`, so every
   * caller written before flat partners existed keeps its exact behaviour.
   */
  mode?: FinalPpwMode;
  systemSizeKwDc: number;
  dealerFeePct: number;
  adderTotalCents: number;
}): FinalPpwCap {
  const uncapped: FinalPpwCap = {
    stickerPpwCents: input.stickerPpwCents,
    capped: false,
    adderOverrun: false,
  };

  const max = input.maxFinalPpwCents;
  if (max == null || !(max > 0)) return uncapped;

  const systemWatts = Math.round(input.systemSizeKwDc * 1000);
  if (systemWatts <= 0) return uncapped;

  // The same fee guard `pricePurchase` applies, so the two agree about what
  // the adders gross up to. A fee it would stand down must not be honoured here.
  const rawPct = input.dealerFeePct;
  const f = Number.isFinite(rawPct) && rawPct > 0 && rawPct < 100 ? rawPct / 100 : 0;

  const adderTotalCents = Math.round(input.adderTotalCents);
  const adderStickerCents = f > 0 ? Math.round(adderTotalCents / (1 - f)) : adderTotalCents;

  const uncappedContract = Math.round(systemWatts * input.stickerPpwCents) + adderStickerCents;
  const cappedContract = max * systemWatts;
  // A ceiling only bites downwards. A flat price is the price, so it binds a
  // deal that would have come out cheaper just as firmly as one that came out
  // dear — that is the entire difference between the two modes.
  if (input.mode !== "flat" && uncappedContract <= cappedContract) return uncapped;

  // What is left for the array once the grossed-up extras have taken their
  // share of the ceiling. Negative means the extras alone have blown through
  // it, and no system price — not even a free one — brings this contract under
  // the cap. Flooring at zero keeps a negative price per watt off the screen.
  const baseStickerCents = cappedContract - adderStickerCents;
  if (baseStickerCents <= 0) {
    return { stickerPpwCents: 0, capped: true, adderOverrun: true };
  }

  /**
   * The sticker is a whole number of cents per watt — the granularity the whole
   * model stores prices at, `SolarFinance.grossPpwCents` being an integer — so
   * the solved figure almost never lands exactly on the partner's number. Which
   * way it is taken depends on what that number MEANS.
   *
   * A MAXIMUM rounds DOWN. Rounding up half the time quotes a partner a few
   * cents a watt more than they fund, which on a 20 kW job is a real number and
   * is the one outcome a ceiling exists to prevent. Under is always safe.
   *
   * A FLAT price rounds to NEAREST, because there the target is not a limit to
   * stay under but a figure to land on: a partner selling at $5.50/W wants
   * $5.50/W on the paper, and floor prints $5.49 on any job carrying adders.
   * Half a cent per watt either side of a published price is the closest a
   * whole-cent sticker can get to it.
   */
  const exact = baseStickerCents / systemWatts;
  const stickerPpwCents = input.mode === "flat" ? Math.round(exact) : Math.floor(exact);
  return {
    stickerPpwCents,
    // Whether the RULE MOVED THE PRICE, which is what every caller shows a
    // human. A flat partner whose figure happens to land on the price the deal
    // already had has not overridden anybody, and saying so would put a notice
    // on a screen with nothing to explain.
    capped: stickerPpwCents !== input.stickerPpwCents,
    adderOverrun: false,
  };
}

/**
 * What a SAVED deal prices at today, held to its partner's ceiling.
 *
 * `pricePurchase` prices whatever sticker it is handed. That is right for the
 * builder, where the rep is typing the price — and wrong for every screen that
 * reads the STORED sticker back, because the stored figure is only as capped as
 * the lender was on the day it was saved.
 *
 * The gap that produced this: `financeRowForProduct` caps at save and
 * generation caps and writes back, so a deal priced after its partner had a
 * ceiling is fine. Set the ceiling AFTERWARDS — which is what happens, since
 * nobody publishes a rate sheet before they have quoted anything on it — and
 * every deal already on that partner keeps its uncapped sticker. The proposal
 * builder recomputes and shows the capped figure; the deal page and the payroll
 * engine read the row and did not. One deal, $5.50/W on one screen and $8.57/W
 * on the next, and the rep quoted from whichever they opened first.
 *
 * So the ceiling is applied wherever the deal is priced, not only where it is
 * written. Nothing is stored here: a cap set in Settings still does not rewrite
 * a saved row — see the note in proposal-generate.ts — it just stops every
 * screen quoting a contract the partner will not fund.
 *
 * `capped` comes back so the UI can SAY the price is being held rather than
 * silently printing a number that does not divide by the base above it.
 */
export function priceStoredPurchase(input: PurchaseInput & {
  /** The partner's stated final $/W. Null, or cash, means no rule at all. */
  maxFinalPpwCents: number | null | undefined;
  /** Whether that figure is a ceiling or the price. Defaults to `cap`. */
  finalPpwMode?: FinalPpwMode;
}): { breakdown: PurchaseBreakdown; cap: FinalPpwCap } {
  const cap = capStickerToFinalPpw({
    stickerPpwCents: input.stickerPpwCents,
    // Cash has no lender and therefore no partner rule — the same line the
    // builder's price card and the finance-row save already draw.
    maxFinalPpwCents: input.product === "cash" ? null : input.maxFinalPpwCents,
    mode: input.finalPpwMode,
    systemSizeKwDc: input.systemSizeKwDc,
    dealerFeePct: input.dealerFeePct,
    adderTotalCents: input.adderTotalCents,
  });
  return {
    breakdown: pricePurchase({ ...input, stickerPpwCents: cap.stickerPpwCents }),
    cap,
  };
}

/**
 * A lease product prices per kW-DC per month; `priceThirdParty` takes a fixed
 * monthly. This is the one line between them, kept here so the conversion is
 * not re-derived at each call site.
 */
export function leaseMonthlyCents(rateCentsPerKwMonth: number, systemSizeKwDc: number): number {
  return Math.round(rateCentsPerKwMonth * systemSizeKwDc);
}

// ---------------------------------------------------------------------------
// Lease & PPA — electricity, sold per month or per kWh
//
// Deliberately a separate function with a separate input type. There is no
// gross price, no dealer fee and no PPW here, so none of the purchase maths
// applies. What the customer buys is a stream of payments.
// ---------------------------------------------------------------------------

export type ThirdPartyInput = {
  product: "lease" | "ppa";
  /** PPA: price per kWh in mills (tenths of a cent). */
  rateMillsPerKwh?: number;
  /** Lease: fixed monthly payment, cents. */
  monthlyPaymentCents?: number;
  escalatorPct: number;
  termYears: number;
  year1ProductionKwh: number;
  /**
   * The array is still physically installed on a lease or PPA, so the system
   * size is real even though there is no system PRICE. Carried through so a
   * per-watt commission rule can pay on a third-party-owned deal.
   */
  systemSizeKwDc: number;
};

export type ThirdPartyBreakdown = {
  /** Real installed watts. There is no system price, but there is a system. */
  systemWatts: number;
  year1CostCents: number;
  /** Total the customer pays across the term, with the escalator applied. */
  lifetimeCostCents: number;
  /** Blended effective rate over the term, in mills. */
  effectiveRateMills: number;
};

/** Price a lease or PPA. Never reuses the purchase formula — see the note above. */
export function priceThirdParty(input: ThirdPartyInput, a: SolarAssumptions): ThirdPartyBreakdown {
  const years = Math.max(0, input.termYears);
  let lifetimeCostCents = 0;
  let lifetimeKwh = 0;
  let year1CostCents = 0;

  for (let year = 1; year <= years; year++) {
    const escalation = Math.pow(1 + input.escalatorPct / 100, year - 1);
    const kwh = productionInYear(input.year1ProductionKwh, year, a);
    lifetimeKwh += kwh;

    const yearCost =
      input.product === "ppa"
        ? // PPA: you pay for what it makes, so degradation lowers the bill too.
          (kwh * (input.rateMillsPerKwh ?? 0) * escalation) / 10
        : // Lease: fixed monthly regardless of output.
          (input.monthlyPaymentCents ?? 0) * 12 * escalation;

    if (year === 1) year1CostCents = Math.round(yearCost);
    lifetimeCostCents += yearCost;
  }

  return {
    systemWatts: Math.round(input.systemSizeKwDc * 1000),
    year1CostCents,
    lifetimeCostCents: Math.round(lifetimeCostCents),
    effectiveRateMills: lifetimeKwh > 0 ? (lifetimeCostCents * 10) / lifetimeKwh : 0,
  };
}

// ---------------------------------------------------------------------------
// Commission
// ---------------------------------------------------------------------------

export type SolarCommissionBasis =
  | { type: "ppw"; ratePerWattCents: number }
  | { type: "margin"; percent: number }
  | { type: "percentage"; percent: number }
  | { type: "flat"; amountCents: number };

/**
 * What a rep earns on a solar deal.
 *
 * Cash/loan pay on PPW or margin — both computed from the GROSS price (base
 * plus adders, before the lender's cut), never the final, so a rep is not paid
 * on the dealer fee.
 *
 * Lease/PPA have no system price, so PPW and margin are meaningless: a
 * percentage basis applies to the year-one customer cost, and flat is flat.
 * Feeding a PPA into the loan formula is the mistake this signature prevents.
 */
export function solarCommissionCents(
  product: FinanceProduct,
  basis: SolarCommissionBasis,
  deal: { purchase?: PurchaseBreakdown; thirdParty?: ThirdPartyBreakdown }
): number {
  if (basis.type === "flat") return basis.amountCents;

  if (product === "cash" || product === "loan") {
    const p = deal.purchase;
    if (!p) return 0;
    switch (basis.type) {
      case "ppw":
        return Math.round(p.systemWatts * basis.ratePerWattCents);
      case "margin":
        return Math.round(p.marginCents * (basis.percent / 100));
      case "percentage":
        // Gross, not final: paying a percentage of the dealer fee pays the rep
        // on money the company never receives.
        return Math.round(p.grossPriceCents * (basis.percent / 100));
    }
  }

  // ── Lease / PPA ─────────────────────────────────────────────────────────
  const t = deal.thirdParty;
  if (!t) return 0;
  switch (basis.type) {
    case "ppw":
      // The array is still installed, so per-watt pays normally. Without this a
      // rep on a PPW rule would earn NOTHING on every TPO deal they closed —
      // silently, because the formula would just return zero.
      return Math.round(t.systemWatts * basis.ratePerWattCents);
    case "percentage":
      return Math.round(t.year1CostCents * (basis.percent / 100));
    case "margin":
      // Genuinely does not exist: a third party owns the system, so there is no
      // cost basis of ours to take a margin on. Use PPW or flat for TPO.
      return 0;
  }
}
