import { describe, it, expect } from "vitest";
import { priceUnits, pricePurchase } from "@/lib/solar-money";

/**
 * The ladder over a countable thing.
 *
 * These are the storage numbers from the spec's worked example, asserted here
 * rather than on a screen: two Powerwalls at a $13,000 base through a 25%
 * programme, a main-panel upgrade, and a per-battery rebate the company passes
 * through. Every rule `pricePurchase` keeps has to keep holding when the thing
 * being counted stops being watts.
 */
describe("priceUnits", () => {
  // base 13_000_00 / 0.75 = 17_333_33 cents a battery, fee included.
  const TWO_BATTERIES = {
    product: "loan" as const,
    units: 2,
    stickerPerUnitCents: 17_333_33,
    dealerFeePct: 25,
    adderTotalCents: 2_700_00,
    rebateTotalCents: 1_000_00,
  };

  it("prices two batteries the way the spec's worked example does", () => {
    const b = priceUnits(TWO_BATTERIES);
    expect(b.contractPriceCents).toBe(36_933_33);
    expect(b.grossPriceCents).toBe(27_699_99);
    expect(b.dealerFeeCents).toBe(b.contractPriceCents - b.grossPriceCents);
  });

  it("keeps the invariant a homeowner checks with a calculator", () => {
    const b = priceUnits(TWO_BATTERIES);
    expect(b.baseStickerCents + b.adderStickerCents - b.rebateStickerCents).toBe(
      b.contractPriceCents
    );
  });

  it("takes the rebate off gross at face and off the contract grossed up", () => {
    const without = priceUnits({ ...TWO_BATTERIES, rebateTotalCents: 0 });
    const with_ = priceUnits(TWO_BATTERIES);
    expect(with_.grossPriceCents).toBe(without.grossPriceCents - 1_000_00);
    // The customer's side carries the fee the company no longer collects on it.
    expect(with_.contractPriceCents).toBe(without.contractPriceCents - 1_333_33);
  });

  it("an on-top adder does not gross up and does not move the base", () => {
    const b = priceUnits({
      product: "loan",
      units: 2,
      stickerPerUnitCents: 17_333_33,
      dealerFeePct: 25,
      adderTotalCents: 0,
      onTopAdderTotalCents: 7_000_00,
    });
    expect(b.adderStickerCents).toBe(7_000_00);
    expect(b.contractPriceCents).toBe(b.baseStickerCents + 7_000_00);
  });

  it("refuses a dealer fee on cash", () => {
    const b = priceUnits({
      product: "cash",
      units: 2,
      stickerPerUnitCents: 10_000_00,
      dealerFeePct: 25,
      adderTotalCents: 0,
    });
    expect(b.dealerFeeCents).toBe(0);
    expect(b.basePriceCents).toBe(20_000_00);
  });

  it("stands a fee of 100% or more down rather than dividing by zero", () => {
    const b = priceUnits({
      product: "loan",
      units: 1,
      stickerPerUnitCents: 10_000_00,
      dealerFeePct: 100,
      adderTotalCents: 1_000_00,
    });
    expect(Number.isFinite(b.contractPriceCents)).toBe(true);
    expect(b.dealerFeeCents).toBe(0);
  });

  it("prices nothing at no units rather than dividing by them", () => {
    const b = priceUnits({
      product: "loan",
      units: 0,
      stickerPerUnitCents: 17_333_33,
      dealerFeePct: 25,
      adderTotalCents: 0,
    });
    expect(b.baseStickerCents).toBe(0);
    expect(b.basePerUnitCents).toBe(0);
    expect(b.finalPerUnitCents).toBe(0);
  });
});

/**
 * The per-watt path is the same function with watts in it, and this is the
 * proof. Every assertion here describes behaviour that predates the
 * generalisation and must survive it untouched.
 */
describe("pricePurchase still prices PV exactly as it did", () => {
  const pv = {
    product: "loan" as const,
    systemSizeKwDc: 10.14,
    stickerPpwCents: 350,
    dealerFeePct: 18,
    adderTotalCents: 14_500_00,
    onTopAdderTotalCents: 0,
  };

  it("is unchanged with no rebate", () => {
    const b = pricePurchase(pv);
    expect(b.systemWatts).toBe(10_140);
    expect(b.baseStickerCents).toBe(10_140 * 350);
    expect(b.baseStickerCents + b.adderStickerCents).toBe(b.contractPriceCents);
    expect(b.grossPriceCents + b.dealerFeeCents).toBe(b.contractPriceCents);
  });

  it("reports a zero rebate rather than leaving the field undefined", () => {
    const b = pricePurchase(pv);
    expect(b.rebateTotalCents).toBe(0);
    expect(b.rebateStickerCents).toBe(0);
  });

  it("takes a rebate off gross before the fee when one is applied", () => {
    const without = pricePurchase(pv);
    const with_ = pricePurchase({ ...pv, rebateTotalCents: 1_000_00 });
    expect(with_.grossPriceCents).toBe(without.grossPriceCents - 1_000_00);
    expect(with_.contractPriceCents).toBeLessThan(without.contractPriceCents);
  });

  it("still keeps the per-watt rates it always reported", () => {
    const b = pricePurchase(pv);
    expect(b.finalPpwCents).toBeCloseTo(b.contractPriceCents / 10_140, 9);
    expect(b.basePpwCents).toBeCloseTo(b.basePriceCents / 10_140, 9);
    expect(b.grossPpwCents).toBeCloseTo(b.grossPriceCents / 10_140, 9);
  });
});
