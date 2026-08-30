import { describe, it, expect } from "vitest";
import { buildProposalSnapshot, type SolarProposalSnapshot } from "@/lib/solar-proposal";
import { lifetimeFigure, lifetimeNote } from "@/lib/solar-proposal-pitch";
import { DISCLOSURE_TEMPLATE_SUGGESTION } from "@/lib/solar-contract-adjustment";
import type { SolarAssumptions } from "@/lib/solar-money";

/**
 * The worked example, end to end through the frozen document.
 *
 *   8.80 kW at $5.50/W          = $48,400   what the customer owes
 *   + $70,000 programme contribution
 *                               = $118,400  what the partner's paper says
 *
 * What this file is really testing is the ONE rule the feature exists to
 * protect: every figure a household reads about their own money comes off the
 * $48,400, and the $118,400 appears in exactly one place, labelled.
 */

const A: SolarAssumptions = {
  derateFactor: 0.84,
  annualDegradationPct: 0.5,
  utilityEscalationPct: 3.5,
  kwhPerKwYear: 1450,
  utilityMeterFeeCents: 1000,
  defaultGrossPpwCents: 550,
  defaultDealerFeePct: 65,
  minOffsetPct: 0,
  maxOffsetPct: 150,
  minPpwCents: 150,
  maxPpwCents: 800,
};

const DESIGN = {
  systemSizeKwDc: 8.8,
  year1ProductionKwh: 12_180,
  offsetPct: 87,
  annualUsageKwh: 14_000,
  moduleLabel: "Qcells Q.PEAK · 400W",
  moduleQty: 22,
  inverterLabel: "Enphase IQ8+",
  batteryLabel: null,
  mountType: "roof",
  utilityProvider: "Oncor",
  avgMonthlyBillCents: 21_000,
};

/** $5.50/W to the homeowner, 0% over 360 months — the Participate shape. */
const LOAN = {
  product: "loan" as const,
  grossPpwCents: 550,
  dealerFeePct: 65,
  adderTotalCents: 0,
  rateMillsPerKwh: null,
  monthlyPaymentCents: null,
  escalatorPct: null,
  termYears: null,
  aprPct: 0,
  loanTermMonths: 360,
};

const PARTICIPATE = {
  enabled: true,
  fixedCents: 70_000_00,
  label: "Participate Program Contribution",
  disclosure: DISCLOSURE_TEMPLATE_SUGGESTION,
};

function build(over: Partial<Parameters<typeof buildProposalSnapshot>[0]> = {}) {
  return buildProposalSnapshot({
    reference: "SP-PART-V1",
    generatedById: "user-1",
    customer: { name: "Priya Raman", address: "902 Solaris Way, Dallas TX" },
    company: { name: "Anexa Homes", phone: "(866) 650-9996", email: null, logoUrl: null },
    design: DESIGN,
    finance: LOAN,
    lender: "Participate",
    assumptions: A,
    now: new Date("2026-08-29T00:00:00Z"),
    ...over,
  });
}

/** Every figure on the document that is about the customer's own money. */
function customerFacingCents(s: SolarProposalSnapshot): number[] {
  const f = s.financing;
  return [
    f.contractPriceCents ?? 0,
    f.basePriceCents ?? 0,
    f.financedAmountCents ?? 0,
  ];
}

describe("the customer's price", () => {
  it("is 8,800 watts at $5.50 — $48,400 — and the contribution does not move it", () => {
    const without = build();
    const with_ = build({ contractAdjustment: PARTICIPATE });

    expect(without.financing.contractPriceCents).toBe(48_400_00);
    expect(with_.financing.contractPriceCents).toBe(48_400_00);
    expect(with_.financing.finalPpwCents).toBe(550);
    expect(with_.financing.financedAmountCents).toBe(48_400_00);
  });

  it("reaches $118,400 only on the reconciliation, and only there", () => {
    const s = build({ contractAdjustment: PARTICIPATE });
    const adjustment = s.financing.lenderAdjustment!;

    expect(adjustment.lenderContractValueCents).toBe(118_400_00);
    expect(adjustment.adjustmentCents).toBe(70_000_00);
    expect(adjustment.customerObligationCents).toBe(48_400_00);
    expect(adjustment.label).toBe("Participate Program Contribution");

    // NOTHING ELSE ON THE DOCUMENT IS THAT NUMBER. This is the assertion that
    // would fail if a future edit started deriving any customer figure from the
    // contract value.
    expect(customerFacingCents(s)).not.toContain(118_400_00);
  });

  it("prices identically with and without the contribution, figure for figure", () => {
    // The strongest statement of "purely additive" available: two documents,
    // one carrying a $70,000 programme and one not, agreeing on every single
    // number a household is asked to pay.
    const without = build();
    const with_ = build({ contractAdjustment: PARTICIPATE });

    expect(with_.financing.contractPriceCents).toBe(without.financing.contractPriceCents);
    expect(with_.financing.basePriceCents).toBe(without.financing.basePriceCents);
    expect(with_.financing.finalPpwCents).toBe(without.financing.finalPpwCents);
    expect(with_.financing.loanMonthlyPaymentCents).toBe(without.financing.loanMonthlyPaymentCents);
    expect(with_.savings.netSavingsCents).toBe(without.savings.netSavingsCents);
    expect(with_.savings.solarPaidCents).toBe(without.savings.solarPaidCents);
    expect(with_.savings.paybackYear).toBe(without.savings.paybackYear);
  });
});

