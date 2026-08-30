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
  minPpwCents: 150,
  maxPpwCents: 800,
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
  // "System price" on the cost chapter — the array before the contribution is
  // added to it, printed directly above the contribution row and the total. It
  // is allowed here precisely BECAUSE those two rows follow it: the three read
  // as arithmetic and land on the contract. See the sum asserted below.
  "financing.basePriceCents",
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
    // The rows a household reads down the cost chapter. Without the middle one
    // the page would print $48,400 above a $118,400 total and invite exactly
    // the question nobody on the page can answer.
    expect(
      (f.basePriceCents ?? 0) +
        (f.adderTotalCents ?? 0) +
        snapshot.financing.lenderAdjustment!.adjustmentCents
    ).toBe(f.contractPriceCents);
  });

  it("steps the payment down rather than pocketing the credits", () => {
    // A LOAN does not receive $70,000 in year one — it puts it against the
    // principal and re-amortises. Modelling it as a lump would land the whole
    // relief inside a 25-year window that only holds 300 of the loan's 360
    // payments, and flatter the savings chapter by roughly $11,000.
    const s = snapshot.savings;
    expect(s.creditReliefTotalCents).toBe(0);

    const f = snapshot.financing;
    expect(f.loanMonthlyPaymentCents).toBe(32_889);
    expect(f.netMonthlyPaymentCents).toBe(13_444);

    // Year one carries twelve of the higher payment; year two, twelve of the
    // lower. That step IS the credits being applied.
    expect(s.years[0].solarPaymentCents).toBe(32_889 * 12);
    expect(s.years[1].solarPaymentCents).toBe(13_444 * 12);
  });

  it("prices the twenty-five years close to the deal priced the old way", () => {
    // The reversal moved which figure the document leads with. It must NOT have
    // moved what the household actually pays over the horizon — that is the
    // same deal — beyond the one real difference: a year of the larger payment
    // before the credits land.
    const s = snapshot.savings;
    const oldWay = 13_444 * 12 * 25;
    const extraYearAtTheHigherPayment = (32_889 - 13_444) * 12;
    expect(s.solarPaidCents).toBe(oldWay + extraYearAtTheHigherPayment);
  });
});
