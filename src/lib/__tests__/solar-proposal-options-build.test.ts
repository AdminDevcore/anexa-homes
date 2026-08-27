import { describe, it, expect } from "vitest";
import {
  proposalAlternatives,
  cashPpwCents,
  MAX_PAYMENT_OPTIONS,
  type CatalogueProgramme,
} from "@/lib/solar-proposal-options";
import type { SolarAssumptions, FinalPpwMode } from "@/lib/solar-money";

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
  minPpwCents: 150,
  maxPpwCents: 800,
};

const lender = (
  id: string,
  name: string,
  rank = 0,
  maxFinalPpwCents: number | null = null,
  finalPpwMode: FinalPpwMode = "cap"
) => ({
  id,
  name,
  rank,
  applyUrl: `https://${id}.example/apply`,
  logoUrl: `/logo/${id}`,
  maxFinalPpwCents,
  finalPpwMode,
});

const loanProgramme = (
  o: Partial<CatalogueProgramme> & { id: string; lenderId: string; lenderName: string }
): CatalogueProgramme => ({
  product: "loan",
  name: null,
  aprPct: 4.99,
  termMonths: 300,
  dealerFeePct: 25,
  leaseRateCentsPerKwMonth: null,
  rateMillsPerKwh: null,
  escalatorPct: null,
  termYears: null,
  factorWithPaydownMicros: null,
  factorWithoutPaydownMicros: null,
  paydownPct: null,
  paydownMonths: null,
  rank: 0,
  lender: lender(o.lenderId, o.lenderName, o.lender?.rank ?? 0),
  ...o,
  id: o.id,
});

const base = {
  quoted: {
    product: "loan" as const,
    lenderProductId: "p-quoted",
    grossPpwCents: 350,
    dealerFeePct: 18,
  },
  approvedLenderIds: null,
  design: { systemSizeKwDc: 10 },
  adders: [],
  adderTotalCents: 0,
  onTopAdderTotalCents: 0,
  assumptions: A,
  targetNetPpwCents: null,
};

describe("cash is priced at what the company keeps, not at the financed sticker", () => {
  it("takes the dealer fee back out of the quoted sticker", () => {
    // $3.50/W at an 18% programme leaves the company $2.87/W.
    expect(cashPpwCents({ quoted: base.quoted, targetNetPpwCents: null })).toBe(287);
  });

  it("prefers the company's own target net rate when one is set", () => {
    expect(cashPpwCents({ quoted: base.quoted, targetNetPpwCents: 300 })).toBe(300);
  });

  it("leaves a cash deal's own price alone, because it carries no fee", () => {
    expect(
      cashPpwCents({
        quoted: { product: "cash", grossPpwCents: 287, dealerFeePct: 0 },
        targetNetPpwCents: null,
      })
    ).toBe(287);
  });

  it("offers cash on a financed deal, and does not offer it twice on a cash one", () => {
    expect(proposalAlternatives({ ...base, programmes: [] })[0].key).toBe("cash");
    const onCash = proposalAlternatives({
      ...base,
      quoted: { ...base.quoted, product: "cash", dealerFeePct: 0 },
      programmes: [],
    });
    expect(onCash).toHaveLength(0);
  });
});

describe("only lenders that will actually finance this system are offered", () => {
  const programmes = [
    loanProgramme({ id: "p-a", lenderId: "L1", lenderName: "GoodLeap" }),
    loanProgramme({ id: "p-b", lenderId: "L2", lenderName: "Credit Human" }),
  ];

  it("keeps every lender when no approved-vendor list has been populated", () => {
    const out = proposalAlternatives({ ...base, programmes, approvedLenderIds: null });
    // Equal rank falls to the lender's name, so the order is at least stable
    // rather than whatever the query happened to return.
    expect(out.map((o) => o.lender)).toEqual([null, "Credit Human", "GoodLeap"]);
  });

  it("drops a lender whose AVL does not cover this design's equipment", () => {
    const out = proposalAlternatives({ ...base, programmes, approvedLenderIds: ["L2"] });
    expect(out.map((o) => o.lender)).toEqual([null, "Credit Human"]);
  });

  it("drops every lender when the design's equipment is on nobody's list", () => {
    const out = proposalAlternatives({ ...base, programmes, approvedLenderIds: [] });
    expect(out.map((o) => o.key)).toEqual(["cash"]);
  });
});

describe("the menu stays a choice rather than a spreadsheet", () => {
  const many = Array.from({ length: 12 }, (_, i) =>
    loanProgramme({ id: `p-${i}`, lenderId: `L${i}`, lenderName: `Lender ${i}`, lender: lender(`L${i}`, `Lender ${i}`, i) })
  );

  it("never returns more than the cap leaves room for", () => {
    const out = proposalAlternatives({ ...base, programmes: many });
    // One slot is already the quoted option.
    expect(out).toHaveLength(MAX_PAYMENT_OPTIONS - 1);
  });

  it("offers at most one programme per lender", () => {
    const sameLender = [
      loanProgramme({ id: "p-1", lenderId: "L1", lenderName: "GoodLeap", rank: 0 }),
      loanProgramme({ id: "p-2", lenderId: "L1", lenderName: "GoodLeap", rank: 1, aprPct: 3.99 }),
      loanProgramme({ id: "p-3", lenderId: "L2", lenderName: "Sunergy" }),
    ];
    const out = proposalAlternatives({ ...base, programmes: sameLender });
    expect(out.map((o) => o.lender)).toEqual([null, "GoodLeap", "Sunergy"]);
    // The rate sheet's own ranking decides which of GoodLeap's rows leads.
    expect(out[1].key).toBe("loan:p-1");
  });

  it("leads with the lender the company ranked first", () => {
    const out = proposalAlternatives({
      ...base,
      programmes: [
        loanProgramme({ id: "p-9", lenderId: "L9", lenderName: "Last", lender: lender("L9", "Last", 9) }),
        loanProgramme({ id: "p-0", lenderId: "L0", lenderName: "First", lender: lender("L0", "First", 0) }),
      ],
    });
    expect(out.map((o) => o.lender)).toEqual([null, "First", "Last"]);
  });

  it("never re-offers the catalogue row the deal was quoted from", () => {
    const out = proposalAlternatives({
      ...base,
      programmes: [loanProgramme({ id: "p-quoted", lenderId: "L1", lenderName: "GoodLeap" })],
    });
    expect(out.map((o) => o.key)).toEqual(["cash"]);
  });
});

