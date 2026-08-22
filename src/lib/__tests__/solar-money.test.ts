import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  pricePurchase,
  priceThirdParty,
  solarCommissionCents,
  apportionCents,
  capStickerToFinalPpw,
  grossPpwFromNet,
  basePpwFromSticker,
  underBaseFloor,
  type FinalPpwCap,
  year1Production,
  offsetPct,
  type SolarAssumptions,
} from "@/lib/solar-money";
import {
  validateDesign,
  validateFinance,
  canGenerate,
  type DesignForValidation,
  type FinanceForValidation,
} from "@/lib/solar-validation";

const A: SolarAssumptions = {
  derateFactor: 0.84,
  annualDegradationPct: 0.5,
  utilityEscalationPct: 3.5,
  kwhPerKwYear: 1450,
  defaultGrossPpwCents: 350,
  defaultDealerFeePct: 18,
  minOffsetPct: 0,
  maxOffsetPct: 150,
  minPpwCents: 150,
  maxPpwCents: 800,
};

// ---------------------------------------------------------------------------
// The four products are genuinely different
// ---------------------------------------------------------------------------
describe("cash vs loan: the dealer fee is the whole difference", () => {
  const base = { systemSizeKwDc: 10, stickerPpwCents: 350, adderTotalCents: 0 };

  it("a cash deal has no dealer fee, so the base is the sticker", () => {
    const p = pricePurchase({ ...base, product: "cash", dealerFeePct: 0 });
    expect(p.contractPriceCents).toBe(3_500_000); // 10kW × $3.50/W
    expect(p.dealerFeeCents).toBe(0);
    expect(p.basePpwCents).toBe(350);
    expect(p.grossPriceCents).toBe(3_500_000);
  });

  it("a loan embeds the lender's cut in the sticker, so the base is lower", () => {
    const p = pricePurchase({ ...base, product: "loan", dealerFeePct: 18 });
    expect(p.contractPriceCents).toBe(3_500_000);
    expect(p.dealerFeeCents).toBe(630_000); // 18%
    expect(p.basePriceCents).toBe(2_870_000);
    expect(p.basePpwCents).toBeCloseTo(287, 0); // $2.87/W is what we really keep
  });

  it("ignores a dealer fee passed on a cash deal rather than applying it", () => {
    // Defence in depth: validation blocks this too, but the maths must not
    // quietly overprice a cash customer if it slips through.
    const p = pricePurchase({ ...base, product: "cash", dealerFeePct: 18 });
    expect(p.dealerFeeCents).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The price ladder: base → adders → GROSS → dealer fee → FINAL
//
// The vocabulary these tests police, because getting it backwards is a silent
// four-figure error on every job carrying extra work:
//
//   BASE   what the rep prices the system at, before any lender takes a cut
//   ADDERS the catalogue price of the extra work, likewise before the cut
//   GROSS  base + adders. Still before the fee. What the company keeps.
//   FINAL  gross with the dealer fee in it. What the customer signs.
//
// The fee is a percentage OF FINAL, not a markup on gross: 30% on a $100k
// system means the company keeps $70k, so final = gross / (1 − fee).
// ---------------------------------------------------------------------------
describe("the dealer fee is a percentage of the FINAL price", () => {
  it("a 30% fee on a $100k system leaves $70k, so gross grosses UP to final", () => {
    // $7.00/W base on 10 kW is $70,000 kept; at a 30% fee the customer signs
    // $100,000. This is the example the model is specified by.
    const p = pricePurchase({
      product: "loan",
      systemSizeKwDc: 10,
      stickerPpwCents: 1_000, // $10.00/W sticker = $7.00/W base at 30%
      dealerFeePct: 30,
      adderTotalCents: 0,
    });
    expect(p.contractPriceCents).toBe(10_000_000); // final
    expect(p.grossPriceCents).toBe(7_000_000); // gross
    expect(p.dealerFeeCents).toBe(3_000_000); // 30% OF FINAL
  });

  it("gross + dealer fee is exactly the final price, with no rounding gap", () => {
    // Deliberately awkward: 10,140 W at a rate that does not divide, on a fee
    // that does not either. Money that fails to add up on a customer's own
    // breakdown is worse than money that is a cent out somewhere internal.
    const p = pricePurchase({
      product: "loan",
      systemSizeKwDc: 10.14,
      stickerPpwCents: 337,
      dealerFeePct: 22.5,
      adderTotalCents: 386_100,
    });
    expect(p.grossPriceCents + p.dealerFeeCents).toBe(p.contractPriceCents);
    expect(p.basePriceCents + p.adderTotalCents).toBe(p.grossPriceCents);
  });
});

describe("adders sit INSIDE the dealer fee", () => {
  // The defect this describes: the lender advances the whole contract and keeps
  // its percentage of ALL of it, the $14,500 re-roof included. Pricing the fee
  // on the base system alone and bolting the adder on afterwards at face value
  // hands the lender's cut on that adder out of company margin, silently, on
  // every job carrying extra work.
  const withAdder = {
    product: "loan" as const,
    systemSizeKwDc: 10,
    stickerPpwCents: 350, // $2.87/W base at 18%
    dealerFeePct: 18,
    adderTotalCents: 1_450_000, // a $14,500 re-roof
  };

  it("grosses the adder up by the same fee the system carries", () => {
    const p = pricePurchase(withAdder);
    // $14,500 has to sticker at $17,682.93 for the company to keep $14,500
    // after an 18% cut — not $14,500.
    expect(p.adderStickerCents).toBe(Math.round(1_450_000 / 0.82));
    expect(p.adderStickerCents).toBeGreaterThan(p.adderTotalCents);
    expect(p.contractPriceCents).toBe(p.baseStickerCents + p.adderStickerCents);
  });

  it("keeps the company whole: the fee comes out and the adder is still worth its catalogue price", () => {
    const p = pricePurchase(withAdder);
    // The whole point. What is left after the lender takes 18% of everything
    // it advanced is the base plus the adder at exactly what we priced it.
    expect(p.contractPriceCents - p.dealerFeeCents).toBe(p.grossPriceCents);
    expect(p.grossPriceCents).toBe(p.basePriceCents + 1_450_000);
  });

  it("charges the fee on the WHOLE contract, not just the system", () => {
    const p = pricePurchase(withAdder);
    const feeOnSystemOnly = Math.round(p.baseStickerCents * 0.18);
    expect(p.dealerFeeCents).toBeGreaterThan(feeOnSystemOnly);
    expect(p.dealerFeeCents).toBeCloseTo(p.contractPriceCents * 0.18, 0);
  });

  it("leaves a cash adder alone, because cash has no lender to pay", () => {
    const p = pricePurchase({ ...withAdder, product: "cash", dealerFeePct: 0 });
    expect(p.adderStickerCents).toBe(1_450_000);
    expect(p.contractPriceCents).toBe(3_500_000 + 1_450_000);
    expect(p.dealerFeeCents).toBe(0);
  });

  it("does not divide by zero on a nonsensical fee", () => {
    // A 100% fee would send the adder to infinity. An Infinity on a homeowner's
    // proposal is worse than an unfeed adder, so the gross-up stands down.
    const p = pricePurchase({ ...withAdder, dealerFeePct: 100 });
    expect(Number.isFinite(p.contractPriceCents)).toBe(true);
    expect(p.adderStickerCents).toBe(1_450_000);
  });
});

describe("the rep's redline reads the BASE, never the gross or the final", () => {
  it("excludes adders, so extra work is not paid as overage", () => {
    // An adder is priced from the catalogue to cover its own cost. Paying a
    // redline rep on it would hand them the re-roof's whole price.
    const laden = pricePurchase({
      product: "loan", systemSizeKwDc: 10, stickerPpwCents: 350,
      dealerFeePct: 18, adderTotalCents: 1_450_000,
    });
    const plain = pricePurchase({
      product: "loan", systemSizeKwDc: 10, stickerPpwCents: 350,
      dealerFeePct: 18, adderTotalCents: 0,
    });
    expect(laden.basePriceCents).toBe(plain.basePriceCents);
    expect(laden.basePpwCents).toBe(plain.basePpwCents);
  });

  it("moves with the lender's fee, so dear money comes out of the rep", () => {
    const cheap = pricePurchase({
      product: "loan", systemSizeKwDc: 10, stickerPpwCents: 350,
      dealerFeePct: 18, adderTotalCents: 0,
    });
    const dear = pricePurchase({
      product: "loan", systemSizeKwDc: 10, stickerPpwCents: 350,
      dealerFeePct: 32, adderTotalCents: 0,
    });
    expect(dear.basePriceCents).toBeLessThan(cheap.basePriceCents);
  });
});

describe("apportionCents splits a grossed total back across its lines", () => {
  it("hands out every cent, so the lines always sum to the total", () => {
    // A customer reads the itemised lines and adds them up. A total that is
    // three cents off the lines above it is a phone call.
    const parts = apportionCents(1_768_293, [270_000, 385_000, 790_000]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1_768_293);
    expect(parts.every((n) => n > 0)).toBe(true);
  });

  it("keeps the lines in proportion", () => {
    const parts = apportionCents(1_000, [100, 100, 200]);
    expect(parts).toEqual([250, 250, 500]);
  });

  it("survives a total of zero and weights of zero", () => {
    expect(apportionCents(0, [100, 200])).toEqual([0, 0]);
    expect(apportionCents(500, [0, 0])).toEqual([0, 0]);
    expect(apportionCents(500, [])).toEqual([]);
  });
});

describe("lease and PPA do not use the purchase model at all", () => {
  it("a PPA bills per kWh and falls as the array degrades", () => {
    const t = priceThirdParty(
      { product: "ppa", rateMillsPerKwh: 145, escalatorPct: 2.9, termYears: 25, year1ProductionKwh: 12_180, systemSizeKwDc: 10 },
      A
    );
    expect(t.year1CostCents).toBe(Math.round((12_180 * 145) / 10));
    expect(t.lifetimeCostCents).toBeGreaterThan(t.year1CostCents * 25 * 0.9);
    expect(t.effectiveRateMills).toBeGreaterThan(145); // escalator outruns degradation
  });

  it("a lease bills a fixed monthly regardless of output", () => {
    const t = priceThirdParty(
      { product: "lease", monthlyPaymentCents: 18_500, escalatorPct: 0, termYears: 20, year1ProductionKwh: 12_180, systemSizeKwDc: 10 },
      A
    );
    expect(t.year1CostCents).toBe(18_500 * 12);
    // No escalator = flat, so lifetime is exactly the monthly × term.
    expect(t.lifetimeCostCents).toBe(18_500 * 12 * 20);
  });
});

// ---------------------------------------------------------------------------
// Commission
// ---------------------------------------------------------------------------
describe("commission bases differ per product", () => {
  const loan = pricePurchase({
    product: "loan", systemSizeKwDc: 10, stickerPpwCents: 350, dealerFeePct: 18,
    adderTotalCents: 0, equipmentCostCents: 2_000_000,
  });

  it("PPW pays per watt of system", () => {
    const c = solarCommissionCents("loan", { type: "ppw", ratePerWattCents: 25 }, { purchase: loan });
    expect(c).toBe(10_000 * 25);
  });

  it("margin pays on what the company keeps, net of the dealer fee", () => {
    // gross 2,870,000 − cost 2,000,000 = 870,000 margin
    expect(loan.marginCents).toBe(870_000);
    const c = solarCommissionCents("loan", { type: "margin", percent: 40 }, { purchase: loan });
    expect(c).toBe(348_000);
  });

  it("a percentage basis uses GROSS, never final — the rep is not paid on the lender's cut", () => {
    const c = solarCommissionCents("loan", { type: "percentage", percent: 10 }, { purchase: loan });
    expect(c).toBe(287_000); // 10% of the $28,700 kept, not of the $35,000 signed
  });

  it("a TPO rep is never left uncompensated: flat and per-watt both pay", () => {
    const t = priceThirdParty(
      { product: "ppa", rateMillsPerKwh: 145, escalatorPct: 2.9, termYears: 25, year1ProductionKwh: 12_180, systemSizeKwDc: 10 },
      A
    );
    // Margin genuinely does not exist — a third party owns the system, so there
    // is no cost basis of ours to take a margin on.
    expect(solarCommissionCents("ppa", { type: "margin", percent: 40 }, { thirdParty: t })).toBe(0);
    // But the array IS installed, so a per-watt rule must still pay. Returning
    // zero here would leave every TPO rep uncompensated, silently.
    expect(solarCommissionCents("ppa", { type: "ppw", ratePerWattCents: 25 }, { thirdParty: t })).toBe(
      10_000 * 25
    );
    // …as must flat and a percentage of year-one customer cost.
    expect(solarCommissionCents("ppa", { type: "flat", amountCents: 150_000 }, { thirdParty: t })).toBe(150_000);
    expect(solarCommissionCents("ppa", { type: "percentage", percent: 10 }, { thirdParty: t })).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// No incentive exists anywhere in the money layer
// ---------------------------------------------------------------------------
describe("no tax credit or incentive is quoted", () => {
  it("has no credit percentage, helper or literal in the money module", () => {
    // The company quotes no federal, state or local incentive. This guards
    // against someone "helpfully" restoring a 30% constant or an ITC helper.
    const src = readFileSync(new URL("../solar-money.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/federalItcPct/);
    expect(src).not.toMatch(/itcEstimateCents/);
    expect(src).not.toMatch(/\b0\.30\b|\bITC_PCT\b/);
  });
});

// ---------------------------------------------------------------------------
// Validation — the 10,814% offset problem
// ---------------------------------------------------------------------------
describe("a rep cannot generate a nonsense proposal", () => {
  const goodDesign: DesignForValidation = {
    systemSizeKwDc: 10,
    year1ProductionKwh: 12_180,
    annualUsageKwh: 14_000,
    offsetPct: 87,
    moduleQty: 25,
    moduleRatingW: 400,
  };

  it("accepts a sane design", () => {
    expect(canGenerate(validateDesign(goodDesign, A))).toBe(true);
  });

  it("BLOCKS the five-figure offset that ships on real competitor proposals", () => {
    const issues = validateDesign({ ...goodDesign, offsetPct: 10_814 }, A);
    expect(canGenerate(issues)).toBe(false);
    expect(issues.find((i) => i.field === "offsetPct")?.message).toMatch(/usage/i);
  });

  it("BLOCKS a design with no usage — the root cause of that number", () => {
    const issues = validateDesign({ ...goodDesign, annualUsageKwh: null }, A);
    expect(canGenerate(issues)).toBe(false);
    expect(issues.some((i) => i.field === "annualUsageKwh")).toBe(true);
  });

  it("BLOCKS negative offset", () => {
    expect(canGenerate(validateDesign({ ...goodDesign, offsetPct: -5 }, A))).toBe(false);
  });

  it("WARNS but allows a high-but-real offset for an EV owner", () => {
    const issues = validateDesign({ ...goodDesign, offsetPct: 120 }, A);
    expect(canGenerate(issues)).toBe(true);
    expect(issues.some((i) => i.severity === "warn")).toBe(true);
  });

  it("BLOCKS production that cannot come from that system size", () => {
    // 10 kW cannot make 60,000 kWh anywhere on earth.
    const issues = validateDesign({ ...goodDesign, year1ProductionKwh: 60_000 }, A);
    expect(canGenerate(issues)).toBe(false);
    expect(issues.some((i) => i.field === "year1ProductionKwh")).toBe(true);
  });

  it("BLOCKS a module count that disagrees with the system size", () => {
    const issues = validateDesign({ ...goodDesign, moduleQty: 40 }, A);
    expect(canGenerate(issues)).toBe(false);
  });

  it("BLOCKS out-of-range PPW", () => {
    const f: FinanceForValidation = {
      product: "loan", grossPpwCents: 1200, dealerFeePct: 18, contractPriceCents: 5_000_000,
      rateMillsPerKwh: null, monthlyPaymentCents: null, escalatorPct: null, termYears: null,
      downPaymentCents: null, loanMonthlyPaymentCents: null,
    };
    expect(canGenerate(validateFinance(f, A))).toBe(false);
  });

  it("BLOCKS a dealer fee on a cash deal", () => {
    const f: FinanceForValidation = {
      product: "cash", grossPpwCents: 350, dealerFeePct: 18, contractPriceCents: 3_500_000,
      rateMillsPerKwh: null, monthlyPaymentCents: null, escalatorPct: null, termYears: null,
      downPaymentCents: null, loanMonthlyPaymentCents: null,
    };
    const issues = validateFinance(f, A);
    expect(canGenerate(issues)).toBe(false);
    expect(issues.find((i) => i.field === "dealerFeePct")?.message).toMatch(/no lender/i);
  });

  it("BLOCKS a down payment that leaves nothing to finance", () => {
    // A COMPLETE loan — APR, term and the lender's monthly are all present —
    // so what this test isolates is the down-payment rule and nothing else.
    const base: FinanceForValidation = {
      product: "loan", grossPpwCents: 350, dealerFeePct: 18, contractPriceCents: 3_885_000,
      rateMillsPerKwh: null, monthlyPaymentCents: null, escalatorPct: null, termYears: null,
      downPaymentCents: null, loanMonthlyPaymentCents: 27_400,
      aprPct: 6.99, loanTermMonths: 300,
    };
    // A real down payment is fine.
    expect(canGenerate(validateFinance({ ...base, downPaymentCents: 500_000 }, A))).toBe(true);
    // One at or above the system price is the stray-decimal case.
    expect(canGenerate(validateFinance({ ...base, downPaymentCents: 3_885_000 }, A))).toBe(false);
    expect(canGenerate(validateFinance({ ...base, downPaymentCents: 9_000_000 }, A))).toBe(false);
  });

  it("BLOCKS loan-only money on products that have no lender", () => {
    const cash: FinanceForValidation = {
      product: "cash", grossPpwCents: 350, dealerFeePct: 0, contractPriceCents: 3_885_000,
      rateMillsPerKwh: null, monthlyPaymentCents: null, escalatorPct: null, termYears: null,
      downPaymentCents: null, loanMonthlyPaymentCents: null,
    };
    expect(canGenerate(validateFinance({ ...cash, downPaymentCents: 500_000 }, A))).toBe(false);
    expect(canGenerate(validateFinance({ ...cash, loanMonthlyPaymentCents: 27_400 }, A))).toBe(false);

    // …and a loan payment left behind after switching to a third-party product.
    const lease: FinanceForValidation = {
      product: "lease", grossPpwCents: 0, dealerFeePct: 0, contractPriceCents: 0,
      rateMillsPerKwh: null, monthlyPaymentCents: 18_500, escalatorPct: 2.9, termYears: 20,
      downPaymentCents: null, loanMonthlyPaymentCents: 27_400,
    };
    expect(canGenerate(validateFinance(lease, A))).toBe(false);
  });

  it("BLOCKS mixing lease and PPA fields", () => {
    const ppaWithMonthly: FinanceForValidation = {
      product: "ppa", grossPpwCents: 0, dealerFeePct: 0, contractPriceCents: 0,
      rateMillsPerKwh: 145, monthlyPaymentCents: 18_500, escalatorPct: 2.9, termYears: 25,
      downPaymentCents: null, loanMonthlyPaymentCents: null,
    };
    expect(canGenerate(validateFinance(ppaWithMonthly, A))).toBe(false);

    const leaseWithRate: FinanceForValidation = {
      product: "lease", grossPpwCents: 0, dealerFeePct: 0, contractPriceCents: 0,
      rateMillsPerKwh: 145, monthlyPaymentCents: 18_500, escalatorPct: 2.9, termYears: 20,
      downPaymentCents: null, loanMonthlyPaymentCents: null,
    };
    expect(canGenerate(validateFinance(leaseWithRate, A))).toBe(false);
  });

  it("bounds come from settings, so a market can widen them", () => {
    // A $9.00/W BASE, stickered through an 18% fee. The band is judged on the
    // base, so that is the figure to put outside it — 900 was a sticker here
    // until the two sides were made to compare the same number.
    const f: FinanceForValidation = {
      product: "loan", grossPpwCents: grossPpwFromNet(900, 18)!, dealerFeePct: 18, contractPriceCents: 5_000_000,
      rateMillsPerKwh: null, monthlyPaymentCents: null, escalatorPct: null, termYears: null,
      downPaymentCents: null, loanMonthlyPaymentCents: 27_400,
      aprPct: 6.99, loanTermMonths: 300,
    };
    expect(canGenerate(validateFinance(f, A))).toBe(false);
    expect(canGenerate(validateFinance(f, { ...A, maxPpwCents: 1000 }))).toBe(true);
  });

  it("BLOCKS a loan that is missing the figures the lender issued", () => {
    // A loan quotes a monthly payment to the customer. Generating one without
    // the lender's own APR, term and payment means quoting a number nobody
    // issued — the proposal would be a guess wearing a lender's name.
    const bare: FinanceForValidation = {
      product: "loan", grossPpwCents: 350, dealerFeePct: 18, contractPriceCents: 3_885_000,
      rateMillsPerKwh: null, monthlyPaymentCents: null, escalatorPct: null, termYears: null,
      downPaymentCents: null, loanMonthlyPaymentCents: null,
    };
    const issues = validateFinance(bare, A);
    expect(canGenerate(issues)).toBe(false);
    expect(issues.map((i) => i.code)).toEqual(
      expect.arrayContaining([
        "financing.loan_monthly_missing",
        "financing.loan_apr_missing",
        "financing.loan_term_missing",
      ])
    );

    const complete: FinanceForValidation = {
      ...bare, loanMonthlyPaymentCents: 27_400, aprPct: 6.99, loanTermMonths: 300,
    };
    expect(canGenerate(validateFinance(complete, A))).toBe(true);
  });

  it("BLOCKS an APR left behind on a lease by a product switch", () => {
    // The defect this guards: switching Loan -> Lease used to leave aprPct on
    // the row, and the customer-facing proposal renders an APR whenever one is
    // present. A homeowner was one product switch away from being quoted an
    // interest rate on a lease, which has none.
    const lease: FinanceForValidation = {
      product: "lease", grossPpwCents: 0, dealerFeePct: 0, contractPriceCents: 0,
      rateMillsPerKwh: null, monthlyPaymentCents: 17_500, escalatorPct: 2.9, termYears: 25,
      downPaymentCents: null, loanMonthlyPaymentCents: null, aprPct: 6.99,
    };
    const issues = validateFinance(lease, A);
    expect(canGenerate(issues)).toBe(false);
    expect(issues.map((i) => i.code)).toContain("financing.tpo_apr");

    expect(canGenerate(validateFinance({ ...lease, aprPct: null }, A))).toBe(true);
  });
});

describe("production maths", () => {
  it("derives year-one production from size, irradiance and derate", () => {
    expect(year1Production(10, A)).toBe(Math.round(10 * 1450 * 0.84));
  });
  it("offset is production over usage", () => {
    expect(offsetPct(12_180, 14_000)).toBeCloseTo(87, 0);
    expect(offsetPct(12_180, 0)).toBe(0); // no divide-by-zero blowup
  });
});

describe("a lender's maximum price per watt caps the CONTRACT, not the sticker", () => {
  // Amos Capital Fund, from a real deal: 8.80 kW, the company's base at
  // $5.68/W, a 65% dealer fee, and paper that is always $5.50/W to the
  // homeowner. Priced the ordinary way that base stickers at $16.23/W and
  // quotes a contract of $142,824 on a programme that funds $48,400.
  const AMOS = { systemSizeKwDc: 8.8, dealerFeePct: 65, maxFinalPpwCents: 550 };
  const uncappedSticker = grossPpwFromNet(568, 65)!;

  const contractOf = (cap: FinalPpwCap, adderTotalCents: number) =>
    pricePurchase({
      product: "loan",
      systemSizeKwDc: AMOS.systemSizeKwDc,
      stickerPpwCents: cap.stickerPpwCents,
      dealerFeePct: AMOS.dealerFeePct,
      adderTotalCents,
    });

  it("holds the contract to the cap on a deal with no adders", () => {
    expect(uncappedSticker).toBe(1623);

    const cap = capStickerToFinalPpw({
      stickerPpwCents: uncappedSticker, ...AMOS, adderTotalCents: 0,
    });
    expect(cap.capped).toBe(true);
    expect(cap.stickerPpwCents).toBe(550);

    const priced = contractOf(cap, 0);
    expect(priced.contractPriceCents).toBe(4_840_000); // $48,400, not $142,824
    expect(priced.finalPpwCents).toBe(550);
  });

  it("leaves the homeowner's price alone when work is added, and takes it out of the company", () => {
    // THE POINT OF THE WHOLE FEATURE. A $5,000 adder on an uncapped lender
    // raises what the customer signs. Under a cap the ceiling is already
    // reached, so the extra work comes out of the only line with any give in
    // it — the system — and the customer's number does not move.
    const bare = capStickerToFinalPpw({
      stickerPpwCents: uncappedSticker, ...AMOS, adderTotalCents: 0,
    });
    const laden = capStickerToFinalPpw({
      stickerPpwCents: uncappedSticker, ...AMOS, adderTotalCents: 500_000,
    });

    const bareP = contractOf(bare, 0);
    const ladenP = contractOf(laden, 500_000);

    // Never above the cap, and within a watt's worth of cents of it.
    expect(ladenP.finalPpwCents).toBeLessThanOrEqual(550);
    expect(ladenP.finalPpwCents).toBeGreaterThan(549);

    // The company, not the homeowner, paid for the adder.
    expect(ladenP.grossPriceCents).toBeLessThan(bareP.grossPriceCents);
    expect(ladenP.basePriceCents).toBeLessThan(bareP.basePriceCents);
  });

  it("is a ceiling, so a deal already under it is left exactly where it is", () => {
    // A cap that dragged cheap deals UP to it would be a price list, not a
    // maximum — and would silently raise every quote on that lender.
    const cheap = capStickerToFinalPpw({
      stickerPpwCents: 400, ...AMOS, adderTotalCents: 0,
    });
    expect(cheap.capped).toBe(false);
    expect(cheap.stickerPpwCents).toBe(400);
  });

  it("never quotes above the cap when the sticker does not divide evenly", () => {
    // The sticker is whole cents per watt, so the solved figure lands between
    // two of them. Rounding up would quote the partner more than they fund.
    for (const adder of [1, 99, 100_000, 333_333, 777_777]) {
      const cap = capStickerToFinalPpw({
        stickerPpwCents: uncappedSticker, ...AMOS, adderTotalCents: adder,
      });
      expect(contractOf(cap, adder).finalPpwCents).toBeLessThanOrEqual(550);
    }
  });

  it("flags the case where the adders alone blow through the cap", () => {
    // $40,000 of extra work grosses up to $114,285 against a $48,400 ceiling.
    // No system price — not even a free one — gets under it. Better said out
    // loud than swallowed into a negative price per watt.
    const cap = capStickerToFinalPpw({
      stickerPpwCents: uncappedSticker, ...AMOS, adderTotalCents: 4_000_000,
    });
    expect(cap.adderOverrun).toBe(true);
    expect(cap.stickerPpwCents).toBe(0);
  });

  it("does nothing at all to a lender with no maximum set", () => {
    // Which is every lender until somebody sets one, so this is the guarantee
    // that shipping the column moved no existing price.
    for (const max of [null, undefined, 0]) {
      const cap = capStickerToFinalPpw({
        stickerPpwCents: uncappedSticker,
        maxFinalPpwCents: max,
        systemSizeKwDc: 8.8,
        dealerFeePct: 65,
        adderTotalCents: 500_000,
      });
      expect(cap).toEqual({ stickerPpwCents: 1623, capped: false, adderOverrun: false });
    }
  });

  it("cannot price a deal that has no array yet", () => {
    const cap = capStickerToFinalPpw({
      stickerPpwCents: uncappedSticker, ...AMOS, systemSizeKwDc: 0, adderTotalCents: 0,
    });
    expect(cap.capped).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A lender's MINIMUM: a floor under what the company keeps
// ---------------------------------------------------------------------------
describe("a lender's minimum price per watt floors the BASE, not the sticker", () => {
  it("reads back the base the sticker was grossed up from", () => {
    // The exact inverse of the forward direction, at the fee that produced it.
    expect(basePpwFromSticker(grossPpwFromNet(287, 18)!, 18)).toBe(287);
    expect(basePpwFromSticker(grossPpwFromNet(350, 30)!, 30)).toBe(350);
  });

  it("treats a fee it would stand down as no fee, exactly as pricing does", () => {
    expect(basePpwFromSticker(400, 0)).toBe(400);
    expect(basePpwFromSticker(400, 100)).toBe(400);
    expect(basePpwFromSticker(400, -5)).toBe(400);
  });

  it("no floor set means no deal is ever under it", () => {
    expect(underBaseFloor(350, 18, null)).toBe(false);
    expect(underBaseFloor(350, 18, undefined)).toBe(false);
    expect(underBaseFloor(350, 18, 0)).toBe(false);
  });

  it("measures the floor against what SURVIVES a cap, not what was typed", () => {
    // Amos: $5.50/W paper on a 65% fee. Whatever base is typed, the cap solves
    // the sticker down to 550 and 550 × 0.35 = $1.93/W is all that is left.
    const capped = capStickerToFinalPpw({
      stickerPpwCents: grossPpwFromNet(300, 65)!, // a $3.00 base, typed
      maxFinalPpwCents: 550,
      systemSizeKwDc: 8.8,
      dealerFeePct: 65,
      adderTotalCents: 0,
    });
    expect(capped.capped).toBe(true);
    expect(basePpwFromSticker(capped.stickerPpwCents, 65)).toBe(193);

    // The typed $3.00 clears a $2.00 floor; what is actually kept does not.
    expect(underBaseFloor(grossPpwFromNet(300, 65)!, 65, 200)).toBe(false);
    expect(underBaseFloor(capped.stickerPpwCents, 65, 200)).toBe(true);
    // …and a floor set in the capped world is met.
    expect(underBaseFloor(capped.stickerPpwCents, 65, 175)).toBe(false);
  });

  it("adders drag the kept base under the floor, because the cap makes them ours", () => {
    const withAdder = capStickerToFinalPpw({
      stickerPpwCents: grossPpwFromNet(300, 65)!,
      maxFinalPpwCents: 550,
      systemSizeKwDc: 8.8,
      dealerFeePct: 65,
      adderTotalCents: 1_450_000, // a $14,500 re-roof
    });
    // Same cap, same fee — but the extra work has eaten the array's share of it.
    expect(basePpwFromSticker(withAdder.stickerPpwCents, 65)).toBeLessThan(193);
    expect(underBaseFloor(withAdder.stickerPpwCents, 65, 175)).toBe(true);
  });
});

describe("the company band and the lender floor, at the validation layer", () => {
  const loan = (over: Partial<FinanceForValidation> = {}): FinanceForValidation => ({
    product: "loan", grossPpwCents: grossPpwFromNet(287, 18)!, dealerFeePct: 18,
    contractPriceCents: 3_500_000,
    rateMillsPerKwh: null, monthlyPaymentCents: null, escalatorPct: null, termYears: null,
    downPaymentCents: null, loanMonthlyPaymentCents: 27_400,
    aprPct: 6.99, loanTermMonths: 300,
    ...over,
  });
  const codes = (f: FinanceForValidation) => validateFinance(f, A).map((i) => i.code);

  it("judges the company band on the BASE, so a high fee no longer trips it", () => {
    // $5.00/W base on a 45% programme stickers at $9.09/W. The band is
    // $1.50–$8.00 and the base is comfortably inside it; the sticker is not,
    // and comparing that one blocked a deal the builder had shown as fine.
    const f = loan({ grossPpwCents: grossPpwFromNet(500, 45)!, dealerFeePct: 45 });
    expect(basePpwFromSticker(f.grossPpwCents, 45)).toBe(500);
    expect(f.grossPpwCents).toBeGreaterThan(A.maxPpwCents);
    expect(codes(f)).not.toContain("pricing.ppw_out_of_range");
    expect(canGenerate(validateFinance(f, A))).toBe(true);
  });

  it("still blocks a base genuinely outside the band", () => {
    expect(codes(loan({ grossPpwCents: grossPpwFromNet(120, 18)!, dealerFeePct: 18 })))
      .toContain("pricing.ppw_out_of_range");
    expect(codes(loan({ grossPpwCents: grossPpwFromNet(900, 18)!, dealerFeePct: 18 })))
      .toContain("pricing.ppw_out_of_range");
  });

  it("BLOCKS a deal leaving less than the lender's minimum", () => {
    const f = loan({ minBasePpwCents: 300 }); // keeps $2.87, demands $3.00
    expect(codes(f)).toContain("pricing.below_lender_floor");
    expect(canGenerate(validateFinance(f, A))).toBe(false);
    expect(validateFinance(f, A).find((i) => i.code === "pricing.below_lender_floor")?.message)
      .toMatch(/\$2\.87\/W .* \$3\.00\/W minimum/);
  });

  it("allows a deal exactly ON the floor — it is a minimum, not a margin to beat", () => {
    expect(codes(loan({ minBasePpwCents: 287 }))).not.toContain("pricing.below_lender_floor");
  });

  it("raises nothing on a lender that sets no floor, which is nearly all of them", () => {
    expect(codes(loan())).not.toContain("pricing.below_lender_floor");
    expect(codes(loan({ minBasePpwCents: null }))).not.toContain("pricing.below_lender_floor");
  });

  it("never floors a lease or a PPA, which have no base to floor", () => {
    const lease: FinanceForValidation = {
      product: "lease", grossPpwCents: 0, dealerFeePct: 0, contractPriceCents: 0,
      rateMillsPerKwh: null, monthlyPaymentCents: 18_500, escalatorPct: 2.9, termYears: 20,
      downPaymentCents: null, loanMonthlyPaymentCents: null, minBasePpwCents: 300,
    };
    expect(codes(lease)).not.toContain("pricing.below_lender_floor");
  });
});
