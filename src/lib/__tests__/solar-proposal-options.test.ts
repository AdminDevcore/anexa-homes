import { describe, it, expect } from "vitest";
import {
  buildProposalSnapshot,
  postSolarUtilityCents,
  type ProposalAlternative,
} from "@/lib/solar-proposal";
import type { SolarAssumptions } from "@/lib/solar-money";

/**
 * The payment menu.
 *
 * The rule under test throughout: every option is PRICED AT GENERATION and
 * frozen, and the option the deal was quoted on stays exactly where it has
 * always been. A menu that recomputed prices in the browser would be a menu
 * anyone with a developer console could edit, in the one document whose whole
 * purpose is to record what was offered.
 */

const A: SolarAssumptions = {
  derateFactor: 0.84,
  annualDegradationPct: 0.5,
  utilityEscalationPct: 3.5,
  kwhPerKwYear: 1450,
  utilityMeterFeeCents: 1000,
  companyDefaultBasePpwCents: 350,
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
  loanTermMonths: 300,
};

/** Cash at the company's own net rate — the loan sticker less the lender's cut. */
const CASH_ALT: ProposalAlternative = {
  key: "cash",
  label: "Pay in full",
  lender: null,
  finance: {
    product: "cash",
    grossPpwCents: 287,
    dealerFeePct: 0,
    adderTotalCents: 0,
    rateMillsPerKwh: null,
    monthlyPaymentCents: null,
    escalatorPct: null,
    termYears: null,
    aprPct: null,
  },
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
    now: new Date("2026-08-21T12:00:00Z"),
    ...over,
  });

describe("the quoted option never moves", () => {
  it("puts the deal's own terms first, and marks them as the quoted one", () => {
    const s = build({ alternatives: [CASH_ALT] });
    expect(s.options).toHaveLength(2);
    expect(s.options![0].quoted).toBe(true);
    expect(s.options!.filter((o) => o.quoted)).toHaveLength(1);
  });

  it("leaves snapshot.financing and snapshot.savings identical to the quoted option", () => {
    const s = build({ alternatives: [CASH_ALT] });
    // Every renderer, every older proposal and every test reads these two.
    // Adding a menu must not move them.
    expect(s.options![0].financing).toEqual(s.financing);
    expect(s.options![0].savings).toEqual(s.savings);
  });

  it("prices a document with no alternatives exactly as one generated before the menu", () => {
    const withMenu = build({ alternatives: [] });
    const without = build();
    expect(withMenu.financing).toEqual(without.financing);
    expect(withMenu.savings).toEqual(without.savings);
    expect(without.options).toHaveLength(1);
  });
});

describe("each option carries its own price and its own twenty-five years", () => {
  it("prices cash below the loan, because cash pays no dealer fee", () => {
    const s = build({ alternatives: [CASH_ALT] });
    const [loan, cash] = s.options!;
    expect(loan.financing.finalPriceCents).toBe(350 * 10_000); // $3.50/W × 10 kW
    expect(cash.financing.finalPriceCents).toBe(287 * 10_000); // $2.87/W, no fee
    expect(cash.financing.finalPriceCents!).toBeLessThan(loan.financing.finalPriceCents!);
  });

  it("models each option separately, so the cheaper one saves more", () => {
    const s = build({ alternatives: [CASH_ALT] });
    const [loan, cash] = s.options!;
    expect(cash.savings.netSavingsCents).toBeGreaterThan(loan.savings.netSavingsCents);
    // And the two models are genuinely different objects, not a shared one.
    expect(cash.savings.years[0].solarCostCents).not.toBe(loan.savings.years[0].solarCostCents);
  });

  it("gives cash no monthly, because paying in full has none", () => {
    const s = build({ alternatives: [CASH_ALT] });
    expect(s.options!.find((o) => o.key === "cash")!.monthlyCents).toBeNull();
  });

  it("reports what the customer still owes the utility each month", () => {
    const s = build({ alternatives: [CASH_ALT] });
    const cash = s.options!.find((o) => o.key === "cash")!;
    // Year one grid top-up PLUS the standing meter fee, per month.
    expect(cash.postSolarMonthlyCents).toBe(
      Math.round(postSolarUtilityCents(cash.savings.years[0]) / 12)
    );
  });

  it("keeps a lease's escalator off the loan and the loan's APR off the lease", () => {
    const s = build({
      alternatives: [
        {
          key: "lease:x",
          label: "EverBright · 25 yr",
          lender: "EverBright",
          finance: {
            product: "lease",
            grossPpwCents: 0,
            dealerFeePct: 0,
            adderTotalCents: 0,
            rateMillsPerKwh: null,
            monthlyPaymentCents: 18_500,
            escalatorPct: 2.9,
            termYears: 25,
            aprPct: null,
          },
        },
      ],
    });
    const lease = s.options!.find((o) => o.key === "lease:x")!;
    expect(lease.financing.aprPct).toBeNull();
    expect(lease.financing.escalatorPct).toBe(2.9);
    expect(lease.financing.finalPriceCents).toBeNull();
    expect(lease.monthlyCents).toBe(18_500);

    const loan = s.options![0];
    expect(loan.financing.escalatorPct).toBeNull();
    expect(loan.financing.aprPct).toBe(6.99);
  });
});

