import { describe, it, expect } from "vitest";
import { buildProposalSnapshot, quotedTotalCents, quotedPpwCents } from "@/lib/solar-proposal";
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

  it("hands the household's own price to every page that says 'the price'", () => {
    /*
      THE 2026-08-30 REVERSAL, in one assertion.

      The snapshot still freezes the contract and the contract's own rate — the
      funder's submission summary leads with both, because that is the figure
      its file reviewer is checking. What changed is what the HOUSEHOLD's
      document quotes: a page opening on "System price $118,400 · $13.45 per
      watt" for somebody quoted $48,400 at $5.50 shows a number matching
      nothing they have been told and nothing they can compare against another
      quote. The contract keeps its own block, in full, underneath.
    */
    const with_ = build({ contractAdjustment: PARTICIPATE });
    expect(quotedTotalCents(with_.financing)).toBe(48_400_00);
    expect(quotedPpwCents(with_.financing, 8.8)).toBe(550);
    // Still frozen, still printed, still labelled — one block lower.
    expect(with_.financing.contractPriceCents).toBe(118_400_00);
    expect(with_.financing.finalPpwCents).toBe(1_345);

    // On a deal with no programme the two are the same figure, which is why
    // this is one code path rather than a branch in every renderer.
    const without = build();
    expect(quotedTotalCents(without.financing)).toBe(without.financing.contractPriceCents);
    expect(quotedPpwCents(without.financing, 8.8)).toBe(without.financing.finalPpwCents);
  });

  it("changes NOTHING on a deal whose partner runs no programme", () => {
    // The reversal is confined to the structure it was written for. Two
    // documents, one carrying a $70,000 programme and one not — and the one
    // without it is the document it always was, figure for figure.
    const without = build();
    const reference = build();

    expect(without.financing).toEqual(reference.financing);
    // The two figures the PROGRAMME structure owns. A deal with no partner
    // contribution has no re-amortised payment the household is promised and
    // no relief inside the years it prints by default — and that is still true
    // now that such a deal carries a credit scenario for the switch to reach.
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

  it("leaves the default model exactly where it was", () => {
    // THE SWITCH ADDS A SCENARIO; IT DOES NOT MOVE THE DEFAULT. Twelve of the
    // higher payment, then the lower one for the rest — which is what a
    // household on a credit-funded loan actually pays, and what this document
    // said before the switch existed.
    const years = build({ contractAdjustment: PARTICIPATE }).savings.years;
    expect(years[0].solarPaymentCents).toBe(32_889 * 12);
    expect(years[1].solarPaymentCents).toBe(13_444 * 12);
    expect(years[24].solarPaymentCents).toBe(13_444 * 12);
  });

  it("models a second horizon with the credits already applied", () => {
    const s = build({ contractAdjustment: PARTICIPATE });
    const on = s.options![0].creditsApplied!.savings.years;

    // The lower payment from the FIRST month, not the thirteenth.
    expect(on[0].solarPaymentCents).toBe(13_444 * 12);
    expect(on[24].solarPaymentCents).toBe(13_444 * 12);

    // And no lump on either: crediting the $70,000 in year one AND lowering the
    // payment would hand the household the same money twice.
    expect(s.savings.creditReliefTotalCents).toBe(0);
    expect(s.options![0].creditsApplied!.savings.creditReliefTotalCents).toBe(0);
  });

  it("quotes the switch's two faces from the same terms", () => {
    const s = build({ contractAdjustment: PARTICIPATE });
    const o = s.options![0];
    expect(o.monthlyCents).toBe(32_889);
    expect(o.creditsApplied!.monthlyCents).toBe(13_444);
    expect(o.creditsApplied!.monthlyCents).toBe(s.financing.netMonthlyPaymentCents);
  });

  it("offers the switch on an ordinary deal, and leaves its default alone", () => {
    /*
      THE 2026-08-30 CHANGE. A household on a plain solar loan earns the same
      federal credits as one on a partner programme — the credits are a fact
      about the roof and the return, not about whose paper the deal is written
      on — so the switch reaches every purchase deal now. What did NOT change is
      the copy that prints when nobody throws it.
    */
    const s = build();
    const o = s.options![0];

    // The ladder is the degenerate one: no second figure, so nothing is handed
    // back and the credits simply come off the price.
    const ladder = s.financing.creditLadder!;
    expect(ladder.contractValueCents).toBe(48_400_00);
    expect(ladder.quotedPriceCents).toBe(48_400_00);
    expect(ladder.incentiveCents).toBe(0);
    // 50% of $48,400 — the base credit and both bonuses, which this deal claims
    // by default and a rep may untick on the deal.
    expect(ladder.creditTotalCents).toBe(24_200_00);
    expect(ladder.netCostCents).toBe(24_200_00);

    // THE DEFAULT IS UNTOUCHED: the payment quoted, flat, for the whole term.
    // $48,400 over 360 months at 0%.
    expect(o.monthlyCents).toBe(13_444);
    expect(s.savings.years[0].solarPaymentCents).toBe(13_444 * 12);
    expect(s.savings.years[2].solarPaymentCents).toBe(13_444 * 12);
    expect(s.savings.creditReliefTotalCents).toBe(0);

    // And the other side of the switch is there: the same terms on what is left
    // after the credits, from the first month.
    expect(o.creditsApplied!.monthlyCents).toBe(6_722);
    expect(o.creditsApplied!.savings.years[0].solarPaymentCents).toBe(6_722 * 12);
  });

  it("offers no switch where there is nothing at all to claim", () => {
    // An admin who has zeroed every percentage is saying this company quotes no
    // credits. The document then shows one set of figures and no control
    // offering a second — which is also how every proposal generated before
    // both scenarios were frozen reads.
    const s = build({
      creditRates: { itcPct: 0, energyCommunityPct: 0, domesticContentPct: 0 },
    });
    expect(s.financing.creditLadder).toBeUndefined();
    expect(s.options![0].creditsApplied).toBeUndefined();
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
    expect(s.schemaVersion).toBe(8);
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
    const goodleap = options.find((o) => o.key === "loan:goodleap")!;

    expect(quoted.financing.lenderAdjustment?.lenderContractValueCents).toBe(118_400_00);
    // A household switching option must not carry Participate's contract value
    // onto somebody else's paper.
    expect(goodleap.financing.lenderAdjustment).toBeUndefined();
  });

  it("drops the cash row entirely on a deal quoted against a contract value", () => {
    // The other rows are compared by their MONTHLY, which is like for like.
    // Cash is the one row that shows a raw price, and beside a contract written
    // at $118,400 the company's own $26,400 net price reads as a $92,000
    // mark-up for borrowing — which is not what either figure means.
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
      ],
    });
    expect((s.options ?? []).some((o) => o.key === "cash")).toBe(false);
  });

  it("keeps the cash row on every deal without one", () => {
    const s = build({
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
      ],
    });
    expect((s.options ?? []).some((o) => o.key === "cash")).toBe(true);
  });
});
