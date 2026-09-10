import { describe, it, expect } from "vitest";
import {
  basisGaps,
  compareOffers,
  CASH_OFFER_ID,
  type CompareBasis,
  type OfferProduct,
} from "@/lib/solar-compare";
import { grossPpwFromNet, loanPaymentCents, priceStoredPurchase } from "@/lib/solar-money";

/**
 * What a rep puts in front of a homeowner when four ways to pay are on the
 * table at once.
 *
 * Every figure here is checked against arithmetic done by hand rather than
 * against what the implementation returns, because these are the numbers a
 * customer chooses between: a comparison that quietly prices one column on a
 * different basis than the next is worse than no comparison at all.
 */

const BASIS: CompareBasis = {
  systemSizeKwDc: 8,
  year1ProductionKwh: 12_000,
  adderTotalCents: 0,
  onTopAdderTotalCents: 0,
  downPaymentCents: 0,
  // $2.80/W is what the company charges, whatever the lender then adds.
  basePpwCents: 280,
  annualDegradationPct: 0.5,
};

const loan = (over: Partial<OfferProduct> = {}): OfferProduct => ({
  id: "p1",
  lenderId: "l1",
  lenderName: "Amos Capital Fund",
  label: "Amos 30 yr",
  finalPpwMode: "cap",
  // No sign-today rule, which is every lender until somebody sets one.
  signTodayMode: "none",
  signTodayFixedCents: null,
  signTodayCapPpwCents: null,
  product: "loan",
  aprPct: 4.99,
  termMonths: 300,
  dealerFeePct: 18,
  leaseRateCentsPerKwMonth: null,
  rateMillsPerKwh: null,
  escalatorPct: null,
  termYears: null,
  factorWithPaydownMicros: null,
  factorWithoutPaydownMicros: null,
  paydownPct: null,
  paydownMonths: null,
  maxFinalPpwCents: null,
  isActive: true,
  ...over,
});

describe("compareOffers — a loan column", () => {
  it("prices the sticker from the net target and the product's own fee", () => {
    // $2.80 net at an 18% fee is 280 / (1 − 0.18) = $3.4146 → 341¢, and
    // 341¢ × 8000 W = $27,280 contract.
    const [row] = compareOffers([loan()], BASIS);
    expect(row.grossPpwCents).toBe(341);
    expect(row.contractPriceCents).toBe(2_728_000);
    expect(row.dealerFeePct).toBe(18);
  });

  it("charges a higher sticker for a dearer lender, so the columns differ", () => {
    // The whole point of the screen: 28% costs the customer more for the same
    // system, because we still have to net $2.80.
    const [cheap, dear] = compareOffers([loan(), loan({ id: "p2", dealerFeePct: 28 })], BASIS);
    expect(dear.grossPpwCents).toBeGreaterThan(cheap.grossPpwCents!);
    expect(dear.contractPriceCents).toBeGreaterThan(cheap.contractPriceCents!);
  });

  it("amortises the payment and totals what is actually handed over", () => {
    // $27,280 at 4.99% over 300 months amortises to $159.3173/mo → 15,932¢,
    // and the term costs 300 × that.
    const [row] = compareOffers([loan()], BASIS);
    expect(row.monthlyCents).toBe(15_932);
    expect(row.totalPaidCents).toBe(15_932 * 300);
    expect(row.fromFactor).toBe(false);
  });

  it("adds the down payment to the total and takes it off the financed amount", () => {
    const [row] = compareOffers([loan()], { ...BASIS, downPaymentCents: 500_000 });
    // Financed is $27,280 − $5,000 = $22,280 → $130.1169/mo → 13,012¢, and the
    // customer still parts with the $5,000.
    expect(row.monthlyCents).toBe(13_012);
    expect(row.totalPaidCents).toBe(13_012 * 300 + 500_000);
  });

  it("lets a published payment factor outrank the amortised estimate", () => {
    // A factor already carries the fee and the promotional structure, so it
    // does not equal our amortisation for the same APR and term.
    const [row] = compareOffers(
      [loan({ factorWithPaydownMicros: 5712, factorWithoutPaydownMicros: 8140, paydownPct: 30, paydownMonths: 18 })],
      BASIS
    );
    // $27,280 × 0.005712 = $155.82
    expect(row.monthlyCents).toBe(15_582);
    expect(row.fromFactor).toBe(true);
    // Never just the flattering one: $27,280 × 0.008140 = $222.0592 → 22,206¢
    expect(row.monthlyWithoutPaydownCents).toBe(22_206);
    // The paydown is money the customer actually pays, so the total carries it.
    expect(row.paydownCents).toBe(818_400);
    expect(row.totalPaidCents).toBe(15_582 * 300 + 818_400);
    // And what it costs if they never make it.
    expect(row.totalPaidWithoutPaydownCents).toBe(22_206 * 300);
  });

  it("prices nothing at all when the deal has no base price", () => {
    // The rep emptied the price box. Every purchase column goes unpriced rather
    // than falling back to a figure nobody typed.
    const rows = compareOffers([loan(), loan({ id: "p2", dealerFeePct: 28 })], {
      ...BASIS,
      basePpwCents: null,
    });
    expect(rows[0].grossPpwCents).toBeNull();
    expect(rows[1].grossPpwCents).toBeNull();
    expect(rows[0].contractPriceCents).toBeNull();
  });
});

