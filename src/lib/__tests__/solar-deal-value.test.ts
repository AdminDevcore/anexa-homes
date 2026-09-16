import { describe, it, expect } from "vitest";
import {
  formatSolarDealValue,
  snapshotPriceSource,
  solarDealValue,
  solarLeadValueCents,
  solarContractRevenueCents,
} from "@/lib/solar-deal-value";
import type { SnapshotFinancing } from "@/lib/solar-proposal";

/** The deal page's own formatter, near enough — cents in, dollars out. */
const money = (cents: number) =>
  (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

const priced = {
  product: "loan" as const,
  contractPriceCents: 8_266_000,
  netAfterCreditsCents: null,
  monthlyPaymentCents: null,
  rateMillsPerKwh: null,
};

describe("what a solar deal is worth", () => {
  it("a purchase is what the household NETS, not what the paper says", () => {
    // The change: the credits drive the payment, the customer's own document
    // leads with the net, and a pipeline totalling contracts was adding up a
    // figure no household was ever asked for.
    const withCredits = { ...priced, netAfterCreditsCents: 4_133_000 };
    expect(solarDealValue(withCredits)).toEqual({ kind: "total", cents: 4_133_000 });
    expect(formatSolarDealValue(solarDealValue(withCredits), money)).toBe("$41,330");
    // And the column every list sums agrees with the card, by being it.
    expect(solarLeadValueCents(withCredits)).toBe(4_133_000);
  });

  it("a system the credits cover entirely is worth nothing, and says so", () => {
    // A zero NET is a real answer and must not fall through to the contract —
    // which is why the fallback turns on the field being absent, not falsy.
    expect(solarDealValue({ ...priced, netAfterCreditsCents: 0 })).toEqual({
      kind: "total",
      cents: 0,
    });
  });

  it("falls back to the contract where the document claims nothing", () => {
    expect(solarDealValue(priced)).toEqual({ kind: "total", cents: 8_266_000 });
    expect(formatSolarDealValue(solarDealValue(priced), money)).toBe("$82,660");
    expect(solarDealValue({ ...priced, product: "cash" })).toEqual({
      kind: "total",
      cents: 8_266_000,
    });
  });

  it("a lease is a monthly and a PPA is a rate — never a contract price", () => {
    // The defect this guards: a lease row can still be carrying a loan's
    // contract price from before the product was switched. Quoting it back as
    // the deal's value invents a total nobody signed.
    const lease = solarDealValue({
      product: "lease",
      contractPriceCents: 8_266_000,
      netAfterCreditsCents: null,
      monthlyPaymentCents: 17_500,
      rateMillsPerKwh: null,
    });
    expect(lease).toEqual({ kind: "monthly", cents: 17_500 });
    expect(formatSolarDealValue(lease, money)).toBe("$175/mo");

    const ppa = solarDealValue({
      product: "ppa",
      contractPriceCents: 8_266_000,
      netAfterCreditsCents: null,
      monthlyPaymentCents: 17_500,
      rateMillsPerKwh: 145,
    });
    expect(ppa).toEqual({ kind: "rate", millsPerKwh: 145 });
    // To the MILL. Rounded to the cent every rate in the market prints $0.15.
    expect(formatSolarDealValue(ppa, money)).toBe("$0.145/kWh");
  });

  it("zero is 'not priced yet', not a price of nothing", () => {
    // The whole defect: a solar deal read $0 as though somebody had agreed to
    // it. An unpriced deal has to LOOK unpriced.
    const none = solarDealValue({
      product: "loan",
      contractPriceCents: 0,
      netAfterCreditsCents: null,
      monthlyPaymentCents: null,
      rateMillsPerKwh: null,
    });
    expect(none).toEqual({ kind: "none" });
    expect(formatSolarDealValue(none, money)).toBe("—");
    expect(solarDealValue(null)).toEqual({ kind: "none" });
  });

  it("a deal with no product decided yet is still priced as a total", () => {
    expect(
      solarDealValue({
        product: null,
        contractPriceCents: 5_000_000,
        netAfterCreditsCents: null,
        monthlyPaymentCents: null,
        rateMillsPerKwh: null,
      })
    ).toEqual({ kind: "total", cents: 5_000_000 });
  });
});

describe("what gets stamped onto Lead.value", () => {
  it("a purchase stamps its contract price", () => {
    expect(solarLeadValueCents(priced)).toBe(8_266_000);
  });

  it("reads the ladder out of a frozen document, a level down", () => {
    const f = {
      product: "loan",
      finalPriceCents: 8_266_000,
      leaseMonthlyCents: null,
      rateMillsPerKwh: null,
      creditLadder: { netCostCents: 4_133_000 },
    } as unknown as SnapshotFinancing;
    expect(snapshotPriceSource(f).netAfterCreditsCents).toBe(4_133_000);
    expect(solarLeadValueCents(snapshotPriceSource(f))).toBe(4_133_000);

    // A document generated before the ladder existed has no such key, and the
    // honest reading of that is the contract it was actually quoted at.
    const older = { ...f, creditLadder: undefined } as unknown as SnapshotFinancing;
    expect(snapshotPriceSource(older).netAfterCreditsCents).toBeNull();
    expect(solarLeadValueCents(snapshotPriceSource(older))).toBe(8_266_000);
  });

  it("a lease and a PPA stamp zero — there is no contract total to add up", () => {
    // Not the stale loan figure: a pipeline that keeps summing a contract the
    // customer switched off is worse than one that reports nothing.
    expect(
      solarLeadValueCents({
        product: "lease",
        contractPriceCents: 8_266_000,
        netAfterCreditsCents: null,
        monthlyPaymentCents: 17_500,
        rateMillsPerKwh: null,
      })
    ).toBe(0);
    expect(
      solarLeadValueCents({
        product: "ppa",
        contractPriceCents: 8_266_000,
        netAfterCreditsCents: null,
        monthlyPaymentCents: null,
        rateMillsPerKwh: 145,
      })
    ).toBe(0);
  });
});

describe("contract revenue is the gross, never the after-credit net", () => {
  /**
   * THE REGRESSION THIS FILE EXISTS FOR.
   *
   * A $56,000 solar contract was reported as $39,200 of revenue — exactly
   * $56,000 × 0.70 — because every revenue surface read `Project.contractValue`,
   * which on solar had been stamped from `Lead.value`, which is the household's
   * net after the 30% federal credit.
   *
   * A tax credit is claimed by the homeowner on their own return. It is not a
   * discount the company gave and it must never reduce booked revenue.
   */
  const CONTRACT = 5_600_000; // $56,000
  const NET_AFTER_30PCT_ITC = 3_920_000; // $39,200

  it("a $56,000 contract is $56,000 of revenue even when a 30% credit is quoted", () => {
    const src = {
      product: "loan" as const,
      contractPriceCents: CONTRACT,
      netAfterCreditsCents: NET_AFTER_30PCT_ITC,
      monthlyPaymentCents: null,
      rateMillsPerKwh: null,
    };
    expect(solarContractRevenueCents(src)).toBe(CONTRACT);
    // …and the two answers stay distinct rather than one overwriting the other.
    expect(solarLeadValueCents(src)).toBe(NET_AFTER_30PCT_ITC);
    expect(solarContractRevenueCents(src)).not.toBe(solarLeadValueCents(src));
  });

  it("is unmoved by how many credits the deal claims", () => {
    const base = {
      product: "loan" as const,
      contractPriceCents: CONTRACT,
      monthlyPaymentCents: null,
      rateMillsPerKwh: null,
    };
    // ITC only, ITC + both bonuses (50%), and nothing claimed at all.
    expect(solarContractRevenueCents({ ...base, netAfterCreditsCents: 3_920_000 })).toBe(CONTRACT);
    expect(solarContractRevenueCents({ ...base, netAfterCreditsCents: 2_800_000 })).toBe(CONTRACT);
    expect(solarContractRevenueCents({ ...base, netAfterCreditsCents: null })).toBe(CONTRACT);
  });

  it("a cash deal books its contract exactly like a financed one", () => {
    const cash = {
      product: "cash" as const,
      contractPriceCents: CONTRACT,
      netAfterCreditsCents: NET_AFTER_30PCT_ITC,
      monthlyPaymentCents: null,
      rateMillsPerKwh: null,
    };
    expect(solarContractRevenueCents(cash)).toBe(CONTRACT);
  });

  it("books nothing on a lease or a PPA — the household buys no system", () => {
    expect(
      solarContractRevenueCents({
        product: "lease",
        contractPriceCents: null,
        netAfterCreditsCents: null,
        monthlyPaymentCents: 18_500,
        rateMillsPerKwh: null,
      })
    ).toBe(0);
    expect(
      solarContractRevenueCents({
        product: "ppa",
        contractPriceCents: null,
        netAfterCreditsCents: null,
        monthlyPaymentCents: null,
        rateMillsPerKwh: 145,
      })
    ).toBe(0);
  });

  it("an unpriced deal books nothing rather than a sale of zero", () => {
    expect(solarContractRevenueCents(null)).toBe(0);
    expect(solarContractRevenueCents(undefined)).toBe(0);
    expect(
      solarContractRevenueCents({
        product: "loan",
        contractPriceCents: 0,
        netAfterCreditsCents: null,
        monthlyPaymentCents: null,
        rateMillsPerKwh: null,
      })
    ).toBe(0);
  });

  it("reads the contract straight off a frozen snapshot", () => {
    const financing = {
      product: "loan",
      finalPriceCents: CONTRACT,
      creditLadder: { netCostCents: NET_AFTER_30PCT_ITC },
      leaseMonthlyCents: null,
      rateMillsPerKwh: null,
    } as unknown as SnapshotFinancing;
    expect(solarContractRevenueCents(snapshotPriceSource(financing))).toBe(CONTRACT);
  });
});
