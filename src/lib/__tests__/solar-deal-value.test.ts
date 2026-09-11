import { describe, it, expect } from "vitest";
import {
  formatSolarDealValue,
  snapshotPriceSource,
  solarDealValue,
  solarLeadValueCents,
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
      contractPriceCents: 8_266_000,
      monthlyPaymentCents: null,
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
