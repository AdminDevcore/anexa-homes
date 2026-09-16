import { describe, expect, it } from "vitest";
import {
  batteryChargeCents,
  pricePurchase,
  priceStoragePurchase,
} from "@/lib/solar-money";

/**
 * THE DEALER FEE IS ON THE WHOLE GROSS — worked examples, in dollars.
 *
 *   gross = base + adders + batteries (+ any other sell-side charge)
 *   final = gross / (1 − fee)
 *   fee   = final − gross
 *
 * One ladder prices every shape of deal (`priceUnits`, reached through
 * `pricePurchase` for arrays and `priceStoragePurchase` for battery-only), so
 * these examples are the arithmetic every screen, the proposal, the PDF
 * snapshot, generation and payroll all read.
 *
 * Every figure below uses a 25% programme so the numbers stay whole: a
 * $4.00/W sticker leaves the company $3.00/W.
 */

const KW10 = { product: "loan" as const, systemSizeKwDc: 10, stickerPpwCents: 400, dealerFeePct: 25, adderTotalCents: 0 };
const $ = (dollars: number) => Math.round(dollars * 100);

/** final = gross / (1 − fee), to the cent the rounding allows. */
function expectFeeOnWholeGross(p: { grossPriceCents: number; contractPriceCents: number; dealerFeeCents: number }, feePct: number) {
  expect(p.dealerFeeCents).toBe(p.contractPriceCents - p.grossPriceCents);
  const f = feePct / 100;
  expect(Math.abs(p.contractPriceCents - p.grossPriceCents / (1 - f))).toBeLessThanOrEqual(2);
}

describe("solar only", () => {
  it("10 kW at $4.00/W on a 25% programme: gross $30,000, final $40,000, fee $10,000", () => {
    const p = pricePurchase(KW10);
    expect(p.grossPriceCents).toBe($(30_000));
    expect(p.contractPriceCents).toBe($(40_000));
    expect(p.dealerFeeCents).toBe($(10_000));
    expectFeeOnWholeGross(p, 25);
  });
});

describe("solar + battery — the battery is inside the fee", () => {
  it("adds a $15,000 battery: gross $45,000, final $60,000, fee $15,000", () => {
    const battery = batteryChargeCents({
      systemType: "pv_storage", batteryQty: 1, dealPerBatteryCents: 0, cataloguePerBatteryCents: $(15_000),
    });
    const p = pricePurchase({ ...KW10, batteryPriceCents: battery });
    expect(p.batteryPriceCents).toBe($(15_000));
    expect(p.batteryStickerCents).toBe($(20_000));
    expect(p.grossPriceCents).toBe($(45_000));
    expect(p.contractPriceCents).toBe($(60_000));
    expect(p.dealerFeeCents).toBe($(15_000));
    expectFeeOnWholeGross(p, 25);
  });

  it("two batteries: gross $60,000, final $80,000, fee $20,000", () => {
    const battery = batteryChargeCents({
      systemType: "pv_storage", batteryQty: 2, dealPerBatteryCents: 0, cataloguePerBatteryCents: $(15_000),
    });
    expect(battery).toBe($(30_000));
    const p = pricePurchase({ ...KW10, batteryPriceCents: battery });
    expect(p.grossPriceCents).toBe($(60_000));
    expect(p.contractPriceCents).toBe($(80_000));
    expect(p.dealerFeeCents).toBe($(20_000));
  });

  it("the battery's price typed on the deal (a marked-up battery) grosses up the same way", () => {
    const battery = batteryChargeCents({
      systemType: "pv_storage", batteryQty: 1, dealPerBatteryCents: $(18_000), cataloguePerBatteryCents: $(15_000),
    });
    const p = pricePurchase({ ...KW10, batteryPriceCents: battery });
    expect(p.grossPriceCents).toBe($(48_000));
    expect(p.contractPriceCents).toBe($(64_000));
    expectFeeOnWholeGross(p, 25);
  });
});

