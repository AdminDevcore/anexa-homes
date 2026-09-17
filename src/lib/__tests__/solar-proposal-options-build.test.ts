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
    lenderId: "L-quoted",
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

  it("prices cash at the deal's own base even when the company has a target net", () => {
    // L15: the target net used to win here, pricing cash at $3.00/W whatever
    // the rep sold.
    expect(cashPpwCents({ quoted: base.quoted, targetNetPpwCents: 300 })).toBe(287);
  });

  it("falls back to the target net only when the quote has no per-watt price", () => {
    // A lease or PPA quote stores no sticker.
    expect(
      cashPpwCents({ quoted: { product: "lease", grossPpwCents: 0, dealerFeePct: 0 }, targetNetPpwCents: 300 })
    ).toBe(300);
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

  it("never offers a SECOND programme from the partner the deal is already quoted by", () => {
    // A company running one partner with two rows — a solar loan and a battery
    // loan. The quoted row is skipped by id; the sibling used to walk straight
    // past the one-per-lender rule and print as a second offer from Amos.
    const out = proposalAlternatives({
      ...base,
      quoted: { ...base.quoted, lenderProductId: "p-solar", lenderId: "L-amos" },
      programmes: [
        loanProgramme({ id: "p-solar", lenderId: "L-amos", lenderName: "Amos Capital Fund" }),
        loanProgramme({ id: "p-batt", lenderId: "L-amos", lenderName: "Amos Capital Fund", rank: 1 }),
        loanProgramme({ id: "p-other", lenderId: "L2", lenderName: "Sunergy" }),
      ],
    });
    expect(out.map((o) => o.key)).toEqual(["cash", "loan:p-other"]);
  });

  it("still offers a lender's loan under a CASH quote, which names no partner", () => {
    const out = proposalAlternatives({
      ...base,
      quoted: { product: "cash", lenderProductId: null, lenderId: null, grossPpwCents: 287, dealerFeePct: 0 },
      programmes: [loanProgramme({ id: "p-a", lenderId: "L1", lenderName: "GoodLeap" })],
    });
    expect(out.map((o) => o.key)).toEqual(["loan:p-a"]);
  });
});

describe("the menu is what the rep ticked on the Financing step", () => {
  const programmes = [
    loanProgramme({ id: "p-a", lenderId: "L1", lenderName: "GoodLeap" }),
    loanProgramme({ id: "p-b", lenderId: "L2", lenderName: "Sunergy" }),
  ];

  it("offers nothing beside the quote when nothing else was ticked", () => {
    expect(proposalAlternatives({ ...base, programmes, shortlistIds: [] })).toEqual([]);
  });

  it("offers only the programmes that were ticked", () => {
    const out = proposalAlternatives({ ...base, programmes, shortlistIds: ["p-b"] });
    expect(out.map((o) => o.key)).toEqual(["loan:p-b"]);
  });

  it("offers cash only when the cash card was ticked", () => {
    const out = proposalAlternatives({ ...base, programmes, shortlistIds: ["cash", "p-a"] });
    expect(out.map((o) => o.key)).toEqual(["cash", "loan:p-a"]);
  });

  it("does not repeat the quoted programme when its own card is ticked", () => {
    const out = proposalAlternatives({
      ...base,
      programmes: [...programmes, loanProgramme({ id: "p-quoted", lenderId: "L-quoted", lenderName: "Axess" })],
      shortlistIds: ["p-quoted", "p-a"],
    });
    expect(out.map((o) => o.key)).toEqual(["loan:p-a"]);
  });

  it("offers two ticked programmes from one lender, and a ticked sibling of the quote", () => {
    // One-per-lender keeps an automatic menu broad. A rep who ticked both of a
    // partner's terms asked for both.
    const out = proposalAlternatives({
      ...base,
      quoted: { ...base.quoted, lenderProductId: "p-30", lenderId: "L-amos" },
      programmes: [
        loanProgramme({ id: "p-30", lenderId: "L-amos", lenderName: "Amos" }),
        loanProgramme({ id: "p-25", lenderId: "L-amos", lenderName: "Amos", rank: 1 }),
        loanProgramme({ id: "p-20", lenderId: "L-amos", lenderName: "Amos", rank: 2 }),
      ],
      shortlistIds: ["p-30", "p-25", "p-20"],
    });
    expect(out.map((o) => o.key)).toEqual(["loan:p-25", "loan:p-20"]);
  });

  it("still holds a ticked programme to the approved-vendor list", () => {
    const out = proposalAlternatives({
      ...base,
      programmes,
      approvedLenderIds: ["L2"],
      shortlistIds: ["p-a", "p-b"],
    });
    expect(out.map((o) => o.key)).toEqual(["loan:p-b"]);
  });

  it("still stops at the cap when more cards were ticked than it allows", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      loanProgramme({ id: `p-${i}`, lenderId: `L${i}`, lenderName: `Lender ${i}`, lender: lender(`L${i}`, `Lender ${i}`, i) })
    );
    const out = proposalAlternatives({
      ...base,
      programmes: many,
      shortlistIds: ["cash", ...many.map((p) => p.id)],
    });
    expect(out).toHaveLength(MAX_PAYMENT_OPTIONS - 1);
  });
});

