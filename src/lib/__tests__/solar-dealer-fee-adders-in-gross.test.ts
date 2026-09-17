import { describe, expect, it } from "vitest";
import { pricePurchase, priceStoredPurchase, priceUnits } from "@/lib/solar-money";
import { adderTotals, type AdderLine } from "@/lib/solar-adders";

/**
 * EVERY CUSTOMER SELL-SIDE ADDER IS IN THE GROSS, BEFORE THE DEALER FEE.
 *
 *   gross = system + batteries + every adder the customer buys
 *           (roof, MPU, trenching, electrical, panel upgrades, …)
 *   final = gross / (1 − fee)
 *
 * `outsidePriceRule` — a roof on a capped partner such as Amos — is NOT an
 * exception to the fee. It only decides that the work sits ABOVE the partner's
 * $/W ceiling instead of coming out of the system price.
 */

const $ = (dollars: number) => Math.round(dollars * 100);
const up = (cents: number, feePct: number) => Math.round(cents / (1 - feePct / 100));

function expectFeeOnWholeGross(
  p: { grossPriceCents: number; contractPriceCents: number; dealerFeeCents: number },
  feePct: number,
) {
  expect(p.dealerFeeCents).toBe(p.contractPriceCents - p.grossPriceCents);
  expect(Math.abs(p.contractPriceCents - p.grossPriceCents / (1 - feePct / 100))).toBeLessThanOrEqual(2);
}

// 10 kW at $4.00/W on a 25% programme leaves $30,000 of system in the gross.
const KW10 = { product: "loan" as const, systemSizeKwDc: 10, stickerPpwCents: 400, dealerFeePct: 25 };

describe("ordinary customer adders are in the gross and carry the fee", () => {
  it.each([
    ["roof", 7_500],
    ["MPU", 2_500],
    ["trenching", 1_800],
    ["electrical", 1_200],
    ["panel upgrade", 1_500],
  ])("a $%s adder: gross grows by its price, final by its price / (1 − fee)", (_label, dollars) => {
    const p = pricePurchase({ ...KW10, adderTotalCents: $(dollars) });
    expect(p.grossPriceCents).toBe($(30_000) + $(dollars));
    expect(p.contractPriceCents).toBe($(40_000) + up($(dollars), 25));
    expectFeeOnWholeGross(p, 25);
  });

  it("all of them together, with a battery at its sell price: one gross, one fee on all of it", () => {
    const adders = $(7_500) + $(2_500) + $(1_800) + $(1_200) + $(1_500);
    const p = pricePurchase({ ...KW10, adderTotalCents: adders, batteryPriceCents: $(15_000) });
    expect(p.grossPriceCents).toBe($(30_000) + adders + $(15_000));
    expect(p.contractPriceCents).toBe($(40_000) + up(adders, 25) + $(20_000));
    expectFeeOnWholeGross(p, 25);
  });
});

describe("a roof flagged 'financed on top' is still inside the dealer fee", () => {
  it("the roof is in the gross and the contract carries the fee on it ($50,000, not $47,500)", () => {
    const p = pricePurchase({ ...KW10, adderTotalCents: 0, onTopAdderTotalCents: $(7_500) });
    expect(p.grossPriceCents).toBe($(37_500));
    expect(p.contractPriceCents).toBe($(50_000));
    expect(p.onTopAdderStickerCents).toBe($(10_000));
    expectFeeOnWholeGross(p, 25);
  });

  it("flagging it on top changes nothing on a partner with no ceiling", () => {
    const inside = pricePurchase({ ...KW10, adderTotalCents: $(7_500) + $(2_500) });
    const onTop = pricePurchase({ ...KW10, adderTotalCents: $(2_500), onTopAdderTotalCents: $(7_500) });
    expect(onTop.contractPriceCents).toBe(inside.contractPriceCents);
    expect(onTop.grossPriceCents).toBe(inside.grossPriceCents);
    expect(onTop.dealerFeeCents).toBe(inside.dealerFeeCents);
  });

  it("the ladder's shares add up: on-top sticker + inside sticker = every adder at sticker", () => {
    const u = priceUnits({
      product: "loan", units: 10_000, stickerPerUnitCents: 400, dealerFeePct: 18,
      adderTotalCents: $(3_333.33), onTopAdderTotalCents: $(7_000),
    });
    expect(u.adderStickerCents).toBe(up($(3_333.33) + $(7_000), 18));
    expect(u.onTopAdderStickerCents).toBe(u.adderStickerCents - up($(3_333.33), 18));
    expectFeeOnWholeGross(u, 18);
  });

  it("cash has no fee, so the roof is at its price either way", () => {
    const p = pricePurchase({ ...KW10, product: "cash", dealerFeePct: 0, adderTotalCents: 0, onTopAdderTotalCents: $(7_500) });
    expect(p.contractPriceCents).toBe(p.grossPriceCents);
  });
});