describe("the payment and the savings", () => {
  it("amortises the $48,400 the customer owes, not the $118,400 contract", () => {
    const s = build({ contractAdjustment: PARTICIPATE });
    // 4,840,000 cents over 360 months at 0%.
    expect(s.financing.loanMonthlyPaymentCents).toBe(13_444);
    expect(s.financing.loanTermMonths).toBe(360);
    expect(s.financing.aprPct).toBe(0);
  });

  it("bills the twenty-five years at that payment", () => {
    const s = build({ contractAdjustment: PARTICIPATE });
    const monthly = s.financing.loanMonthlyPaymentCents!;
    const years = s.savings.years.length;

    // What the household pays for solar over the modelled horizon is the
    // payment times the months, never the contract value.
    expect(s.savings.solarPaidCents).toBe(monthly * 12 * years);
    expect(s.savings.solarPaidCents).toBeLessThan(70_000_00);
  });
});

describe("what the document says about ownership", () => {
  it("keeps its own sentence when the partner publishes none", () => {
    const s = build();
    const note = lifetimeNote(lifetimeFigure(s.savings), "Oncor", !!s.financing.ownershipNote);
    expect(s.financing.ownershipNote).toBeUndefined();
    if (lifetimeFigure(s.savings).negative) expect(note).toContain("You own it outright");
  });

  it("drops that claim and carries the partner's wording instead", () => {
    const s = build({
      contractAdjustment: PARTICIPATE,
      ownershipNote:
        "This is a prepaid lease. Participate owns the system for the 25-year term; " +
        "the agreement transfers to a buyer on sale, and a purchase option is available at year 20.",
    });

    expect(s.financing.ownershipNote).toContain("prepaid lease");
    const note = lifetimeNote(lifetimeFigure(s.savings), "Oncor", !!s.financing.ownershipNote);
    // The false claim is gone, and is not replaced by a duplicate of the
    // partner's paragraph — that is printed once, on the cost chapter.
    expect(note).not.toContain("You own it outright");
    expect(note).not.toContain("prepaid lease");
  });
});

describe("what the snapshot freezes", () => {
  it("records the version of the shape and of the arithmetic", () => {
    const s = build({ contractAdjustment: PARTICIPATE });
    expect(s.schemaVersion).toBe(6);
    expect(s.calculationVersion).toBe(2);
  });

  it("keeps the disclosure with its figures already in it", () => {
    const s = build({ contractAdjustment: PARTICIPATE });
    const d = s.financing.lenderAdjustment!.disclosure;
    expect(d).toContain("$118,400");
    expect(d).toContain("$70,000");
    expect(d).toContain("$48,400");
    expect(d).not.toContain("{");
  });

  it("carries the lender's product name for the funder's paperwork", () => {
    const s = build({ contractAdjustment: PARTICIPATE, lenderProductLabel: "30 yr · 0.00%" });
    expect(s.financing.lenderProductLabel).toBe("30 yr · 0.00%");
  });

  it("holds no undefined anywhere — an undefined reaching a renderer prints", () => {
    const s = build({ contractAdjustment: PARTICIPATE });
    expect(JSON.stringify(s)).not.toContain("undefined");
  });
});

describe("a deal on a partner with no programme", () => {
  it("carries no adjustment key at all, and no financed-amount row to explain", () => {
    const s = build();
    expect(s.financing.lenderAdjustment).toBeUndefined();
    // The financed amount is written on every purchase from v6 — the DOCUMENT
    // decides whether to print it, and only does when it says something the
    // total does not.
    expect(s.financing.financedAmountCents).toBe(s.financing.contractPriceCents);
  });

  it("says nothing when the programme is switched off or has not started", () => {
    expect(
      build({ contractAdjustment: { ...PARTICIPATE, enabled: false } }).financing.lenderAdjustment
    ).toBeUndefined();
    expect(
      build({
        contractAdjustment: { ...PARTICIPATE, effectiveAt: new Date("2026-12-01T00:00:00Z") },
      }).financing.lenderAdjustment
    ).toBeUndefined();
  });
});

describe("the payment menu", () => {
  it("gives each option its own partner's programme, and none to the others", () => {
    const s = build({
      contractAdjustment: PARTICIPATE,
      alternatives: [
        {
          key: "cash",
          label: "Pay in full",
          lender: null,
          finance: {
            product: "cash",
            grossPpwCents: 193,
            dealerFeePct: 0,
            adderTotalCents: 0,
            rateMillsPerKwh: null,
            monthlyPaymentCents: null,
            escalatorPct: null,
            termYears: null,
            aprPct: null,
          },
        },
        {
          key: "loan:goodleap",
          label: "GoodLeap · 25 yr · 4.99%",
          lender: "GoodLeap",
          finance: {
            product: "loan",
            grossPpwCents: 350,
            dealerFeePct: 18,
            adderTotalCents: 0,
            rateMillsPerKwh: null,
            monthlyPaymentCents: null,
            escalatorPct: null,
            termYears: null,
            aprPct: 4.99,
            loanTermMonths: 300,
          },
        },
      ],
    });

    const options = s.options ?? [];
    const quoted = options.find((o) => o.quoted)!;
    const cash = options.find((o) => o.key === "cash")!;
    const goodleap = options.find((o) => o.key === "loan:goodleap")!;

    expect(quoted.financing.lenderAdjustment?.lenderContractValueCents).toBe(118_400_00);
    // A household switching option must not carry Participate's contract value
    // onto somebody else's paper.
    expect(cash.financing.lenderAdjustment).toBeUndefined();
    expect(goodleap.financing.lenderAdjustment).toBeUndefined();
  });
});
