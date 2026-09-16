import { describe, it, expect } from "vitest";
import {
  capStickerToFinalPpw,
  capStickerToFinalUnit,
  pricePurchase,
  priceStoredPurchase,
  priceUnits,
} from "@/lib/solar-money";

/**
 * WHICH PRICE A PARTNER'S FIGURE FIXES.
 *
 * His words, 2026-09-14: "some products like this is on a flat 5.5 per watt on
 * base price, some are on the gross price — also the dealer fee is on top of
 * the gross price."
 *
 * So one partner's $5.50 is not one rule. On one programme it is the BASE, and
 * the extra work and the fee both go on top of it. On another it is the GROSS —
 * base and extra work together — and only the fee goes on top. The rule that
 * existed before this, where the figure was the FINAL price with the fee inside
 * it, stays as the third answer and the default, so nothing already quoted moves.
 *
 * The worked examples are the ones he chose between: 10 kW, $5.50/W, $3,000 of
 * trenching. The fee is a percentage of FINAL, as it is everywhere else.
 */

const TEN_KW = 10;
const TRENCHING = 300_000; // $3,000

const priced = (sticker: number, dealerFeePct: number, adderTotalCents = TRENCHING) =>
  pricePurchase({
    product: "loan",
    systemSizeKwDc: TEN_KW,
    stickerPpwCents: sticker,
    dealerFeePct,
    adderTotalCents,
  });

describe("a flat price on GROSS: base and extra work together are the figure", () => {
  it("fixes gross at $5.50/W and puts the fee on top of it", () => {
    const rule = capStickerToFinalPpw({
      stickerPpwCents: 800,
      maxFinalPpwCents: 550,
      mode: "flat",
      basis: "gross",
      systemSizeKwDc: TEN_KW,
      dealerFeePct: 18,
      adderTotalCents: TRENCHING,
    });
    const b = priced(rule.stickerPpwCents, 18);

    // Gross lands on $55,000 — within half a cent a watt, the closest a
    // whole-cent sticker can come.
    expect(Math.abs(b.grossPpwCents - 550)).toBeLessThanOrEqual(0.5);
    // The trenching came out of the base, not on top of the figure.
    expect(b.baseKeptCents).toBe(b.grossPriceCents - TRENCHING);
    // The fee sits on top: $55,000 / 0.82 = $67,073, give or take the same
    // half cent a watt.
    expect(Math.abs(b.contractPriceCents - 6_707_317)).toBeLessThanOrEqual(5_000);
  });

  it("raises a deal that would have priced under it", () => {
    const rule = capStickerToFinalPpw({
      stickerPpwCents: 300,
      maxFinalPpwCents: 550,
      mode: "flat",
      basis: "gross",
      systemSizeKwDc: TEN_KW,
      dealerFeePct: 18,
      adderTotalCents: TRENCHING,
    });
    expect(rule.capped).toBe(true);
    expect(Math.abs(priced(rule.stickerPpwCents, 18).grossPpwCents - 550)).toBeLessThanOrEqual(0.5);
  });

  it("reports an overrun when the extra work alone is more than the figure", () => {
    const rule = capStickerToFinalPpw({
      stickerPpwCents: 800,
      maxFinalPpwCents: 100,
      mode: "flat",
      basis: "gross",
      systemSizeKwDc: TEN_KW,
      dealerFeePct: 18,
      adderTotalCents: 1_000_000,
    });
    expect(rule.adderOverrun).toBe(true);
    expect(rule.stickerPpwCents).toBe(0);
  });

  it("at a 0% fee is exactly the old fee-included rule — why no Amos deal moves", () => {
    for (const adders of [0, 1, TRENCHING, 777_777]) {
      for (const mode of ["cap", "flat"] as const) {
        const args = {
          stickerPpwCents: 800,
          maxFinalPpwCents: 550,
          mode,
          systemSizeKwDc: 12.76,
          dealerFeePct: 0,
          adderTotalCents: adders,
        };
        expect(capStickerToFinalPpw({ ...args, basis: "gross" })).toEqual(
          capStickerToFinalPpw({ ...args, basis: "final" })
        );
      }
    }
  });
});