describe("on a capped partner the roof rides above the $/W ceiling — fee included", () => {
  const job = { product: "loan" as const, systemSizeKwDc: 10, stickerPpwCents: 700, dealerFeePct: 18, adderTotalCents: 0 };

  it("flat $5.50/W at 18%: $55,000 for the system, $63,537 with a $7,000 roof", () => {
    const { breakdown, cap } = priceStoredPurchase({
      ...job, onTopAdderTotalCents: $(7_000), maxFinalPpwCents: 550, finalPpwMode: "flat", ppwBasis: "final",
    });
    expect(cap.stickerPpwCents).toBe(550);
    expect(breakdown.contractPriceCents).toBe($(55_000) + up($(7_000), 18));
    expect(Math.round(breakdown.contractPriceCents / 100)).toBe(63_537);
    expect(breakdown.grossPriceCents).toBe($(55_000) - Math.round($(55_000) * 0.18) + $(7_000));
    expectFeeOnWholeGross(breakdown, 18);
  });

  it("the roof does not eat into the array under a maximum $/W", () => {
    const rule = { maxFinalPpwCents: 550, finalPpwMode: "cap" as const, ppwBasis: "final" as const };
    const without = priceStoredPurchase({ ...job, ...rule });
    const withRoof = priceStoredPurchase({ ...job, ...rule, onTopAdderTotalCents: $(7_000) });
    expect(withRoof.cap.stickerPpwCents).toBe(without.cap.stickerPpwCents);
    expect(withRoof.breakdown.contractPriceCents - without.breakdown.contractPriceCents).toBe(up($(7_000), 18));
    expectFeeOnWholeGross(withRoof.breakdown, 18);
  });

  it("an ordinary adder under the same ceiling still comes out of the system price", () => {
    const { breakdown, cap } = priceStoredPurchase({
      ...job, adderTotalCents: $(2_500), maxFinalPpwCents: 550, finalPpwMode: "cap", ppwBasis: "final",
    });
    expect(cap.stickerPpwCents).toBeLessThan(550);
    expect(breakdown.contractPriceCents).toBeLessThanOrEqual($(55_000));
    expectFeeOnWholeGross(breakdown, 18);
  });
});

describe("deal adder lines: split by the flag, and both halves reach the fee", () => {
  it("a roof on top plus MPU and trenching inside prices exactly like all of it inside", () => {
    const lines: AdderLine[] = [
      { id: "roof", label: "Re-roof", basis: "flat" as const, flatCents: $(7_000), millsPerWatt: null, qty: 1, outsidePriceRule: true },
      { id: "mpu", label: "MPU", basis: "flat" as const, flatCents: $(2_500), millsPerWatt: null, qty: 1, outsidePriceRule: false },
      { id: "trench", label: "Trenching", basis: "perFoot" as const, flatCents: $(30), millsPerWatt: null, qty: 60, outsidePriceRule: false },
    ];
    const t = adderTotals(lines, 10_000);
    expect(t.onTopCents).toBe($(7_000));
    expect(t.financedInCents).toBe($(2_500) + $(1_800));

    const split = pricePurchase({ ...KW10, adderTotalCents: t.financedInCents, onTopAdderTotalCents: t.onTopCents });
    const whole = pricePurchase({ ...KW10, adderTotalCents: t.totalCents });
    expect(split.grossPriceCents).toBe($(30_000) + t.totalCents);
    expect(split.contractPriceCents).toBe(whole.contractPriceCents);
    expectFeeOnWholeGross(split, 25);
  });
});