describe("compareOffers — lease and PPA columns", () => {
  it("prices a lease per kW-month and escalates it across the term", () => {
    const [row] = compareOffers(
      [
        loan({
          id: "l",
          product: "lease",
          aprPct: null,
          termMonths: null,
          dealerFeePct: null,
          leaseRateCentsPerKwMonth: 1200,
          escalatorPct: 0,
          termYears: 25,
          label: "Amos Lease",
        }),
      ],
      BASIS
    );
    // 8 kW × $12.00/kW-mo = $96.00/mo, and with no escalator the term costs
    // 25 × 12 × $96.
    expect(row.monthlyCents).toBe(9_600);
    expect(row.totalPaidCents).toBe(9_600 * 12 * 25);
    // Electricity, not a system: there is no sticker and no contract price.
    expect(row.grossPpwCents).toBeNull();
    expect(row.contractPriceCents).toBeNull();
  });

  it("prices a PPA on what the array makes, degradation included", () => {
    const [row] = compareOffers(
      [
        loan({
          id: "ppa",
          product: "ppa",
          aprPct: null,
          termMonths: null,
          dealerFeePct: null,
          rateMillsPerKwh: 145,
          escalatorPct: 0,
          termYears: 1,
          label: "Amos PPA",
        }),
      ],
      BASIS
    );
    // One year, no escalator: 12,000 kWh × $0.145 = $1,740 for the year.
    expect(row.totalPaidCents).toBe(174_000);
    // A PPA is quoted per kWh, so there is no meaningful fixed monthly.
    expect(row.monthlyCents).toBeNull();
    expect(row.rateMillsPerKwh).toBe(145);
  });

  it("compounds the escalator rather than adding it", () => {
    const [flat, rising] = compareOffers(
      [
        loan({ id: "a", product: "lease", dealerFeePct: null, leaseRateCentsPerKwMonth: 1200, escalatorPct: 0, termYears: 10, aprPct: null, termMonths: null }),
        loan({ id: "b", product: "lease", dealerFeePct: null, leaseRateCentsPerKwMonth: 1200, escalatorPct: 2.9, termYears: 10, aprPct: null, termMonths: null }),
      ],
      BASIS
    );
    expect(rising.totalPaidCents!).toBeGreaterThan(flat.totalPaidCents!);
    // Sum of a 2.9% geometric series over 10 years is ~11.4× the first year,
    // not 10 × 1.029.
    expect(rising.totalPaidCents!).toBeGreaterThan(flat.totalPaidCents! * 1.13);
  });
});

