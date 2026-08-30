import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { buildProposalSnapshot } from "@/lib/solar-proposal";
import { DISCLOSURE_TEMPLATE_SUGGESTION } from "@/lib/solar-contract-adjustment";
import type { SolarAssumptions } from "@/lib/solar-money";

/**
 * WHERE THE CONTRACT VALUE IS ALLOWED TO APPEAR — and where the whole concept
 * is allowed to appear at all.
 *
 * Two containment properties, both of which a reviewer would otherwise have to
 * check by reading the codebase:
 *
 *  1. IN A DOCUMENT: the adjusted contract value occurs on the reconciliation
 *     and NOWHERE else. Not as a price, not as a financed amount, not folded
 *     into a saving. A document with $118,400 in two places is one where a
 *     household can read the wrong one.
 *
 *  2. IN THE SOURCE: nothing outside solar imports any of this. Roofing sells
 *     the same way it always has, and the fastest way to be sure of that is to
 *     prove the module is unreachable from it.
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

  it("leaves the roofing proposal with no notion of one", () => {
    // The roofing document, its pricing, and the presentation that renders it.
    for (const path of ["lib/proposal.ts", "lib/estimate.ts", "lib/scope.ts"]) {
      const found = files.find(([p]) => p === path);
      expect(found, `${path} is missing — this test is checking nothing`).toBeTruthy();
      expect(found![1]).not.toMatch(/lenderAdjustment|contractAdjustment/);
    }
  });

  it("leaves the roofing presentation untouched", () => {
    const view = files.find(([p]) => p === "components/proposal/presentation-view.tsx");
    expect(view).toBeTruthy();
    expect(view![1]).not.toMatch(/lenderAdjustment|contractAdjustment|ownershipNote/);
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

describe("the contract value appears once, where it is labelled", () => {
  it("is on the reconciliation and on no other figure in the document", () => {
    const found = pathsHolding(snapshot, 118_400_00);

    expect(found.length).toBeGreaterThan(0);
    for (const path of found) {
      expect(
        path.includes("lenderAdjustment.lenderContractValueCents"),
        `${path} holds the adjusted contract value but is not the reconciliation`
      ).toBe(true);
    }
  });

  it("is written into the prose only inside the disclosure the administrator wrote", () => {
    // Everything except the disclosure strings. If "$118,400" turns up in a
    // sentence the app composed, a homeowner is being told the wrong number in
    // words rather than in a table.
    const stripped = JSON.stringify(snapshot, (key, v) => (key === "disclosure" ? undefined : v));
    expect(stripped).not.toContain("118,400");
  });

  it("keeps the customer's own figure everywhere a payment is worked out", () => {
    const obligations = pathsHolding(snapshot, 48_400_00);
    // The contract price, the financed amount, the option's copy of both, and
    // the reconciliation's own statement of it.
    expect(obligations).toContain("$.financing.contractPriceCents");
    expect(obligations).toContain("$.financing.financedAmountCents");
    expect(obligations).toContain("$.financing.lenderAdjustment.customerObligationCents");
  });
});