describe("a flat price on BASE: extra work and the fee both go on top", () => {
  it("fixes base at $5.50/W, adds the trenching, then the fee", () => {
    const rule = capStickerToFinalPpw({
      stickerPpwCents: 300,
      maxFinalPpwCents: 550,
      mode: "flat",
      basis: "base",
      systemSizeKwDc: TEN_KW,
      dealerFeePct: 18,
      adderTotalCents: TRENCHING,
    });
    // $5.50 / 0.82 = $6.7073, to the nearest whole cent.
    expect(rule.stickerPpwCents).toBe(671);

    const b = priced(rule.stickerPpwCents, 18);
    expect(Math.abs(b.basePpwCents - 550)).toBeLessThanOrEqual(0.5);
    expect(b.grossPriceCents).toBe(b.baseKeptCents + TRENCHING);
    // $58,000 / 0.82 = $70,732, give or take half a cent a watt.
    expect(Math.abs(b.contractPriceCents - 7_073_171)).toBeLessThanOrEqual(5_000);
  });

  it("is not moved by the extra work at all", () => {
    const at = (adderTotalCents: number) =>
      capStickerToFinalPpw({
        stickerPpwCents: 300,
        maxFinalPpwCents: 550,
        mode: "flat",
        basis: "base",
        systemSizeKwDc: TEN_KW,
        dealerFeePct: 18,
        adderTotalCents,
      }).stickerPpwCents;
    expect(at(0)).toBe(671);
    expect(at(TRENCHING)).toBe(671);
    expect(at(5_000_000)).toBe(671);
  });

  it("at a 0% fee the base is the figure to the cent", () => {
    const rule = capStickerToFinalPpw({
      stickerPpwCents: 300,
      maxFinalPpwCents: 550,
      mode: "flat",
      basis: "base",
      systemSizeKwDc: TEN_KW,
      dealerFeePct: 0,
      adderTotalCents: TRENCHING,
    });
    const b = priced(rule.stickerPpwCents, 0);
    expect(b.baseKeptCents).toBe(5_500_000);
    expect(b.grossPriceCents).toBe(5_800_000);
    expect(b.contractPriceCents).toBe(5_800_000);
  });
});

describe("a MAXIMUM on each basis bites only when that price is over it", () => {
  it("gross: leaves a deal whose gross is under, even if its final is over", () => {
    // Sticker $6.20/W at 18%: gross $53,840 (under $55,000), final $65,659 (over).
    const rule = capStickerToFinalPpw({
      stickerPpwCents: 620,
      maxFinalPpwCents: 550,
      mode: "cap",
      basis: "gross",
      systemSizeKwDc: TEN_KW,
      dealerFeePct: 18,
      adderTotalCents: TRENCHING,
    });
    expect(rule.capped).toBe(false);
    expect(rule.stickerPpwCents).toBe(620);
  });

  it("gross: holds a dear deal at or under, rounding down", () => {
    const rule = capStickerToFinalPpw({
      stickerPpwCents: 800,
      maxFinalPpwCents: 550,
      mode: "cap",
      basis: "gross",
      systemSizeKwDc: TEN_KW,
      dealerFeePct: 18,
      adderTotalCents: TRENCHING,
    });
    expect(rule.capped).toBe(true);
    expect(rule.stickerPpwCents).toBe(634);
    expect(priced(634, 18).grossPriceCents).toBeLessThanOrEqual(5_500_000);
  });

  it("base: extra work never counts towards it", () => {
    const rule = capStickerToFinalPpw({
      stickerPpwCents: 650, // base $5.33/W
      maxFinalPpwCents: 550,
      mode: "cap",
      basis: "base",
      systemSizeKwDc: TEN_KW,
      dealerFeePct: 18,
      adderTotalCents: 1_000_000,
    });
    expect(rule.capped).toBe(false);
    expect(rule.stickerPpwCents).toBe(650);
  });

  it("base: holds a base over the figure down, rounding down", () => {
    const rule = capStickerToFinalPpw({
      stickerPpwCents: 700, // base $5.74/W
      maxFinalPpwCents: 550,
      mode: "cap",
      basis: "base",
      systemSizeKwDc: TEN_KW,
      dealerFeePct: 18,
      adderTotalCents: TRENCHING,
    });
    expect(rule.capped).toBe(true);
    expect(rule.stickerPpwCents).toBe(670);
    expect(priced(670, 18).basePpwCents).toBeLessThanOrEqual(550);
  });
});

