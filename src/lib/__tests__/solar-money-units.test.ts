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

import {
  capStickerToFinalUnit,
  capStickerToFinalPpw,
  priceStoragePurchase,
  priceStorageStored,
  underBaseFloor,
} from "@/lib/solar-money";

/**
 * A ceiling per battery is the same ceiling, divided differently.
 *
 * The flat case is the one that matters: a partner selling at a fixed price
 * does not fund a cheaper deal cheaper, so the rule binds in both directions
 * and the sticker has to be solved back down until system + adders lands on the
 * partner's number.
 */
describe("capStickerToFinalUnit", () => {
  it("holds a flat partner to its number per battery", () => {
    const r = capStickerToFinalUnit({
      stickerPerUnitCents: 20_000_00,
      maxFinalPerUnitCents: 16_000_00,
      mode: "flat",
      units: 2,
      dealerFeePct: 25,
      adderTotalCents: 2_700_00,
    });
    expect(r.capped).toBe(true);

    const b = priceUnits({
      product: "loan",
      units: 2,
      stickerPerUnitCents: r.stickerPerUnitCents,
      dealerFeePct: 25,
      adderTotalCents: 2_700_00,
    });
    // 2 x $16,000. Whole-cent stickers cannot always land exactly, so the flat
    // mode rounds to nearest and the contract sits within a cent or two.
    expect(Math.abs(b.contractPriceCents - 32_000_00)).toBeLessThanOrEqual(2);
  });

  it("a ceiling only bites downwards", () => {
    const r = capStickerToFinalUnit({
      stickerPerUnitCents: 10_000_00,
      maxFinalPerUnitCents: 16_000_00,
      mode: "cap",
      units: 2,
      dealerFeePct: 25,
      adderTotalCents: 0,
    });
    expect(r.capped).toBe(false);
    expect(r.stickerPerUnitCents).toBe(10_000_00);
  });

  it("a flat price binds a cheap deal too", () => {
    const r = capStickerToFinalUnit({
      stickerPerUnitCents: 10_000_00,
      maxFinalPerUnitCents: 16_000_00,
      mode: "flat",
      units: 2,
      dealerFeePct: 25,
      adderTotalCents: 0,
    });
    expect(r.capped).toBe(true);
    expect(r.stickerPerUnitCents).toBe(16_000_00);
  });

  it("reports an overrun when the adders alone blow through the ceiling", () => {
    const r = capStickerToFinalUnit({
      stickerPerUnitCents: 10_000_00,
      maxFinalPerUnitCents: 1_000_00,
      mode: "cap",
      units: 1,
      dealerFeePct: 25,
      adderTotalCents: 5_000_00,
    });
    expect(r.adderOverrun).toBe(true);
    expect(r.stickerPerUnitCents).toBe(0);
  });

  it("no rule at all when the figure is null or non-positive", () => {
    for (const max of [null, undefined, 0, -1]) {
      const r = capStickerToFinalUnit({
        stickerPerUnitCents: 10_000_00,
        maxFinalPerUnitCents: max,
        units: 2,
        dealerFeePct: 25,
        adderTotalCents: 0,
      });
      expect(r.capped).toBe(false);
      expect(r.stickerPerUnitCents).toBe(10_000_00);
    }
  });

  it("no units means no rule — a ceiling cannot divide by nothing", () => {
    const r = capStickerToFinalUnit({
      stickerPerUnitCents: 10_000_00,
      maxFinalPerUnitCents: 1_000_00,
      units: 0,
      dealerFeePct: 25,
      adderTotalCents: 0,
    });
    expect(r.capped).toBe(false);
  });
});

describe("capStickerToFinalPpw is that function over watts", () => {
  it("still holds Amos to $5.50/W", () => {
    const r = capStickerToFinalPpw({
      stickerPpwCents: 857,
      maxFinalPpwCents: 550,
      mode: "flat",
      systemSizeKwDc: 10,
      dealerFeePct: 65,
      adderTotalCents: 0,
    });
    expect(r.stickerPpwCents).toBe(550);
    expect(r.capped).toBe(true);
  });

  it("a maximum rounds DOWN — under is always safe", () => {
    const r = capStickerToFinalPpw({
      stickerPpwCents: 400,
      maxFinalPpwCents: 350,
      mode: "cap",
      systemSizeKwDc: 10,
      dealerFeePct: 20,
      adderTotalCents: 1_234_00,
    });
    const contract = Math.round(10_000 * r.stickerPpwCents) + Math.round(1_234_00 / 0.8);
    expect(contract).toBeLessThanOrEqual(350 * 10_000);
  });
});

describe("underBaseFloor is unit-agnostic", () => {
  it("blocks a battery quoted under the lender's floor", () => {
    // $11,000 sticker at a 25% fee leaves $8,250 — under a $9,000 floor.
    expect(underBaseFloor(11_000_00, 25, 9_000_00)).toBe(true);
    expect(underBaseFloor(13_000_00, 25, 9_000_00)).toBe(false);
  });

  it("null or non-positive floor means no floor", () => {
    expect(underBaseFloor(1, 25, null)).toBe(false);
    expect(underBaseFloor(1, 25, undefined)).toBe(false);
    expect(underBaseFloor(1, 25, 0)).toBe(false);
  });
});

describe("priceStorageStored", () => {
  it("holds a saved storage deal to its partner's ceiling", () => {
    const { breakdown, cap } = priceStorageStored({
      product: "loan",
      batteryQty: 2,
      stickerPricePerBatteryCents: 20_000_00,
      dealerFeePct: 25,
      adderTotalCents: 0,
      maxFinalPricePerBatteryCents: 16_000_00,
      finalBatteryPriceMode: "flat",
    });
    expect(cap.capped).toBe(true);
    expect(breakdown.contractPriceCents).toBe(32_000_00);
  });

  it("cash has no lender and therefore no partner rule", () => {
    const { cap } = priceStorageStored({
      product: "cash",
      batteryQty: 2,
      stickerPricePerBatteryCents: 20_000_00,
      dealerFeePct: 0,
      adderTotalCents: 0,
      maxFinalPricePerBatteryCents: 16_000_00,
      finalBatteryPriceMode: "flat",
    });
    expect(cap.capped).toBe(false);
  });
});

describe("priceStoragePurchase", () => {
  it("is the ladder with batteries in it", () => {
    const b = priceStoragePurchase({
      product: "loan",
      batteryQty: 2,
      stickerPricePerBatteryCents: 17_333_33,
      dealerFeePct: 25,
      adderTotalCents: 2_700_00,
      rebateTotalCents: 1_000_00,
    });
    expect(b.units).toBe(2);
    expect(b.contractPriceCents).toBe(36_933_33);
  });
});