describe("compareOffers — the cash column", () => {
  it("takes no fee, and the total is simply the contract", () => {
    const [row] = compareOffers([{ kind: "cash" }], BASIS);
    expect(row.id).toBe(CASH_OFFER_ID);
    // No lender means no fee to price around: the net target IS the sticker.
    expect(row.grossPpwCents).toBe(280);
    expect(row.contractPriceCents).toBe(2_240_000);
    expect(row.totalPaidCents).toBe(2_240_000);
    expect(row.monthlyCents).toBeNull();
    expect(row.dealerFeePct).toBe(0);
  });

  it("is the cheapest column whenever a lender charges anything at all", () => {
    // The comparison exists to make this visible rather than argued.
    const [cash, financed] = compareOffers([{ kind: "cash" }, loan()], BASIS);
    expect(cash.contractPriceCents!).toBeLessThan(financed.contractPriceCents!);
  });

  it("carries adders into the contract like any purchase", () => {
    const [row] = compareOffers([{ kind: "cash" }], { ...BASIS, adderTotalCents: 1_450_000 });
    expect(row.contractPriceCents).toBe(2_240_000 + 1_450_000);
  });
});

describe("compareOffers — degenerate input", () => {
  it("declines to quote an unpriced system rather than showing $0", () => {
    // "$0/mo" in front of a rep reads as a real quote in a way a blank never
    // does, so a system with no size answers with nulls.
    const [row] = compareOffers([loan()], { ...BASIS, systemSizeKwDc: 0 });
    expect(row.monthlyCents).toBeNull();
    expect(row.totalPaidCents).toBeNull();
  });

  it("keeps a product whose terms are half-entered, without inventing them", () => {
    const [row] = compareOffers([loan({ termMonths: null })], BASIS);
    // The sticker is still knowable from the fee; the payment is not.
    expect(row.grossPpwCents).toBe(341);
    expect(row.monthlyCents).toBeNull();
    expect(row.totalPaidCents).toBeNull();
  });

  it("names the term the way a rate sheet does", () => {
    expect(compareOffers([loan({ termMonths: 300 })], BASIS)[0].termLabel).toBe("25 yr");
    expect(compareOffers([loan({ termMonths: 18 })], BASIS)[0].termLabel).toBe("18 mo");
    expect(
      compareOffers([loan({ product: "ppa", termMonths: null, termYears: 25, dealerFeePct: null })], BASIS)[0]
        .termLabel
    ).toBe("25 yr");
  });
});

describe("basisGaps — why a whole shelf reads dashes", () => {
  /**
   * A real deal reached the financing step with three arrays drawn and every
   * panel rubbed out of them, so the design saved 0 kW. Every payment, contract
   * price and total on the comparison vanished at once and each card said "the
   * terms on this programme are incomplete" — under two loans whose terms were
   * complete. The blame belongs to the deal, and this is what says so.
   */
  it("names the missing system size, not the lender's terms", () => {
    const noSystem = { ...BASIS, systemSizeKwDc: 0 };
    expect(basisGaps(noSystem)).toEqual({ systemSize: true, pricePerWatt: false });

    const [row] = compareOffers([loan()], noSystem);
    // The terms are all there — the sticker even prices — and still nothing a
    // homeowner asks about can be answered.
    expect(row.grossPpwCents).toBe(341);
    expect(row.termLabel).toBe("25 yr");
    expect(row.monthlyCents).toBeNull();
    expect(row.contractPriceCents).toBeNull();
    expect(row.totalPaidCents).toBeNull();
  });

  it("names a missing price per watt when there is nothing to derive a sticker from", () => {
    const noPrice = { ...BASIS, basePpwCents: null };
    expect(basisGaps(noPrice)).toEqual({ systemSize: false, pricePerWatt: true });
    expect(compareOffers([loan()], noPrice)[0].grossPpwCents).toBeNull();
  });

  it("reports no gap on a deal that can price", () => {
    expect(basisGaps(BASIS)).toEqual({ systemSize: false, pricePerWatt: false });
  });
});