describe("the menu cannot list the same programme twice", () => {
  it("drops an alternative that collides with the quoted option's key", () => {
    const s = build({
      alternatives: [
        // The catalogue row this deal was already quoted from.
        { ...CASH_ALT, key: "quoted:loan", label: "GoodLeap · generic terms" },
        CASH_ALT,
      ],
    });
    expect(s.options!.map((o) => o.key)).toEqual(["quoted:loan", "cash"]);
    // The survivor is the DEAL's copy, not the rate sheet's.
    expect(s.options![0].quoted).toBe(true);
    expect(s.options![0].financing.product).toBe("loan");
  });

  it("drops a duplicate among the alternatives themselves", () => {
    const s = build({ alternatives: [CASH_ALT, { ...CASH_ALT, label: "Cash again" }] });
    expect(s.options!.filter((o) => o.key === "cash")).toHaveLength(1);
    expect(s.options!.find((o) => o.key === "cash")!.label).toBe("Pay in full");
  });
});

describe("the shape of the year is drawn only when both halves are measured", () => {
  const months = (n: number) => Array.from({ length: 12 }, (_, i) => n + i * 10);

  it("carries twelve against twelve", () => {
    const s = build({
      design: { ...DESIGN, monthlyUsageKwh: months(900), monthlyProductionKwh: months(700) },
    });
    expect(s.monthly).not.toBeNull();
    expect(s.monthly!.usageKwh).toHaveLength(12);
    expect(s.monthly!.productionKwh).toHaveLength(12);
  });

  it("draws nothing when only production is known", () => {
    const s = build({ design: { ...DESIGN, monthlyProductionKwh: months(700) } });
    expect(s.monthly).toBeNull();
  });

  it("refuses a partly-filled year rather than padding it", () => {
    const s = build({
      design: {
        ...DESIGN,
        monthlyUsageKwh: [900, 880, 910],
        monthlyProductionKwh: months(700),
      },
    });
    expect(s.monthly).toBeNull();
  });

  it("refuses a year of zeros, which is an empty form and not a reading", () => {
    const s = build({
      design: {
        ...DESIGN,
        monthlyUsageKwh: Array(12).fill(0),
        monthlyProductionKwh: months(700),
      },
    });
    expect(s.monthly).toBeNull();
  });
});

describe("the home-value claim is only made when a company makes it", () => {
  it("omits the key entirely at zero, so nothing renders '0%'", () => {
    expect(build({ homeValueUpliftPct: 0 }).assumptions.homeValueUpliftPct).toBeUndefined();
    expect(build().assumptions.homeValueUpliftPct).toBeUndefined();
  });

  it("freezes the company's own figure when one is set", () => {
    expect(build({ homeValueUpliftPct: 4.1 }).assumptions.homeValueUpliftPct).toBe(4.1);
  });
});

/**
 * THE CLOSING CREDIT REACHES THE DOCUMENT.
 *
 * The figure is typed on the deal and frozen here, which is the whole point of
 * it: a credit offered for signing today cannot quietly come off a proposal
 * the household is already holding. These assert the path — deal field →
 * snapshot → the ladder the customer's page draws — rather than the ladder
 * arithmetic, which `solar-credit-ladder.test.ts` owns.
 */
describe("the sign today credit is frozen into the document", () => {
  it("carries the typed credit onto the quoted option's ladder", () => {
    const s = build({ signTodayTypedCents: 1_500_00 });
    const ladder = s.financing.creditLadder!;
    expect(ladder.signTodayCents).toBe(1_500_00);
    expect(ladder.signTodayLabel).toBe("Sign today credit");
    // The bottom line moved by exactly the credit, and nothing else did.
    const without = build().financing.creditLadder!;
    expect(without.signTodayCents).toBe(0);
    expect(ladder.netCostCents).toBe(without.netCostCents - 1_500_00);
    expect(ladder.contractValueCents).toBe(without.contractValueCents);
  });

  it("puts the same credit on every option in the menu", () => {
    // "Sign today" is an offer about the day, not about the product: quoting
    // it on the loan and not on the cash line beside it is an offer that
    // changes when the household picks differently.
    const s = build({ alternatives: [CASH_ALT], signTodayTypedCents: 1_000_00 });
    for (const o of s.options!) {
      expect(o.financing.creditLadder?.signTodayCents).toBe(1_000_00);
    }
  });

  it("leaves the price and the payment exactly where they were", () => {
    const withCredit = build({ signTodayTypedCents: 2_000_00 }).financing;
    const without = build().financing;
    expect(withCredit.finalPriceCents).toBe(without.finalPriceCents);
    expect(withCredit.leasePaymentCents).toBe(without.leasePaymentCents);
  });
});