describe("the storage line is drawn in both directions", () => {
  it("keeps battery-only paper off a deal that has an array on it", () => {
    const out = proposalAlternatives({
      ...base,
      programmes: [
        loanProgramme({
          id: "p-batt",
          lenderId: "L1",
          lenderName: "Amos Capital Fund",
          financesStorageOnly: true,
        }),
        loanProgramme({ id: "p-solar", lenderId: "L2", lenderName: "Sunergy" }),
      ],
    });
    expect(out.map((o) => o.key)).toEqual(["cash", "loan:p-solar"]);
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
    // The deal's base, not the target net: $3.50/W at 18% keeps 287¢, and
    // 287 / (1 − 0.65) = 820¢ — the uncapped sticker.
    expect(option.finance.grossPpwCents).toBe(820);
  });

  it("does not let a capped lender drag down the cash option", () => {
    // Cash is priced at the deal's base, with no lender in the picture — so no
    // partner's ceiling applies to it.
    const [cash] = proposalAlternatives({
      ...base,
      design: { systemSizeKwDc: 8.8 },
      targetNetPpwCents: 568,
      programmes: [amos],
    });
    expect(cash.key).toBe("cash");
    expect(cash.finance.grossPpwCents).toBe(287);
  });
});

describe("every option is priced from the base this deal was sold at (L15)", () => {
  const other = loanProgramme({ id: "p-other", lenderId: "L2", lenderName: "Sunergy", dealerFeePct: 30 });

  it("re-grosses the deal's base by each programme's own fee, ignoring the target net", () => {
    // Sold at $4.00/W through 20%: the company keeps 320¢. At Sunergy's 30%
    // that base stickers at 320 / 0.7 = 457¢ — not the $2.50 target net
    // grossed up (357¢), which is what every other lender used to be quoted at.
    const [cash, option] = proposalAlternatives({
      ...base,
      quoted: { ...base.quoted, grossPpwCents: 400, dealerFeePct: 20 },
      targetNetPpwCents: 250,
      programmes: [other],
    });
    expect(cash.finance.grossPpwCents).toBe(320);
    expect(option.finance.grossPpwCents).toBe(457);
    expect(option.finance.dealerFeePct).toBe(30);
  });

  it("keeps the old derivation for a quote with no per-watt price", () => {
    // A lease stores no sticker, so there is no base to start from.
    const [cash, option] = proposalAlternatives({
      ...base,
      quoted: { product: "lease", lenderProductId: null, lenderId: null, grossPpwCents: 0, dealerFeePct: 0 },
      targetNetPpwCents: 250,
      programmes: [other],
    });
    expect(cash.finance.grossPpwCents).toBe(250);
    expect(option.finance.grossPpwCents).toBe(357);
  });
});
