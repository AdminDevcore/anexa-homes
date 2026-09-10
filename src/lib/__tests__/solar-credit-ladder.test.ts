import { describe, it, expect } from "vitest";
import {
  buildCreditLadder,
  ladderReconciles,
  CREDIT_RATES_DEFAULT,
  CREDIT_CLAIMS_DEFAULT,
} from "../solar-credit-ladder";

/**
 * THE WORKED EXAMPLE, which is the specification.
 *
 * "We sold a system that's 10 kW. It's supposed to be $55,000. But on the
 * customer's contract it's gonna add the seventy, which makes it $125,000. Once
 * we put in the 30% ITC and 10% energy community and 10% domestic content
 * there's gonna be a little bit leftover — we're gonna make that automatically
 * calculate as the difference, as an incentive for signing today."
 */
const QUOTED = 55_000_00;
const CONTRACT = 125_000_00;

const ladder = (over: Partial<Parameters<typeof buildCreditLadder>[0]> = {}) =>
  buildCreditLadder({
    contractValueCents: CONTRACT,
    quotedPriceCents: QUOTED,
    rates: CREDIT_RATES_DEFAULT,
    claims: CREDIT_CLAIMS_DEFAULT,
    ...over,
  });

describe("the ladder lands on the price the system was sold at", () => {
  it("subtracts the three credits from the CONTRACT, not from the quoted price", () => {
    const l = ladder()!;
    expect(l.credits.map((c) => [c.key, c.amountCents])).toEqual([
      ["itc", 37_500_00],
      ["energyCommunity", 12_500_00],
      ["domesticContent", 12_500_00],
    ]);
    expect(l.creditTotalCents).toBe(62_500_00);
    expect(l.afterCreditsCents).toBe(62_500_00);
  });

  it("derives the incentive as the difference and ends on $55,000", () => {
    const l = ladder()!;
    expect(l.incentiveCents).toBe(7_500_00);
    expect(l.netCostCents).toBe(QUOTED);
    expect(l.shortfallCents).toBe(0);
  });

  it("hands back exactly the adjustment — credits plus incentive is the $70,000", () => {
    const l = ladder()!;
    expect(l.reliefCents).toBe(CONTRACT - QUOTED);
    expect(l.reliefCents).toBe(70_000_00);
  });

  it("reconciles", () => {
    expect(ladderReconciles(ladder()!)).toBe(true);
  });
});

describe("a credit this job does not earn is simply not claimed", () => {
  it("drops the energy-community line and grows the incentive by exactly it", () => {
    const l = ladder({ claims: { ...CREDIT_CLAIMS_DEFAULT, energyCommunity: false } })!;
    expect(l.credits.map((c) => c.key)).toEqual(["itc", "domesticContent"]);
    expect(l.creditTotalCents).toBe(50_000_00);
    // The bottom line does not move: the incentive absorbs the lost credit,
    // which is the whole meaning of "the difference".
    expect(l.incentiveCents).toBe(20_000_00);
    expect(l.netCostCents).toBe(QUOTED);
    expect(ladderReconciles(l)).toBe(true);
  });

  it("still draws a page with no credits at all, because the incentive stands alone", () => {
    const l = ladder({ claims: { itc: false, energyCommunity: false, domesticContent: false } })!;
    expect(l.credits).toEqual([]);
    expect(l.incentiveCents).toBe(70_000_00);
    expect(l.netCostCents).toBe(QUOTED);
  });

  it("draws nothing when there is neither a credit nor a remainder", () => {
    expect(
      buildCreditLadder({
        contractValueCents: QUOTED,
        quotedPriceCents: QUOTED,
        rates: { itcPct: 0, energyCommunityPct: 0, domesticContentPct: 0 },
      })
    ).toBeNull();
  });
});

describe("the incentive never goes negative", () => {
  /**
   * 20 kW at $5.50 is $110,000, and the same $70,000 adjustment makes the
   * contract $180,000. Half of that is $90,000 — already BELOW the quoted
   * price, so there is nothing to hand back.
   */
  it("drops the row and lets the after-credit figure be the bottom line", () => {
    const l = buildCreditLadder({
      contractValueCents: 180_000_00,
      quotedPriceCents: 110_000_00,
      rates: CREDIT_RATES_DEFAULT,
    })!;
    expect(l.creditTotalCents).toBe(90_000_00);
    expect(l.incentiveCents).toBe(0);
    expect(l.netCostCents).toBe(90_000_00);
    // Recorded for the rep's screen, never for the customer's.
    expect(l.shortfallCents).toBe(20_000_00);
    expect(ladderReconciles(l)).toBe(true);
  });

  it("never prints a bottom line below zero, however the percentages are typed", () => {
    const l = buildCreditLadder({
      contractValueCents: 100_000_00,
      quotedPriceCents: 50_000_00,
      rates: { itcPct: 80, energyCommunityPct: 40, domesticContentPct: 40 },
    })!;
    expect(l.creditTotalCents).toBe(100_000_00);
    expect(l.netCostCents).toBe(0);
    expect(ladderReconciles(l)).toBe(true);
  });
});

