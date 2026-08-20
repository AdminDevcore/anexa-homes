import { describe, it, expect } from "vitest";
import { compareOffers, CASH_OFFER_ID, type CompareBasis, type OfferProduct } from "@/lib/solar-compare";

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
  // $2.80/W net is what the company keeps, whatever the lender charges.
  targetNetPpwCents: 280,
  typedGrossPpwCents: 350,
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

  it("falls back to the typed sticker when no net target is set", () => {
    // A company that prices by hand still gets a comparison; it is just quoted
    // at the same sticker across every lender.
    const rows = compareOffers([loan(), loan({ id: "p2", dealerFeePct: 28 })], {
      ...BASIS,
      targetNetPpwCents: null,
    });
    expect(rows[0].grossPpwCents).toBe(350);
    expect(rows[1].grossPpwCents).toBe(350);
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
