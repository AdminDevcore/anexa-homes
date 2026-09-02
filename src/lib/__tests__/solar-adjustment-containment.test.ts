import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { buildProposalSnapshot } from "@/lib/solar-proposal";
import { DISCLOSURE_TEMPLATE_SUGGESTION } from "@/lib/solar-contract-adjustment";
import type { SolarAssumptions } from "@/lib/solar-money";

/**
 * WHICH FIGURE THE DOCUMENT QUOTES, and where the whole concept is allowed to
 * appear at all.
 *
 * THIS FILE'S FIRST PROPERTY WAS REVERSED ON 2026-08-29, deliberately, and the
 * reversal is the point of keeping the file rather than deleting it. It used to
 * assert that the adjusted contract value appeared ONLY on the reconciliation
 * and that every payment came off the customer's obligation. That was the right
 * guard for a contribution that reduced what a household owed, and the wrong
 * one for what this programme actually is: the contribution is ADDED to the
 * paper so the federal credits are earned on the larger figure, the household
 * signs for $118,400, and the credits plus a derived incentive bring them back
 * to $48,400. Quoting them $48,400 from page one described a loan nobody wrote.
 *
 * So the containment property now runs the other way, and it is the one that
 * matters under the new arrangement:
 *
 *  1. IN A DOCUMENT: every figure a payment is worked out from is the CONTRACT
 *     value, and the household's quoted price appears only where it is
 *     labelled as what they end up paying — the ladder's bottom line and the
 *     reconciliation. A document with $48,400 sitting in an unlabelled price
 *     field is one where a household can read the wrong one, which is the same
 *     failure as before with the two numbers swapped.
 *
 *  2. IN THE SOURCE: nothing outside solar imports any of this. Roofing sells
 *     the same way it always has, and the fastest way to be sure of that is to
 *     prove the module is unreachable from it. UNCHANGED.
 */

const SRC = join(process.cwd(), "src");

/** Every .ts/.tsx file under src, as [relative path, contents]. */
function sourceFiles(): [string, string][] {
  const out: [string, string][] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry)) continue;
      out.push([full.slice(SRC.length + 1), readFileSync(full, "utf8")]);
    }
  };
  walk(SRC);
  return out;
}

describe("nothing outside solar can reach the contract adjustment", () => {
  const files = sourceFiles();

  it("is imported only by solar code", () => {
    const importers = files
      .filter(([, body]) => body.includes("solar-contract-adjustment"))
      .map(([path]) => path)
      // The module itself, and its own tests.
      .filter((p) => !p.includes("solar-contract-adjustment"));

    // Something has to import it, or this test is asserting nothing.
    expect(importers.length).toBeGreaterThan(0);

    for (const path of importers) {
      expect(
        /solar/i.test(path),
        `${path} imports the contract adjustment but is not solar code`
      ).toBe(true);
    }
  });

  it("keeps the credit ladder inside solar too", () => {
    const importers = files
      .filter(([, body]) => body.includes("solar-credit-ladder"))
      .map(([path]) => path)
      .filter((p) => !p.includes("solar-credit-ladder"));

    expect(importers.length).toBeGreaterThan(0);
    for (const path of importers) {
      expect(
        /solar/i.test(path),
        `${path} imports the credit ladder but is not solar code`
      ).toBe(true);
    }
  });

  it("leaves the roofing proposal with no notion of one", () => {
    // The roofing document, its pricing, and the presentation that renders it.
    for (const path of ["lib/proposal.ts", "lib/estimate.ts", "lib/scope.ts"]) {
      const found = files.find(([p]) => p === path);
      expect(found, `${path} is missing — this test is checking nothing`).toBeTruthy();
      expect(found![1]).not.toMatch(/lenderAdjustment|contractAdjustment|creditLadder/);
    }
  });

  it("leaves the roofing presentation untouched", () => {
    const view = files.find(([p]) => p === "components/proposal/presentation-view.tsx");
    expect(view).toBeTruthy();
    expect(view![1]).not.toMatch(/lenderAdjustment|contractAdjustment|ownershipNote|creditLadder/);
  });
});

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

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
};

const snapshot = buildProposalSnapshot({
  reference: "SP-CONTAIN-V1",
  generatedById: "user-1",
  customer: { name: "Priya Raman", address: "902 Solaris Way, Dallas TX" },
  company: { name: "Anexa Homes", phone: null, email: null, logoUrl: null },
  design: {
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
  },
  finance: {
    product: "loan",
    grossPpwCents: 550,
    dealerFeePct: 65,
    adderTotalCents: 0,
    rateMillsPerKwh: null,
    monthlyPaymentCents: null,
    escalatorPct: null,
    termYears: null,
    aprPct: 0,
    loanTermMonths: 360,
  },
  lender: "Participate",
  contractAdjustment: {
    enabled: true,
    fixedCents: 70_000_00,
    label: "Participate Program Contribution",
    disclosure: DISCLOSURE_TEMPLATE_SUGGESTION,
  },
  assumptions: A,
  now: new Date("2026-08-29T00:00:00Z"),
});