describe("an alternative carries the programme's terms and nothing borrowed", () => {
  it("takes the APR, term and fee from the rate sheet", () => {
    const out = proposalAlternatives({
      ...base,
      programmes: [loanProgramme({ id: "p-a", lenderId: "L1", lenderName: "GoodLeap" })],
    });
    const alt = out.find((o) => o.key === "loan:p-a")!;
    expect(alt.finance.aprPct).toBe(4.99);
    expect(alt.finance.loanTermMonths).toBe(300);
    expect(alt.finance.dealerFeePct).toBe(25);
    expect(alt.lenderApplyUrl).toBe("https://L1.example/apply");
  });

  it("never carries the deal's approved payment or down payment onto another lender", () => {
    const out = proposalAlternatives({
      ...base,
      programmes: [loanProgramme({ id: "p-a", lenderId: "L1", lenderName: "GoodLeap" })],
    });
    const alt = out.find((o) => o.key === "loan:p-a")!;
    expect(alt.finance.loanMonthlyPaymentCents).toBeNull();
    expect(alt.finance.downPaymentCents).toBeNull();
  });

  it("carries the extra work onto every option, so no option looks cheaper by omission", () => {
    const adders = [{ label: "Re-roof", amountCents: 1_450_000 }];
    const out = proposalAlternatives({
      ...base,
      adders,
      adderTotalCents: 1_450_000,
      programmes: [loanProgramme({ id: "p-a", lenderId: "L1", lenderName: "GoodLeap" })],
    });
    for (const o of out) {
      expect(o.finance.adderTotalCents).toBe(1_450_000);
      expect(o.finance.adders).toEqual(adders);
    }
  });

  it("carries a lease's rate block and no APR", () => {
    const out = proposalAlternatives({
      ...base,
      programmes: [
        loanProgramme({
          id: "p-l",
          lenderId: "L3",
          lenderName: "EverBright",
          product: "lease",
          aprPct: null,
          termMonths: null,
          dealerFeePct: null,
          leaseRateCentsPerKwMonth: 1_850,
          escalatorPct: 2.9,
          termYears: 25,
        }),
      ],
    });
    const alt = out.find((o) => o.key === "lease:p-l")!;
    expect(alt.finance.aprPct).toBeNull();
    expect(alt.finance.escalatorPct).toBe(2.9);
    expect(alt.finance.termYears).toBe(25);
    // $18.50 per kW-month × 10 kW.
    expect(alt.finance.monthlyPaymentCents).toBe(18_500);
  });
});

describe("a capped lender is capped on the customer's own menu too", () => {
  /**
   * The menu is PRICED at generation and frozen into the snapshot — a customer's
   * copy reads a price, it never derives one. So a cap missing from this path
   * would not be a screen showing the wrong number for a moment; it would be a
   * document quoting a household a figure the lender does not fund, sent, and
   * outliving anybody's chance to correct it.
   */
  const amos = loanProgramme({
    id: "p-amos",
    lenderId: "L-amos",
    lenderName: "Amos Capital Fund",
    dealerFeePct: 65,
    termMonths: 360,
    lender: lender("L-amos", "Amos Capital Fund", 0, 550),
  });

  it("prices the alternative at the cap, not at the grossed-up base", () => {
    const [, option] = proposalAlternatives({
      ...base,
      design: { systemSizeKwDc: 8.8 },
      targetNetPpwCents: 568,
      programmes: [amos],
    });
    expect(option.lender).toBe("Amos Capital Fund");
    expect(option.finance.grossPpwCents).toBe(550);
  });

  it("leaves the same programme alone when its lender sets no cap", () => {
    const [, option] = proposalAlternatives({
      ...base,
      design: { systemSizeKwDc: 8.8 },
      targetNetPpwCents: 568,
      programmes: [{ ...amos, lender: lender("L-amos", "Amos Capital Fund", 0, null) }],
    });
    // 568 / (1 − 0.65) = 1623¢ — the uncapped sticker.
    expect(option.finance.grossPpwCents).toBe(1623);
  });

  it("does not let a capped lender drag down the cash option", () => {
    // Cash is priced at what the company must keep, with no lender in the
    // picture — so no partner's ceiling applies to it.
    const [cash] = proposalAlternatives({
      ...base,
      design: { systemSizeKwDc: 8.8 },
      targetNetPpwCents: 568,
      programmes: [amos],
    });
    expect(cash.key).toBe("cash");
    expect(cash.finance.grossPpwCents).toBe(568);
  });
});