describe("the printed rows add up to the printed total", () => {
  it("holds on percentages that do not divide evenly", () => {
    const l = buildCreditLadder({
      contractValueCents: 123_457_33,
      quotedPriceCents: 55_000_00,
      rates: { itcPct: 30, energyCommunityPct: 10, domesticContentPct: 10 },
    })!;
    const sum = l.credits.reduce((n, c) => n + c.amountCents, 0);
    expect(sum).toBe(l.creditTotalCents);
    expect(l.contractValueCents - l.creditTotalCents - l.incentiveCents).toBe(l.netCostCents);
    expect(ladderReconciles(l)).toBe(true);
  });
});

describe("wording", () => {
  it("takes the company's words and never leaves either blank", () => {
    const l = ladder({ incentiveLabel: "  Sign-today credit ", disclaimer: " Ask your CPA. " })!;
    expect(l.incentiveLabel).toBe("Sign-today credit");
    expect(l.disclaimer).toBe("Ask your CPA.");
  });

  it("falls back rather than printing credit figures with nothing qualifying them", () => {
    const l = ladder({ incentiveLabel: "   ", disclaimer: "" })!;
    expect(l.incentiveLabel).toBe("Incentive for signing today");
    expect(l.disclaimer).toMatch(/tax professional/i);
  });
});

/**
 * THE TYPED RUNG.
 *
 * "Sign today credit" is the one figure on this ladder somebody enters, and
 * every test here is about the same property: it comes off the bottom line,
 * not off the reconciliation. A credit folded in among the tax credits would
 * change `afterCredits`, the derived incentive would absorb it to land on the
 * quoted price anyway, and the household would be told about a discount that
 * moved no number on the page.
 */
describe("the sign today credit", () => {
  it("comes off the bottom line, under the derived incentive", () => {
    const l = ladder({ signTodayCreditCents: 1_500_00 })!;
    // The incentive still does its own job: after credits, less the incentive,
    // IS the quoted price — and the typed credit then comes off that.
    expect(l.incentiveCents).toBe(l.afterCreditsCents - QUOTED);
    expect(l.signTodayCents).toBe(1_500_00);
    expect(l.netCostCents).toBe(QUOTED - 1_500_00);
    expect(l.reliefCents).toBe(l.creditTotalCents + l.incentiveCents + l.signTodayCents);
    expect(ladderReconciles(l)).toBe(true);
  });

  it("is the whole difference on an ordinary deal, where nothing is handed back", () => {
    const l = buildCreditLadder({
      contractValueCents: 50_000_00,
      quotedPriceCents: 50_000_00,
      rates: CREDIT_RATES_DEFAULT,
      claims: CREDIT_CLAIMS_DEFAULT,
      signTodayCreditCents: 1_000_00,
    })!;
    expect(l.incentiveCents).toBe(0);
    expect(l.netCostCents).toBe(l.afterCreditsCents - 1_000_00);
    expect(ladderReconciles(l)).toBe(true);
  });

  it("is clamped at what is left rather than printing a negative net cost", () => {
    const l = buildCreditLadder({
      contractValueCents: 50_000_00,
      quotedPriceCents: 50_000_00,
      rates: CREDIT_RATES_DEFAULT,
      claims: CREDIT_CLAIMS_DEFAULT,
      // More than the whole contract, let alone what survives the credits.
      signTodayCreditCents: 999_999_00,
    })!;
    expect(l.netCostCents).toBe(0);
    expect(l.signTodayCents).toBe(l.afterCreditsCents);
    expect(ladderReconciles(l)).toBe(true);
  });

  it("draws a ladder on its own, with every credit switched off", () => {
    const l = buildCreditLadder({
      contractValueCents: 50_000_00,
      quotedPriceCents: 50_000_00,
      rates: CREDIT_RATES_DEFAULT,
      claims: { itc: false, energyCommunity: false, domesticContent: false },
      signTodayCreditCents: 1_000_00,
    });
    // Without it this is the "nothing to say" case and the whole block is
    // dropped — which would take the rep's own discount off the document.
    expect(l).not.toBeNull();
    expect(l!.credits).toHaveLength(0);
    expect(l!.netCostCents).toBe(49_000_00);
    expect(ladderReconciles(l!)).toBe(true);
  });

  it("is absent, not zero, when nobody typed one", () => {
    const l = ladder()!;
    expect(l.signTodayCents).toBe(0);
    expect(l.netCostCents).toBe(QUOTED);
    expect(ladderReconciles(l)).toBe(true);
  });

  it("ignores a negative, rather than charging for signing today", () => {
    const l = ladder({ signTodayCreditCents: -5_000_00 })!;
    expect(l.signTodayCents).toBe(0);
    expect(l.netCostCents).toBe(QUOTED);
  });
});