describe("a lender's maximum price per watt reaches the comparison", () => {
  /**
   * The deal from the screenshot that prompted the feature: 8.80 kW, the
   * company's base at $5.68/W, Amos at a 65% dealer fee. Priced the ordinary
   * way that column quoted $142,824 on paper that funds $48,400.
   */
  const AMOS_BASIS: CompareBasis = {
    ...BASIS,
    systemSizeKwDc: 8.8,
    basePpwCents: 568,
  };
  const amos = (over: Partial<OfferProduct> = {}) =>
    loan({ dealerFeePct: 65, maxFinalPpwCents: 550, termMonths: 360, ...over });

  it("prices the column at the cap instead of the grossed-up base", () => {
    const [capped] = compareOffers([amos()], AMOS_BASIS);
    const [uncapped] = compareOffers([amos({ maxFinalPpwCents: null })], AMOS_BASIS);

    expect(uncapped.contractPriceCents).toBe(14_282_400); // $142,824
    expect(capped.contractPriceCents).toBe(4_840_000); //  $48,400
    expect(capped.grossPpwCents).toBe(550);
    expect(capped.capped).toBe(true);
    expect(uncapped.capped).toBe(false);
  });

  it("carries the capped price into the monthly, not just the headline", () => {
    // The whole column has to be priced from one number. A card showing the
    // capped contract above a payment computed from the uncapped one is two
    // different deals on one card, and the payment is the figure a homeowner
    // remembers.
    const [capped] = compareOffers([amos()], AMOS_BASIS);
    const [uncapped] = compareOffers([amos({ maxFinalPpwCents: null })], AMOS_BASIS);
    expect(capped.monthlyCents).toBeLessThan(uncapped.monthlyCents!);
    expect(capped.totalPaidCents).toBeLessThan(uncapped.totalPaidCents!);
  });

  it("reports what the company keeps, because under a cap that is what moves", () => {
    const [row] = compareOffers([amos()], AMOS_BASIS);
    // $5.50/W with 65% going to the lender leaves 35% of it.
    expect(Math.round(row.netPpwCents!)).toBe(193);
    expect(row.maxFinalPpwCents).toBe(550);
  });

  it("does not cap the cash column, which has no lender to cap it", () => {
    // Cash carries no dealer fee, so there is no partner whose maximum applies.
    // Clamping it would cap our own quote against a bank nobody is borrowing
    // from — and would quietly cut the cash price of every capped lender's deal.
    const [cashRow] = compareOffers([{ kind: "cash" }], AMOS_BASIS);
    expect(cashRow.capped).toBe(false);
    expect(cashRow.contractPriceCents).toBe(4_998_400); // $49,984 — the base, untouched
    expect(cashRow.maxFinalPpwCents).toBeNull();
  });

  it("leaves an uncapped lender on the same basis completely alone", () => {
    // Two columns, one basis, one capped: the comparison is only honest if the
    // cap moves the column that carries it and nothing else.
    const other = loan({ id: "p2", lenderId: "l2", lenderName: "Climate First", dealerFeePct: 18 });
    const [amosRow, otherRow] = compareOffers([amos(), other], AMOS_BASIS);
    expect(amosRow.capped).toBe(true);
    expect(otherRow.capped).toBe(false);
    expect(otherRow.grossPpwCents).toBe(693); // 568 / (1 − 0.18)
  });
});

