import { describe, it, expect } from "vitest";
import {
  basisGaps,
  compareOffers,
  CASH_OFFER_ID,
  type CompareBasis,
  type OfferProduct,
} from "@/lib/solar-compare";

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