/** Every path in the snapshot whose value is exactly `target`. */
function pathsHolding(value: unknown, target: number, at = "$"): string[] {
  if (typeof value === "number") return value === target ? [at] : [];
  if (Array.isArray(value)) return value.flatMap((v, i) => pathsHolding(v, target, `${at}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => pathsHolding(v, target, `${at}.${k}`));
  }
  return [];
}

/** The paths where the household's own $48,400 is allowed to be stated. */
const QUOTED_PRICE_IS_LABELLED = [
  // "What you actually pay", the bottom line of the ladder.
  "creditLadder.netCostCents",
  // The same figure said as the ladder's target, so the incentive can be the
  // difference between them.
  "creditLadder.quotedPriceCents",
  // The reconciliation's own statement of the obligation.
  "lenderAdjustment.customerObligationCents",
  // The array at sticker, before the contribution. NOT PRINTED on the
  // customer's cost chapter since the evening of 2026-08-29 — the renderer
  // derives its "System price" row from the contract instead, so the household
  // reads one price rather than a smaller one with $70,000 added underneath.
  // It stays on the snapshot because the funder's submission summary states
  // it, the rep's screens read it, and a frozen document that dropped it could
  // never explain itself later. The row-level guard is below.
  "financing.basePriceCents",
  // THE CREDITS-APPLIED SCENARIO'S OWN TOTAL, and its own principal — the price
  // sheet and the terms list read these when the switch is on, which is the
  // only state in which the household's own price is what they owe. Both are
  // labelled as exactly that on the page: "Total price" and "Amount financed"
  // under a document that says, in its nav bar, that the credits are applied.
  "creditsApplied.totalCents",
  "creditsApplied.financedAmountCents",
];

describe("the document quotes the contract the household signs", () => {
  it("works every payment out from the contract value, not the quoted price", () => {
    const found = pathsHolding(snapshot, 118_400_00);
    expect(found).toContain("$.financing.contractPriceCents");
    expect(found).toContain("$.financing.financedAmountCents");
    expect(found).toContain("$.financing.lenderAdjustment.lenderContractValueCents");
    expect(found).toContain("$.financing.creditLadder.contractValueCents");
  });

  it("states the household's own price only where it is labelled as what they pay", () => {
    const found = pathsHolding(snapshot, 48_400_00);

    // Something has to hold it, or this test is asserting nothing.
    expect(found.length).toBeGreaterThan(0);
    for (const path of found) {
      expect(
        QUOTED_PRICE_IS_LABELLED.some((allowed) => path.includes(allowed)),
        `${path} holds the customer's quoted price but is not a field that says so`
      ).toBe(true);
    }
  });

  it("writes no figure of its own into the prose", () => {
    // Everything except the wording an administrator supplied. If a figure
    // turns up in a sentence the APP composed, a homeowner is being told a
    // number in words that no table on the page can be checked against.
    const stripped = JSON.stringify(snapshot, (key, v) =>
      key === "disclosure" ? undefined : v
    );
    expect(stripped).not.toContain("118,400");
    expect(stripped).not.toContain("48,400");
  });

  it("hands back exactly the contribution, so the ladder lands on the quoted price", () => {
    const ladder = snapshot.financing.creditLadder!;
    expect(ladder.contractValueCents).toBe(118_400_00);
    // 50% of the contract — $59,200 — is more than the system was sold for, so
    // the incentive is the remainder and the bottom line is the quoted price.
    expect(ladder.creditTotalCents).toBe(59_200_00);
    expect(ladder.incentiveCents).toBe(10_800_00);
    expect(ladder.netCostCents).toBe(48_400_00);
    expect(ladder.reliefCents).toBe(70_000_00);
    expect(ladder.reliefCents).toBe(
      snapshot.financing.lenderAdjustment!.adjustmentCents
    );
  });

  it("adds up: system price, plus the contribution, is the printed total", () => {
    const f = snapshot.financing;
    // A property of the DATA, not of the page — the cost chapter has printed
    // one price since 2026-08-29 and no longer shows this sum. It is asserted
    // because the renderer's "System price" is `contract − adders`, and that is
    // only the array-plus-contribution if these three still reconcile. The day
    // they stop, a household reads a system price that is quietly the wrong
    // number rather than a page that visibly does not add up.
    expect(
      (f.basePriceCents ?? 0) +
        (f.adderTotalCents ?? 0) +
        snapshot.financing.lenderAdjustment!.adjustmentCents
    ).toBe(f.contractPriceCents);
  });

  it("prints neither the contribution nor the obligation on the customer's page", () => {
    /*
     * THE ROW THAT CAME OFF, asserted so it cannot go back on by accident.
     *
     * The cost chapter used to run "System price $48,400 / Participate Program
     * Contribution +$70,000 / Total contract price $118,400", and beneath it a
     * three-row box that took the same $70,000 off again. Both were arithmetic
     * a reader could check and both invited the only intuitive reading of them:
     * that $70,000 was added to the price of a system. It is not a charge — it
     * is on the paper so the credits are earned on the larger figure, and the
     * ladder chapter hands it straight back. So the document quotes the
     * contract whole and explains it once, where the credits are.
     *
     * Checked against the SOURCE rather than a render, because the failure is a
     * row reappearing rather than a figure coming out wrong, and a row is
     * visible in the file. The submission summary is deliberately not in scope:
     * that page is for the funder, who needs all three figures.
     */
    /*
     * THE WHOLE CUSTOMER-FACING DOCUMENT, not one file. It was index.tsx alone
     * until the 2026-08-30 rebuild split the chapters out; reading only the
     * view after that would have checked the one file the rows are no longer
     * in, and passed by finding nothing.
     */
    const solarDir = join(SRC, "components", "proposal", "solar");
    const doc = [
      readFileSync(join(solarDir, "index.tsx"), "utf8"),
      ...readdirSync(join(solarDir, "chapters"))
        .filter((f) => /\.tsx?$/.test(f))
        .map((f) => readFileSync(join(solarDir, "chapters", f), "utf8")),
    ].join("\n");
    expect(doc).not.toContain("adjustment.adjustmentCents");
    expect(doc).not.toContain("adjustment.customerObligationCents");
    // The contract value it IS allowed to state: the sentence saying which
    // figure the payment came off. Present, so this test fails loudly if the
    // whole block is ever deleted rather than silently passing on nothing.
    expect(doc).toContain("adjustment.lenderContractValueCents");
  });

  it("lowers the payment rather than pocketing the credits in year one", () => {
    // A LOAN does not receive $70,000 in year one — it puts it against the
    // principal and re-amortises. Modelling it as a lump would land the whole
    // relief inside a 25-year window that only holds 300 of the loan's 360
    // payments, and flatter the savings chapter by roughly $11,000.
    const applied = snapshot.options![0].creditsApplied!;
    expect(applied.savings.creditReliefTotalCents).toBe(0);

    const f = snapshot.financing;
    expect(f.loanMonthlyPaymentCents).toBe(32_889);
    expect(f.netMonthlyPaymentCents).toBe(13_444);

    // The relief is inside the payment, every year of it.
    expect(applied.savings.years[0].solarPaymentCents).toBe(13_444 * 12);
    expect(applied.savings.years[1].solarPaymentCents).toBe(13_444 * 12);
  });

  it("bills the FULL payment for the whole term with the credits unclaimed", () => {
    /*
     * THE 2026-08-30 FIX, and the reason the switch was worth having at all.
     *
     * This model used to carry twelve of the higher payment and then the lower
     * one for the remaining 348 — a household that DID claim the credits and
     * merely claimed them late. So "credits off" and "credits on" differed by
     * one year's extra payment on a deal where the credits are worth half the
     * contract, and the two sides of the switch were 4% apart.
     *
     * Off now means what it says: nobody claimed anything, the loan asks for
     * its full payment for all 360 months, and no relief lands in any year.
     */
    const s = snapshot.savings;
    expect(s.creditReliefTotalCents).toBe(0);
    expect(s.years[0].solarPaymentCents).toBe(32_889 * 12);
    expect(s.years[1].solarPaymentCents).toBe(32_889 * 12);
    expect(s.years[29].solarPaymentCents).toBe(32_889 * 12);
  });

  it("runs the years out to the end of the loan, and bills every payment once", () => {
    // The horizon FOLLOWS THE TERM as of 2026-08-29. This programme is 360
    // months, so the chapter is thirty years and the solar column carries all
    // 360 payments.
    //
    // It ran to twenty-five before, which billed 300 of the 360 and called the
    // remaining five years' payments saved. The number below is larger than the
    // old one BY DESIGN: those payments were always real, the page just stopped
    // before them.
    //
    // Checked on BOTH scenarios: the switch changes what a payment is, never
    // how many there are, and a model that lost sixty of them on one side of it
    // would quote a household a term nobody wrote.
    for (const s of [snapshot.savings, snapshot.options![0].creditsApplied!.savings]) {
      expect(s.years.length).toBe(30);
      // Nothing double-billed and nothing dropped: 360 months, exactly.
      expect(s.years.reduce((n, y) => n + y.solarPaymentCents, 0)).toBe(s.solarPaidCents);
      expect(s.years[29].solarPaymentCents).toBeGreaterThan(0);
    }
    // Two complete readings of one deal, 360 payments each — the contract in
    // full on one side, what the credits leave on the other. The gap between
    // them is the whole of the credits, which is what makes the switch a
    // choice rather than a rounding difference.
    expect(snapshot.savings.solarPaidCents).toBe(32_889 * 360);
    expect(snapshot.options![0].creditsApplied!.savings.solarPaidCents).toBe(13_444 * 360);
  });
});