describe("the builder's quoted strip and the shelf above it price one deal", () => {
  /**
   * The reported deal, to the cent: 11.00 kW, Amos Capital Fund at a flat
   * $5.50/W and a 65% dealer fee, 0% over 360 months, base typed at $1.93/W —
   * which is exactly what $5.50 flat leaves the company — and a $2,550
   * trenching adder added afterwards.
   *
   * Three things on the financing step quote that deal: the shelf of lender
   * cards, the strip underneath them, and the unsaved-changes banner beside
   * Save. The shelf priced through `compareOffers` and therefore through the
   * partner's rule; the other two multiplied the typed base out themselves and
   * did not. So one screen said $168.13/mo and $60,526, and the same screen
   * eight inches lower said $188.60/mo and $67,896 — a payment twenty dollars a
   * month dearer, on a partner whose entire selling point is that its price
   * does not move.
   *
   * The strip now prices through `priceStoredPurchase`, which is the same cap
   * and the same arithmetic `compareOffers` runs. This pins the two together on
   * the deal that caught them apart.
   */
  const AMOS_FLAT_BASIS: CompareBasis = {
    ...BASIS,
    systemSizeKwDc: 11,
    basePpwCents: 193,
    adderTotalCents: 255_000,
  };
  const amosFlat = loan({
    dealerFeePct: 65,
    maxFinalPpwCents: 550,
    finalPpwMode: "flat",
    aprPct: 0,
    termMonths: 360,
  });

  /** What the financing step now hands `priceStoredPurchase` for this deal. */
  const strip = (basis: CompareBasis) =>
    priceStoredPurchase({
      product: "loan",
      systemSizeKwDc: basis.systemSizeKwDc,
      stickerPpwCents: grossPpwFromNet(basis.basePpwCents!, 65)!,
      dealerFeePct: 65,
      adderTotalCents: basis.adderTotalCents,
      maxFinalPpwCents: 550,
      finalPpwMode: "flat",
    });

  it("quotes the same contract and the same payment on both", () => {
    const [card] = compareOffers([amosFlat], AMOS_FLAT_BASIS);
    const { breakdown } = strip(AMOS_FLAT_BASIS);

    expect(card.contractPriceCents).toBe(6_052_571); // $60,525.71
    expect(breakdown.contractPriceCents).toBe(card.contractPriceCents);

    const stripMonthly = loanPaymentCents({
      principalCents: breakdown.contractPriceCents,
      aprPct: 0,
      termMonths: 360,
    });
    expect(card.monthlyCents).toBe(16_813); // $168.13
    expect(stripMonthly).toBe(card.monthlyCents);
  });

  it("is not the uncapped arithmetic the strip used to print", () => {
    // $1.93 ÷ 0.35 stickers at $5.51/W, and the adder grosses up on top of it:
    // $67,895.71 and $188.60 a month, on paper that funds $5.50/W. Kept as an
    // explicit expectation so a future change that reintroduces it fails here
    // rather than in front of a homeowner.
    const uncappedSticker = grossPpwFromNet(193, 65)!;
    expect(uncappedSticker).toBe(551);
    const uncapped = uncappedSticker * 11_000 + Math.round(255_000 / 0.35);
    expect(uncapped).toBe(6_789_571); // $67,895.71
    expect(loanPaymentCents({ principalCents: uncapped, aprPct: 0, termMonths: 360 })).toBe(18_860);

    const { breakdown } = strip(AMOS_FLAT_BASIS);
    expect(breakdown.contractPriceCents).toBeLessThan(uncapped);
  });

  it("does not move the homeowner's payment when the adder is added", () => {
    // The rep's complaint in one assertion. Adding work to a flat partner's
    // deal comes out of the company's side: the customer's payment holds, and
    // only what we keep goes down.
    const bare = strip({ ...AMOS_FLAT_BASIS, adderTotalCents: 0 });
    const laden = strip(AMOS_FLAT_BASIS);

    const monthly = (cents: number) =>
      loanPaymentCents({ principalCents: cents, aprPct: 0, termMonths: 360 })!;

    expect(bare.breakdown.contractPriceCents).toBe(6_050_000); // $60,500 — $5.50 × 11 kW
    // Within the half-cent-a-watt the whole-cent sticker can land on either
    // side of a published price — seven cents a month, not twenty dollars.
    // See `capStickerToFinalPpw` for why a flat price rounds to nearest.
    expect(
      Math.abs(monthly(laden.breakdown.contractPriceCents) - monthly(bare.breakdown.contractPriceCents))
    ).toBeLessThanOrEqual(10);
    // Paid for out of the company's side, which is the point of a flat partner:
    // the SYSTEM's share of a price that did not move shrinks by what the
    // trenching costs. Measured on `basePriceCents` and not on the gross, which
    // still carries the adder's own money and therefore barely moves.
    expect(laden.breakdown.basePriceCents).toBeLessThan(bare.breakdown.basePriceCents);
    expect(bare.breakdown.basePriceCents - laden.breakdown.basePriceCents).toBeGreaterThan(200_000);
  });
});