describe("adders and equipment upgrades are inside the fee", () => {
  it("$3,000 of adders on solar + battery: gross $48,000, final $64,000, fee $16,000", () => {
    const p = pricePurchase({ ...KW10, adderTotalCents: $(3_000), batteryPriceCents: $(15_000) });
    expect(p.adderStickerCents).toBe($(4_000));
    expect(p.grossPriceCents).toBe($(48_000));
    expect(p.contractPriceCents).toBe($(64_000));
    expect(p.dealerFeeCents).toBe($(16_000));
    expectFeeOnWholeGross(p, 25);
  });

  it("the customer's breakdown adds up to the contract", () => {
    const p = pricePurchase({ ...KW10, adderTotalCents: $(3_000), batteryPriceCents: $(15_000) });
    expect(p.baseStickerCents + p.adderStickerCents + p.batteryStickerCents).toBe(p.contractPriceCents);
    expect(p.baseKeptCents + p.adderTotalCents + p.batteryPriceCents).toBe(p.grossPriceCents);
  });
});

describe("battery only — the battery is the system", () => {
  it("2 batteries at a $20,000 sticker: gross $30,000, final $40,000, fee $10,000", () => {
    const p = priceStoragePurchase({
      product: "loan", batteryQty: 2, stickerPricePerBatteryCents: $(20_000), dealerFeePct: 25, adderTotalCents: 0,
    });
    expect(p.grossPriceCents).toBe($(30_000));
    expect(p.contractPriceCents).toBe($(40_000));
    expect(p.dealerFeeCents).toBe($(10_000));
    // Never charged twice: on a storage-only deal nothing rides on top.
    expect(p.batteryPriceCents).toBe(0);
    expect(batteryChargeCents({ systemType: "storage", batteryQty: 2, dealPerBatteryCents: 0, cataloguePerBatteryCents: $(15_000) })).toBe(0);
    expectFeeOnWholeGross(p, 25);
  });

  it("with $3,000 of adders: gross $33,000, final $44,000, fee $11,000", () => {
    const p = priceStoragePurchase({
      product: "loan", batteryQty: 2, stickerPricePerBatteryCents: $(20_000), dealerFeePct: 25, adderTotalCents: $(3_000),
    });
    expect(p.grossPriceCents).toBe($(33_000));
    expect(p.contractPriceCents).toBe($(44_000));
    expect(p.dealerFeeCents).toBe($(11_000));
  });
});

describe("fee percentages", () => {
  for (const fee of [0, 5, 10, 18, 25, 30, 50, 65]) {
    it(`${fee}%: final = gross / (1 − fee) with a battery and adders on the deal`, () => {
      const p = pricePurchase({
        product: "loan", systemSizeKwDc: 8.4, stickerPpwCents: 523, dealerFeePct: fee,
        adderTotalCents: $(2_750), batteryPriceCents: $(14_999),
      });
      expectFeeOnWholeGross(p, fee);
      if (fee === 0) expect(p.contractPriceCents).toBe(p.grossPriceCents);
    });
  }

  it("zero fee: final equals gross and the battery is at its catalogue price", () => {
    const p = pricePurchase({ ...KW10, dealerFeePct: 0, adderTotalCents: $(3_000), batteryPriceCents: $(15_000) });
    expect(p.dealerFeeCents).toBe(0);
    expect(p.contractPriceCents).toBe(p.grossPriceCents);
    expect(p.batteryStickerCents).toBe($(15_000));
  });

  it("cash takes no fee even if one is passed", () => {
    const p = pricePurchase({ ...KW10, product: "cash", dealerFeePct: 25, batteryPriceCents: $(15_000) });
    expect(p.dealerFeeCents).toBe(0);
    expect(p.contractPriceCents).toBe(p.grossPriceCents);
  });
});

describe("an adder a partner finances ON TOP is no exception to the fee", () => {
  it("is in the gross and grossed up like any adder (e.g. Amos's roof above its flat $/W)", () => {
    const p = pricePurchase({ ...KW10, onTopAdderTotalCents: $(7_000) });
    expect(p.grossPriceCents).toBe($(37_000));
    expect(p.contractPriceCents).toBe($(40_000) + Math.round($(7_000) / 0.75)); // $49,333.33, not $47,000
    expectFeeOnWholeGross(p, 25);
  });
});