/**
 * ONE MENU, SEVERAL PARTNERS, SEVERAL CREDITS.
 *
 * The rule that matters here: a column's closing credit belongs to whoever
 * publishes that column. Resolved once for the document, every card on the
 * sheet would print the deal partner's offer under somebody else's name — and
 * the sheet is frozen, so nobody could correct it afterwards.
 */
describe("the sign today credit is resolved per partner", () => {
  it("gives the quoted option's partner's fixed figure, whatever the rep typed", () => {
    const s = build({
      signTodayTypedCents: 5_000_00,
      signTodayRule: { mode: "fixed", fixedCents: 1_000_00, capPpwCents: null },
    });
    expect(s.financing.creditLadder?.signTodayCents).toBe(1_000_00);
  });

  it("derives it from what the household nets, not from the sticker", () => {
    // The fixture sells 10 kW at a $3.50/W sticker, so the system alone is
    // $35,000 — but the document claims all three federal credits, so what the
    // household is left holding is half of that. $17,500 is well under the
    // $30,000 a $3.00/W cap allows, and a partner cannot hand back money the
    // credits already took off. Measured against the sticker this was $5,000.
    const s = build({
      signTodayRule: { mode: "above_cap", fixedCents: null, capPpwCents: 300 },
    });
    const ladder = s.financing.creditLadder!;
    expect(s.financing.baseFinalCents).toBe(35_000_00);
    expect(ladder.signTodayCents).toBe(0);
  });

  it("hands back the overage on the net cost when the cap sits under it", () => {
    // The same 10 kW, netting $17,500 once the credits are claimed, against a
    // partner promising the household $1.50/W. $15,000 is allowed, so the
    // $2,500 above it is theirs.
    const s = build({
      signTodayRule: { mode: "above_cap", fixedCents: null, capPpwCents: 150 },
    });
    expect(s.financing.creditLadder!.signTodayCents).toBe(2_500_00);
  });

  it("measures the storage on the job alongside the array", () => {
    // The wiring, not the arithmetic: a battery is priced inside the dealer fee
    // and the household signs for it, so it has to reach the cap. $40,000 of
    // storage on this 18% programme is $48,780.49 on the contract, the credits
    // take half of that, and all of it is above the $1.50/W the partner allows.
    const withStorage = build({
      finance: { ...LOAN, batteryPriceCents: 40_000_00 },
      signTodayRule: { mode: "above_cap", fixedCents: null, capPpwCents: 150 },
    });
    const without = build({
      signTodayRule: { mode: "above_cap", fixedCents: null, capPpwCents: 150 },
    });
    expect(withStorage.financing.creditLadder!.signTodayCents).toBe(
      without.financing.creditLadder!.signTodayCents + Math.round(Math.round(40_000_00 / 0.82) / 2)
    );
  });

  it("measures the sticker when the job claims no credits at all", () => {
    // Nothing earned, so nothing comes off before the cap is applied and the
    // rule reads exactly as it did before credits entered it.
    const s = build({
      signTodayRule: { mode: "above_cap", fixedCents: null, capPpwCents: 300 },
      creditClaims: { itc: false, energyCommunity: false, domesticContent: false },
    });
    expect(s.financing.creditLadder!.signTodayCents).toBe(5_000_00);
  });

  it("gives nothing under a cap the deal is priced below", () => {
    const s = build({
      signTodayTypedCents: 2_000_00,
      // Far above anything this deal is sold at, so there is no overage — and
      // the rep's typed figure does not sneak in under the partner's rule.
      signTodayRule: { mode: "above_cap", fixedCents: null, capPpwCents: 1500 },
    });
    expect(s.financing.creditLadder?.signTodayCents).toBe(0);
  });

  it("lets each option in the menu carry its own partner's rule", () => {
    const s = build({
      signTodayTypedCents: 0,
      signTodayRule: { mode: "fixed", fixedCents: 1_000_00, capPpwCents: null },
      alternatives: [
        { ...CASH_ALT, signTodayRule: { mode: "fixed", fixedCents: 250_00, capPpwCents: null } },
      ],
    });
    const [quoted, cash] = s.options!;
    expect(quoted.financing.creditLadder?.signTodayCents).toBe(1_000_00);
    expect(cash.financing.creditLadder?.signTodayCents).toBe(250_00);
  });

  it("falls to what the rep typed on an option whose partner has no rule", () => {
    const s = build({
      signTodayTypedCents: 750_00,
      signTodayRule: { mode: "none", fixedCents: null, capPpwCents: null },
      alternatives: [CASH_ALT],
    });
    for (const o of s.options!) {
      expect(o.financing.creditLadder?.signTodayCents).toBe(750_00);
    }
  });
});
