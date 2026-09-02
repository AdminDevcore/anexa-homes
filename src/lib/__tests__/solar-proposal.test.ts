import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildProposalSnapshot,
  savingsModel,
  environmentalImpact,
  SOLAR_TIMELINE,
  SOLAR_FAQS,
  ESTIMATE_DISCLAIMER,
} from "@/lib/solar-proposal";
import { PRODUCTION_MARGIN_PCT, type SolarAssumptions } from "@/lib/solar-money";

const A: SolarAssumptions = {
  derateFactor: 0.84,
  annualDegradationPct: 0.5,
  utilityEscalationPct: 3.5,
  kwhPerKwYear: 1450,
  utilityMeterFeeCents: 1000,
  defaultGrossPpwCents: 350,
  defaultDealerFeePct: 18,
  minOffsetPct: 0,
  maxOffsetPct: 150,
};

const DESIGN = {
  systemSizeKwDc: 10,
  year1ProductionKwh: 12_180,
  offsetPct: 87,
  annualUsageKwh: 14_000,
  moduleLabel: "Qcells Q.PEAK · 400W",
  moduleQty: 25,
  inverterLabel: "Enphase IQ8+",
  batteryLabel: null,
  mountType: "roof",
  utilityProvider: "Oncor",
  avgMonthlyBillCents: 21_000,
};

const LOAN = {
  product: "loan" as const,
  grossPpwCents: 350,
  dealerFeePct: 18,
  adderTotalCents: 0,
  rateMillsPerKwh: null,
  monthlyPaymentCents: null,
  escalatorPct: null,
  termYears: 25,
  aprPct: 6.99,
};

const build = (over: Partial<Parameters<typeof buildProposalSnapshot>[0]> = {}) =>
  buildProposalSnapshot({
    reference: "SP-TEST-V1",
    generatedById: "user-1",
    customer: { name: "Priya Raman", address: "902 Solaris Way, Dallas TX" },
    company: { name: "Anexa Homes", phone: "(866) 650-9996", email: null, logoUrl: null },
    design: DESIGN,
    finance: LOAN,
    lender: "GoodLeap",
    assumptions: A,
    now: new Date("2026-07-30T12:00:00Z"),
    ...over,
  });

describe("the proposal snapshot is self-contained and frozen", () => {
  it("records every assumption it used, so the document explains its own numbers", () => {
    const s = build();
    expect(s.assumptions.utilityEscalationPct).toBe(3.5);
    expect(s.assumptions.annualDegradationPct).toBe(0.5);
    expect(s.assumptions.kwhPerKwYear).toBe(1450);
    // Derived from the customer's OWN bill, not an invented national average.
    expect(s.assumptions.currentRateMillsPerKwh).toBe(180); // $210×12 / 14,000 kWh
  });

  it("freezes how far under the model its production was quoted", () => {
    // The document says so out loud, so the figure has to travel with it — a
    // proposal that read today's constant would describe a haircut its own
    // numbers never took the day the constant changes.
    expect(build().assumptions.productionMarginPct).toBe(PRODUCTION_MARGIN_PCT);
  });

  it("carries the non-binding-estimate disclaimer on every proposal", () => {
    const s = build();
    expect(s.disclaimers.estimate).toBe(ESTIMATE_DISCLAIMER);
    expect(s.disclaimers.estimate).toMatch(/not a binding offer|not a guarantee/i);
    expect(s.disclaimers.estimate).toMatch(/subject to credit approval/i);
  });

  it("changing assumptions later cannot alter an existing snapshot", () => {
    const before = build();
    // The company's CPA raises the escalation assumption next month…
    const after = build({ assumptions: { ...A, utilityEscalationPct: 6 } });
    // …a NEW proposal reflects it, but the old object is untouched.
    expect(after.assumptions.utilityEscalationPct).toBe(6);
    expect(before.assumptions.utilityEscalationPct).toBe(3.5);
    expect(after.savings.totalSavingsCents).not.toBe(before.savings.totalSavingsCents);
  });
});