/**
 * THE SECOND PAYMENT — what the loan asks for once the household's federal
 * credits are against it.
 *
 * The figure the customer's own document puts behind its tax-credit switch, so
 * the arithmetic is checked by hand here for the same reason every other figure
 * in this file is: a shelf quoting a payment the proposal will not print is a
 * rep promising something on a laptop that the paperwork then withdraws.
 */
describe("compareOffers — the payment once the credits are applied", () => {
  const CREDITS = {
    rates: { itcPct: 30, energyCommunityPct: 10, domesticContentPct: 10 },
    claims: { itc: true, energyCommunity: true, domesticContent: true },
  };

  it("quotes it on the contract less every credit the job earns", () => {
    // $27,280 contract, 50% of it credited, leaves $13,640 — and $13,640 at
    // 4.99% over 300 months amortises to half the payment beside it.
    const [row] = compareOffers([loan()], { ...BASIS, credits: CREDITS });
    expect(row.netCostAfterCreditsCents).toBe(1_364_000);
    expect(row.creditsAppliedMonthlyCents).toBe(
      loanPaymentCents({ principalCents: 1_364_000, aprPct: 4.99, termMonths: 300 })
    );
    expect(row.creditsAppliedMonthlyCents!).toBeLessThan(row.monthlyCents!);
  });

  it("follows the tick-boxes: an unclaimed bonus is a higher payment", () => {
    const [all] = compareOffers([loan()], { ...BASIS, credits: CREDITS });
    const [itcOnly] = compareOffers([loan()], {
      ...BASIS,
      credits: {
        ...CREDITS,
        claims: { itc: true, energyCommunity: false, domesticContent: false },
      },
    });
    // 30% off rather than 50%, so more is left to finance.
    expect(itcOnly.netCostAfterCreditsCents).toBe(1_909_600);
    expect(itcOnly.creditsAppliedMonthlyCents!).toBeGreaterThan(all.creditsAppliedMonthlyCents!);
  });

  it("says nothing at all when the deal claims no credit", () => {
    const [row] = compareOffers([loan()], {
      ...BASIS,
      credits: {
        ...CREDITS,
        claims: { itc: false, energyCommunity: false, domesticContent: false },
      },
    });
    expect(row.creditsAppliedMonthlyCents).toBeNull();
    expect(row.netCostAfterCreditsCents).toBeNull();
  });

  it("is absent on a basis that carries no credits, as every column was before", () => {
    const [row] = compareOffers([loan()], BASIS);
    expect(row.creditsAppliedMonthlyCents).toBeNull();
  });

  it("never quotes one on cash, which has no payment for a credit to lower", () => {
    const [cash] = compareOffers([{ kind: "cash" }], { ...BASIS, credits: CREDITS });
    expect(cash.id).toBe(CASH_OFFER_ID);
    expect(cash.creditsAppliedMonthlyCents).toBeNull();
  });
});