describe("the fee-included rule is still the default", () => {
  it("an omitted basis prices exactly as `final` does", () => {
    for (const mode of ["cap", "flat"] as const) {
      for (const fee of [0, 18, 65]) {
        const args = {
          stickerPpwCents: 857,
          maxFinalPpwCents: 550,
          mode,
          systemSizeKwDc: 11,
          dealerFeePct: fee,
          adderTotalCents: TRENCHING,
        };
        expect(capStickerToFinalPpw(args)).toEqual(
          capStickerToFinalPpw({ ...args, basis: "final" })
        );
      }
    }
  });
});

describe("the same choice per battery", () => {
  // The examples he approved: 2 batteries at $12,000, $2,000 of adders, 50% fee.
  const BATTERIES = {
    stickerPerUnitCents: 30_000_00,
    maxFinalPerUnitCents: 12_000_00,
    mode: "flat" as const,
    units: 2,
    dealerFeePct: 50,
    adderTotalCents: 2_000_00,
  };
  const ladder = (stickerPerUnitCents: number) =>
    priceUnits({
      product: "loan",
      units: 2,
      stickerPerUnitCents,
      dealerFeePct: 50,
      adderTotalCents: 2_000_00,
    });

  it("on base: $24,000 base, $26,000 gross, $52,000 final", () => {
    const rule = capStickerToFinalUnit({ ...BATTERIES, basis: "base" });
    const b = ladder(rule.stickerPerUnitCents);
    expect(b.baseKeptCents).toBe(24_000_00);
    expect(b.grossPriceCents).toBe(26_000_00);
    expect(b.contractPriceCents).toBe(52_000_00);
  });

  it("on gross: $22,000 base, $24,000 gross, $48,000 final", () => {
    const rule = capStickerToFinalUnit({ ...BATTERIES, basis: "gross" });
    const b = ladder(rule.stickerPerUnitCents);
    expect(b.baseKeptCents).toBe(22_000_00);
    expect(b.grossPriceCents).toBe(24_000_00);
    expect(b.contractPriceCents).toBe(48_000_00);
  });

  it("on final (today): $24,000 final, fee and adders inside it", () => {
    const rule = capStickerToFinalUnit({ ...BATTERIES, basis: "final" });
    expect(ladder(rule.stickerPerUnitCents).contractPriceCents).toBe(24_000_00);
  });
});

describe("a SAVED deal is priced on its programme's basis", () => {
  it("priceStoredPurchase passes the basis through to the rule", () => {
    const { breakdown, cap } = priceStoredPurchase({
      product: "loan",
      systemSizeKwDc: TEN_KW,
      stickerPpwCents: 800,
      dealerFeePct: 18,
      adderTotalCents: TRENCHING,
      maxFinalPpwCents: 550,
      finalPpwMode: "flat",
      ppwBasis: "gross",
    });
    expect(cap.capped).toBe(true);
    expect(Math.abs(breakdown.grossPpwCents - 550)).toBeLessThanOrEqual(0.5);
  });
});