describe("no incentive ever reaches a proposal", () => {
  it("leaves every incentive field null on a purchase", () => {
    const s = build();
    // Null, not zero: nothing renders, rather than rendering "$0 credit".
    expect(s.financing.itcEstimateCents).toBeNull();
    expect(s.financing.itcPct).toBeNull();
    expect(s.financing.stateIncentiveNote).toBeNull();
  });

  it("carries no incentive disclaimer, because no incentive is shown", () => {
    expect(build().disclaimers.incentive).toBeUndefined();
  });

  it("has no credit percentage literal in the proposal module either", () => {
    const src = readFileSync(new URL("../solar-proposal.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/federalItcPct/);
    expect(src).not.toMatch(/utilityEscalationPct\s*[=:]\s*\d/);
    expect(src).not.toMatch(/annualDegradationPct\s*[=:]\s*\d/);
  });
});

describe("financing summary matches the product", () => {
  it("a loan shows a system price and no per-kWh rate", () => {
    const s = build();
    expect(s.financing.contractPriceCents).toBe(3_500_000);
    expect(s.financing.rateMillsPerKwh).toBeNull();
    expect(s.financing.monthlyPaymentCents).toBeNull();
    expect(s.financing.lender).toBe("GoodLeap");
  });

  it("a PPA shows a rate and no system price", () => {
    const s = build({
      finance: {
        product: "ppa", grossPpwCents: 0, dealerFeePct: 0, adderTotalCents: 0,
        rateMillsPerKwh: 145, monthlyPaymentCents: null, escalatorPct: 2.9,
        termYears: 25, aprPct: null,
      },
    });
    expect(s.financing.contractPriceCents).toBeNull();
    expect(s.financing.rateMillsPerKwh).toBe(145);
  });
});

describe("25-year savings model", () => {
  it("runs 25 years and compounds the utility rate", () => {
    const s = build();
    expect(s.savings.years).toHaveLength(25);
    const y1 = s.savings.years[0];
    const y25 = s.savings.years[24];
    expect(y25.utilityCostCents).toBeGreaterThan(y1.utilityCostCents);
  });

  it("production falls each year with degradation", () => {
    const s = build();
    expect(s.savings.years[24].productionKwh).toBeLessThan(s.savings.years[0].productionKwh);
  });

  it("a lease with no escalator costs the same every year", () => {
    const { years } = savingsModel({
      product: "lease",
      year1ProductionKwh: 12_180,
      annualUsageKwh: 12_180, // fully offset, so no residual grid cost
      currentRateMillsPerKwh: 150,
      leaseMonthlyCents: 18_500,
      escalatorPct: 0,
      termYears: 25,
      assumptions: A,
    });
    // Degradation means a little grid top-up creeps in, so compare the solar
    // payment portion only in year 1 vs a flat expectation. The year's cost
    // also carries the utility's standing meter fee, which no amount of
    // production removes.
    expect(years[0].solarPaymentCents).toBe(18_500 * 12);
    expect(years[0].solarCostCents).toBe(18_500 * 12 + A.utilityMeterFeeCents * 12);
  });

  it("stops charging a lease payment after the term ends", () => {
    const { years } = savingsModel({
      product: "lease",
      year1ProductionKwh: 12_180,
      annualUsageKwh: 12_180,
      currentRateMillsPerKwh: 150,
      leaseMonthlyCents: 18_500,
      escalatorPct: 0,
      termYears: 10,
      assumptions: A,
      years: 25,
    });
    expect(years[9].solarCostCents).toBeGreaterThan(years[10].solarCostCents);
  });
});

/**
 * The whole chain, on a real loan: rate sheet → payment → twenty-five years.
 *
 * The unit tests prove `savingsModel` spreads a schedule it is handed. This
 * proves the schedule is actually handed to it — the payment is resolved once,
 * BEFORE the model runs, so the figure printed on the cost chapter is the
 * figure the years were built from. When those two came from different places
 * they disagreed, and a document that quotes $168 a month and then bills
 * $60,500 in year one is not one a homeowner can be walked through.
 */
describe("a financed proposal bills the payment it quotes", () => {
  const FINANCED = { ...LOAN, aprPct: 0, loanTermMonths: 360, termYears: null };

  it("the year-one figure is twelve of the payment on the cost chapter", () => {
    const s = build({ finance: FINANCED });
    const monthly = s.financing.loanMonthlyPaymentCents!;
    expect(monthly).toBeGreaterThan(0);
    expect(s.savings.years[0].solarPaymentCents).toBe(monthly * 12);
    // And emphatically NOT the whole contract.
    expect(s.savings.years[0].solarPaymentCents).not.toBe(s.financing.contractPriceCents);
  });

  it("carries the term, so the payment is not quoted open-ended", () => {
    const s = build({ finance: FINANCED });
    expect(s.financing.loanTermMonths).toBe(360);
    // `termYears` is the lease's field and no loan row has ever held one — the
    // reason a loan used to show a payment with no term beside it.
    expect(s.financing.termYears).toBeNull();
  });

  it("puts nothing in the loan term of a cash proposal", () => {
    const s = build({
      finance: {
        product: "cash" as const, grossPpwCents: 350, dealerFeePct: 0, adderTotalCents: 0,
        rateMillsPerKwh: null, monthlyPaymentCents: null, escalatorPct: null,
        termYears: null, aprPct: null,
      },
      lender: null,
    });
    expect(s.financing.loanTermMonths).toBeNull();
    expect(s.savings.years[0].solarPaymentCents).toBe(s.financing.contractPriceCents);
  });

  it("prices every option in the menu the same way", () => {
    // A menu that spread the quoted loan and lumped the alternatives would be
    // comparing a monthly against a cheque.
    const s = build({
      finance: FINANCED,
      alternatives: [
        {
          key: "loan:alt",
          label: "Climate First · 25 yr",
          lender: "Climate First",
          finance: {
            product: "loan" as const, grossPpwCents: 320, dealerFeePct: 20,
            adderTotalCents: 0, rateMillsPerKwh: null, monthlyPaymentCents: null,
            escalatorPct: null, termYears: null, aprPct: 7.25, loanTermMonths: 300,
          },
        },
      ],
    });
    const alt = s.options!.find((o) => o.key === "loan:alt")!;
    expect(alt.monthlyCents).toBeGreaterThan(0);
    expect(alt.savings.years[0].solarPaymentCents).toBe(alt.monthlyCents! * 12);
    // 25 years of a 25-year loan: every year of the model carries payments.
    expect(alt.savings.years[24].solarPaymentCents).toBe(alt.monthlyCents! * 12);
  });
});

describe("customer-facing content", () => {
  it("has the six timeline steps in order", () => {
    expect(SOLAR_TIMELINE.map((s) => s.key)).toEqual([
      "site_survey", "design", "permitting", "installation", "inspection", "pto",
    ]);
  });

  it("is honest about the permitting wait being outside our control", () => {
    const permitting = SOLAR_TIMELINE.find((s) => s.key === "permitting")!;
    expect(permitting.blurb).toMatch(/not in our hands|longest/i);
  });

  it("answers the questions homeowners actually ask", () => {
    expect(SOLAR_FAQS.length).toBeGreaterThanOrEqual(5);
    const joined = SOLAR_FAQS.map((f) => f.q).join(" ").toLowerCase();
    expect(joined).toMatch(/power goes out/);
    expect(joined).toMatch(/sell the house/);
    expect(joined).toMatch(/roof/);
  });
});

describe("environmental impact", () => {
  it("scales with lifetime production", () => {
    const small = environmentalImpact(100_000);
    const big = environmentalImpact(300_000);
    expect(big.tonsCo2Avoided).toBeGreaterThan(small.tonsCo2Avoided);
    expect(big.treesEquivalent).toBeGreaterThan(small.treesEquivalent);
  });
  it("is zero for a system that produces nothing", () => {
    expect(environmentalImpact(0).tonsCo2Avoided).toBe(0);
  });
});

/**
 * The payment a homeowner reads off the proposal.
 *
 * Two figures can fill this line and they are not equal in standing: one is
 * amortised from the quoted product so a rep can sell today, the other came
 * back from a real credit approval. The document has to show the approved one
 * whenever it exists, and say which of the two it is showing.
 */
describe("the loan payment on the proposal", () => {
  it("amortises the quoted terms before an approval exists", () => {
    const s = build({
      finance: { ...LOAN, aprPct: 4.99, loanTermMonths: 300, loanMonthlyPaymentCents: null },
    });
    expect(s.financing.loanPaymentApproved).toBe(false);
    expect(s.financing.loanMonthlyPaymentCents).toBeGreaterThan(0);
  });

  it("shows the lender's own figure once there is one, not the estimate", () => {
    const s = build({
      finance: { ...LOAN, aprPct: 4.99, loanTermMonths: 300, loanMonthlyPaymentCents: 20_113 },
    });
    expect(s.financing.loanMonthlyPaymentCents).toBe(20_113);
    expect(s.financing.loanPaymentApproved).toBe(true);
  });

  it("takes the down payment out of the financed amount", () => {
    const withDown = build({
      finance: { ...LOAN, aprPct: 4.99, loanTermMonths: 300, downPaymentCents: 1_000_000 },
    });
    const without = build({ finance: { ...LOAN, aprPct: 4.99, loanTermMonths: 300 } });
    expect(withDown.financing.loanMonthlyPaymentCents!).toBeLessThan(
      without.financing.loanMonthlyPaymentCents!
    );
  });

  it("quotes no monthly at all when the term is missing", () => {
    // Better a proposal with no payment line than one with a fabricated payment.
    const s = build({ finance: { ...LOAN, aprPct: 4.99, loanTermMonths: null } });
    expect(s.financing.loanMonthlyPaymentCents).toBeNull();
  });

  it("never puts a loan payment on a lease", () => {
    const s = build({
      finance: {
        ...LOAN,
        product: "lease" as const,
        monthlyPaymentCents: 17_500,
        escalatorPct: 2.9,
        aprPct: null,
        loanMonthlyPaymentCents: 20_113,
      },
    });
    expect(s.financing.loanMonthlyPaymentCents).toBeNull();
  });
});

describe("a published payment factor outranks our amortisation", () => {
  const FACTORS = {
    factorWithPaydownMicros: 5712,
    factorWithoutPaydownMicros: 8140,
    paydownPct: 30,
    paydownMonths: 18,
  };

  it("quotes the factor's payment, not the one derived from APR and term", () => {
    // The factor bakes in the dealer fee and the promotional structure, so it
    // does not agree with amortising the same APR over the same term. Printing
    // the derived one when the lender published a factor misquotes the customer.
    const withFactor = build({
      finance: { ...LOAN, loanTermMonths: 300, downPaymentCents: null },
      loanFactors: FACTORS,
    });
    const withoutFactor = build({
      finance: { ...LOAN, loanTermMonths: 300, downPaymentCents: null },
    });
    expect(withFactor.financing.loanMonthlyPaymentCents).not.toBe(
      withoutFactor.financing.loanMonthlyPaymentCents
    );
    const principal = withFactor.financing.contractPriceCents ?? 0;
    expect(withFactor.financing.loanMonthlyPaymentCents).toBe(
      Math.round((principal * 5712) / 1_000_000)
    );
  });

  it("still yields to the lender's own figure from a real approval", () => {
    const s = build({
      finance: {
        ...LOAN,
        loanTermMonths: 300,
        loanMonthlyPaymentCents: 27_400,
        downPaymentCents: null,
      },
      loanFactors: FACTORS,
    });
    expect(s.financing.loanMonthlyPaymentCents).toBe(27_400);
    expect(s.financing.loanPaymentApproved).toBe(true);
  });

  it("freezes the payment WITHOUT the paydown next to the one with it", () => {
    // A document showing only the low, paydown-contingent figure is the most
    // misleading thing a solar proposal can do.
    const s = build({
      finance: { ...LOAN, loanTermMonths: 300, downPaymentCents: null },
      loanFactors: FACTORS,
    });
    expect(s.financing.loanMonthlyWithoutPaydownCents).not.toBeNull();
    expect(s.financing.loanMonthlyWithoutPaydownCents!).toBeGreaterThan(
      s.financing.loanMonthlyPaymentCents!
    );
    expect(s.financing.loanPaydownMonths).toBe(18);
    expect(s.financing.loanPaydownPct).toBe(30);
  });

  it("applies the factor to the FINANCED amount, not the gross", () => {
    // A down payment is not borrowed; applying the factor to it quotes a
    // payment on money nobody owes.
    const noDown = build({
      finance: { ...LOAN, loanTermMonths: 300, downPaymentCents: null },
      loanFactors: FACTORS,
    });
    const withDown = build({
      finance: { ...LOAN, loanTermMonths: 300, downPaymentCents: 500_000 },
      loanFactors: FACTORS,
    });
    expect(withDown.financing.loanMonthlyPaymentCents!).toBeLessThan(
      noDown.financing.loanMonthlyPaymentCents!
    );
  });

  it("carries no factor figures for a program that publishes none", () => {
    const s = build({ finance: { ...LOAN, loanTermMonths: 300 } });
    expect(s.financing.loanMonthlyWithoutPaydownCents).toBeNull();
    expect(s.financing.loanPaydownCents).toBeNull();
  });
});

describe("the Qualify link is loan-only and never the dealer portal", () => {
  it("freezes the lender's CUSTOMER application link on a loan", () => {
    const s = build({ lenderApplyUrl: "https://apply.example.com/abc" });
    expect(s.financing.applyUrl).toBe("https://apply.example.com/abc");
  });

  it("omits it on cash, which has no lender to qualify with", () => {
    const s = build({
      finance: { ...LOAN, product: "cash" as const, aprPct: null },
      lenderApplyUrl: "https://apply.example.com/abc",
    });
    expect(s.financing.applyUrl).toBeNull();
  });
});

describe("the lender's logo travels with the document", () => {
  it("freezes the mark alongside the name on a loan", () => {
    const s = build({ lenderLogoUrl: "/api/solar/lender-logo?lender=abc&v=17" });
    expect(s.financing.lender).toBe("GoodLeap");
    expect(s.financing.lenderLogoUrl).toBe("/api/solar/lender-logo?lender=abc&v=17");
  });

  it("omits it on cash, which has no lender at all", () => {
    const s = build({
      finance: { ...LOAN, product: "cash" as const, aprPct: null },
      lenderLogoUrl: "/api/solar/lender-logo?lender=abc&v=17",
    });
    expect(s.financing.lender).toBeNull();
    expect(s.financing.lenderLogoUrl).toBeNull();
  });

  it("is null when the partner has no logo, so the view falls back to a monogram", () => {
    expect(build().financing.lenderLogoUrl).toBeNull();
  });
});

describe("the extra work is named on the customer's copy", () => {
  const ADDERS = [
    { label: "Full re-roof (under array)", amountCents: 1_450_000 },
    { label: "Steep roof (7/12+)", amountCents: 96_000 },
  ];

  it("carries each line, so a homeowner can see what the money bought", () => {
    const s = build({ finance: { ...LOAN, adderTotalCents: 1_546_000, adders: ADDERS } });
    expect(s.financing.adders!.map((a) => a.label)).toEqual(ADDERS.map((a) => a.label));
    // At STICKER, not at catalogue: the lender takes 18% of the re-roof as well
    // as of the array, so what the customer signs for the extra work is the
    // catalogue price grossed up by the same fee. $15,460 becomes $18,853.66.
    expect(s.financing.adderTotalCents).toBe(Math.round(1_546_000 / 0.82));
    expect(s.financing.adders![0].amountCents).toBeGreaterThan(1_450_000);
  });

  it("the lines add up to the total the contract is built on", () => {
    const s = build({ finance: { ...LOAN, adderTotalCents: 1_546_000, adders: ADDERS } });
    const summed = s.financing.adders!.reduce((n, a) => n + a.amountCents, 0);
    expect(summed).toBe(s.financing.adderTotalCents);
  });

  it("the whole breakdown adds up: system + extra work = total price", () => {
    // The arithmetic a homeowner does at the kitchen table. Every row on the
    // document is at sticker, so the three of them agree to the cent.
    const s = build({ finance: { ...LOAN, adderTotalCents: 1_546_000, adders: ADDERS } });
    expect(s.financing.basePriceCents! + s.financing.adderTotalCents!).toBe(
      s.financing.contractPriceCents
    );
  });

  it("prints a roof financed on top at its own price, not grossed up", () => {
    // The Amos exception on the customer's own page. The re-roof is added to
    // the loan at $14,500 and the steep-roof charge still carries the fee, so
    // the two lines are priced by different rules on one breakdown — and the
    // three rows still have to add up to the total printed under them.
    const s = build({
      finance: {
        ...LOAN,
        adderTotalCents: 96_000,
        onTopAdderTotalCents: 1_450_000,
        adders: [
          { ...ADDERS[0], financedOnTop: true },
          ADDERS[1],
        ],
      },
    });
    const [roof, steep] = s.financing.adders!;
    expect(roof.amountCents).toBe(1_450_000); // at face
    expect(steep.amountCents).toBe(Math.round(96_000 / 0.82)); // fee included
    expect(roof.amountCents + steep.amountCents).toBe(s.financing.adderTotalCents);
    expect(s.financing.basePriceCents! + s.financing.adderTotalCents!).toBe(
      s.financing.contractPriceCents
    );
  });

  /**
   * The document is frozen. A rename in the catalogue next quarter must not
   * retitle a line on a proposal a homeowner has already read.
   */
  it("copies the labels rather than referring to the catalogue", () => {
    const source = [{ label: "Main panel upgrade (200A)", amountCents: 385_000 }];
    const s = build({ finance: { ...LOAN, adderTotalCents: 385_000, adders: source } });
    source[0].label = "RENAMED IN THE CATALOGUE";
    expect(s.financing.adders![0].label).toBe("Main panel upgrade (200A)");
  });

  it("drops a line that costs nothing rather than printing a $0 row", () => {
    const s = build({
      finance: {
        ...LOAN,
        adderTotalCents: 385_000,
        adders: [
          { label: "Main panel upgrade (200A)", amountCents: 385_000 },
          { label: "Steep roof (7/12+)", amountCents: 0 },
        ],
      },
    });
    expect(s.financing.adders).toHaveLength(1);
  });

  /**
   * Every proposal generated before v3 carries a total and no lines. It has to
   * keep rendering exactly as it did: back-filling names would be inventing a
   * breakdown for money nobody itemised at the time.
   */
  it("omits the key entirely on a design with no itemised adders", () => {
    const s = build({ finance: { ...LOAN, adderTotalCents: 385_000 } });
    expect("adders" in s.financing).toBe(false);
    expect(s.financing.adderTotalCents).toBe(Math.round(385_000 / 0.82));
  });

  it("names nothing on a lease, which has no system price to add to", () => {
    const s = build({
      finance: {
        ...LOAN,
        product: "lease" as const,
        monthlyPaymentCents: 23_808,
        adderTotalCents: 385_000,
        adders: ADDERS,
      },
    });
    expect("adders" in s.financing).toBe(false);
    expect(s.financing.adderTotalCents).toBeNull();
  });
});

describe("the document names the model its production came from", () => {
  it("lists the market average when that is what produced the figure", () => {
    const s = build();
    expect("yieldBasis" in s.assumptions).toBe(false);
    expect(s.assumptions.kwhPerKwYear).toBe(1450);
  });

  /**
   * The assumptions section exists to be true. Once production is simulated per
   * plane, "1,450 kWh per kW per year" is a false sentence sitting in the one
   * part of the document whose whole job is to explain the numbers.
   */
  it("records the simulation when one produced the figure", () => {
    const s = build({
      yieldBasis: { source: "pvwatts", station: "Dallas", arrays: 3, totalArrays: 3 },
    });
    expect(s.assumptions.yieldBasis).toEqual({
      source: "pvwatts",
      station: "Dallas",
      arrays: 3,
      totalArrays: 3,
    });
  });

  it("says how many arrays were simulated when only some were", () => {
    const s = build({
      yieldBasis: { source: "pvwatts", station: null, arrays: 2, totalArrays: 3 },
    });
    expect(s.assumptions.yieldBasis!.arrays).toBe(2);
    expect(s.assumptions.yieldBasis!.totalArrays).toBe(3);
  });

  it("keeps the market yield on the document either way — it still explains the rest", () => {
    const s = build({
      yieldBasis: { source: "pvwatts", station: "Dallas", arrays: 1, totalArrays: 2 },
    });
    // The unsimulated array is still priced on it, so the figure has to be there.
    expect(s.assumptions.kwhPerKwYear).toBe(1450);
  });

  it("omits the key rather than holding a null the renderer would have to guard", () => {
    const s = build({ yieldBasis: null });
    expect("yieldBasis" in s.assumptions).toBe(false);
  });
});
