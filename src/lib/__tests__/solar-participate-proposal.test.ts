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

describe("the customer's price", () => {
  it("quotes the $118,400 contract, and the $48,400 it was priced from stays the system price", () => {
    const without = build();
    const with_ = build({ contractAdjustment: PARTICIPATE });

    // Without a programme, nothing about this deal moves.
    expect(without.financing.contractPriceCents).toBe(48_400_00);
    expect(without.financing.finalPpwCents).toBe(550);

    // With one, the document quotes the paper the household signs.
    expect(with_.financing.contractPriceCents).toBe(118_400_00);
    expect(with_.financing.financedAmountCents).toBe(118_400_00);
    // The array is still 8,800 watts at $5.50 — that row does not move, it is
    // the contribution beneath it that carries the deal up to the total.
    expect(with_.financing.basePriceCents).toBe(48_400_00);
  });

  it("prints a price per watt that divides into the total above it", () => {
    const s = build({ contractAdjustment: PARTICIPATE });
    // $118,400 over 8,800 watts. Printing $5.50/W under a $118,400 total would
    // be two figures that do not divide into each other — the failure this
    // codebase has been bitten by most often.
    expect(s.financing.finalPpwCents).toBe(1_345);
    expect(
      Math.round(s.financing.finalPpwCents! * 8_800)
    ).toBeCloseTo(s.financing.contractPriceCents!, -4);
  });

  it("changes NOTHING on a deal whose partner runs no programme", () => {
    // The reversal is confined to the structure it was written for. Two
    // documents, one carrying a $70,000 programme and one not — and the one
    // without it is the document it always was, figure for figure.
    const without = build();
    const reference = build();

    expect(without.financing).toEqual(reference.financing);
    expect(without.financing.creditLadder).toBeUndefined();
    expect(without.financing.netMonthlyPaymentCents).toBeUndefined();
    expect(without.savings.creditReliefTotalCents).toBe(0);
  });

  it("reconciles the contract it prints", () => {
    const s = build({ contractAdjustment: PARTICIPATE });
    const adjustment = s.financing.lenderAdjustment!;

    expect(adjustment.lenderContractValueCents).toBe(118_400_00);
    expect(adjustment.adjustmentCents).toBe(70_000_00);
    expect(adjustment.customerObligationCents).toBe(48_400_00);
    expect(adjustment.label).toBe("Participate Program Contribution");
    // The printed total IS the contract value. They used to be different
    // numbers on purpose; now they are the same number on purpose.
    expect(s.financing.contractPriceCents).toBe(adjustment.lenderContractValueCents);
  });
});

describe("what the household actually pays", () => {
  it("takes the credits off the contract and hands back the difference", () => {
    const l = build({ contractAdjustment: PARTICIPATE }).financing.creditLadder!;

    // 30 + 10 + 10 on $118,400.
    expect(l.credits.map((c) => c.amountCents)).toEqual([35_520_00, 11_840_00, 11_840_00]);
    expect(l.creditTotalCents).toBe(59_200_00);
    expect(l.afterCreditsCents).toBe(59_200_00);
    // The remainder between that and the price the system was sold at.
    expect(l.incentiveCents).toBe(10_800_00);
    expect(l.netCostCents).toBe(48_400_00);
  });

  it("ends on the price the rep quoted, whichever bonuses this job earns", () => {
    for (const claims of [
      { itc: true, energyCommunity: true, domesticContent: true },
      { itc: true, energyCommunity: false, domesticContent: true },
      { itc: true, energyCommunity: false, domesticContent: false },
      { itc: false, energyCommunity: false, domesticContent: false },
    ]) {
      const l = build({ contractAdjustment: PARTICIPATE, creditClaims: claims })
        .financing.creditLadder!;
      expect(l.netCostCents).toBe(48_400_00);
      expect(l.creditTotalCents + l.incentiveCents).toBe(70_000_00);
    }
  });
});

describe("the payment and the savings", () => {
  it("amortises the $118,400 contract the household signs for", () => {
    const s = build({ contractAdjustment: PARTICIPATE });
    // 11,840,000 cents over 360 months at 0%.
    expect(s.financing.loanMonthlyPaymentCents).toBe(32_889);
    expect(s.financing.loanTermMonths).toBe(360);
    expect(s.financing.aprPct).toBe(0);
  });

  it("quotes the payment the credits leave them on, derived the same way", () => {
    const s = build({ contractAdjustment: PARTICIPATE });
    // $48,400 over the same 360 months at the same 0%.
    expect(s.financing.netMonthlyPaymentCents).toBe(13_444);
  });

  it("steps the years down at the paydown month rather than pocketing a lump", () => {
    const s = build({ contractAdjustment: PARTICIPATE });
    const years = s.savings.years;

    // Twelve of the higher payment, then the lower one for the rest — which is
    // what a household on a credit-funded loan actually pays.
    expect(years[0].solarPaymentCents).toBe(32_889 * 12);
    expect(years[1].solarPaymentCents).toBe(13_444 * 12);
    expect(years[24].solarPaymentCents).toBe(13_444 * 12);
    // And no lump: crediting the $70,000 in year one AND stepping the payment
    // down would hand the household the same money twice.
    expect(s.savings.creditReliefTotalCents).toBe(0);
  });

  it("never bills the contract value as a year-one cost", () => {
    const s = build({ contractAdjustment: PARTICIPATE });
    for (const y of s.savings.years) {
      expect(y.solarPaymentCents).toBeLessThan(70_000_00);
    }
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
    expect(s.schemaVersion).toBe(7);
    expect(s.calculationVersion).toBe(3);
  });

  it("keeps the disclosure with its figures already in it", () => {
    const s = build({ contractAdjustment: PARTICIPATE });
    const d = s.financing.lenderAdjustment!.disclosure;
    expect(d).toContain("$118,400");
    // Every token resolved. One surviving into a frozen document is a
    // "{customerObligation}" printed at a homeowner.
    expect(d).not.toContain("{");
  });

  it("suggests wording that does not put the contribution back in prose", () => {
    // The cost chapter stopped printing "$48,400 + $70,000 = $118,400" as rows
    // on 2026-08-29; wording the app itself proposes must not hand a household
    // the same breakdown in a sentence three lines below. An admin may still
    // choose to — the tokens exist and the settings preview flags them — but
    // not by accepting our suggestion unread.
    const d = build({ contractAdjustment: PARTICIPATE }).financing.lenderAdjustment!.disclosure;
    expect(d).not.toContain("$70,000");
    expect(d).not.toContain("$48,400");
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
