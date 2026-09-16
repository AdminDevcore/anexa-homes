import { describe, expect, it } from "vitest";
import { resolveDealerFee } from "@/lib/solar-dealer-fee";

/**
 * The one fee rule (§8.25, D8).
 *
 * The case that matters most is the production one: Amos 30 Year Solar
 * publishes 0% while all five of its deals cache 65%. A resolver written with
 * `||` returns 65 there — a rate the partner does not charge — and every
 * assertion about "the programme wins" passes anyway, because every other
 * fixture uses a non-zero programme fee. So the zero is tested first.
 */

const LOAN = { product: "loan" as const };

describe("precedence: programme, then the deal's copy, then the company default", () => {
  it("takes the programme's fee over the copy cached on the deal", () => {
    const f = resolveDealerFee({ ...LOAN, programmePct: 25, dealPct: 65, companyDefaultPct: 18 });
    expect(f).toEqual({ pct: 25, source: "programme" });
  });

  it("takes a programme's REAL ZERO over a stale 65% on the deal — the Amos case", () => {
    // Production, 2026-09-16: programme 0%, all five deals cached at 65%.
    const f = resolveDealerFee({ ...LOAN, programmePct: 0, dealPct: 65, companyDefaultPct: 18 });
    expect(f.pct).toBe(0);
    expect(f.source).toBe("programme");
  });

  it("falls to the deal's cached copy when no programme is quoted", () => {
    expect(resolveDealerFee({ ...LOAN, programmePct: null, dealPct: 65, companyDefaultPct: 18 }))
      .toEqual({ pct: 65, source: "deal" });
  });

  it("falls to the company default when the deal has no copy either", () => {
    expect(resolveDealerFee({ ...LOAN, programmePct: null, dealPct: null, companyDefaultPct: 18 }))
      .toEqual({ pct: 18, source: "companyDefault" });
  });

  it("treats a deal's own zero as a real value, not as unset", () => {
    expect(resolveDealerFee({ ...LOAN, dealPct: 0, companyDefaultPct: 18 }))
      .toEqual({ pct: 0, source: "deal" });
  });

  it("says nobody chose it when a loan has no programme, no copy and no default", () => {
    expect(resolveDealerFee({ ...LOAN })).toEqual({ pct: 0, source: "none" });
  });
});

describe("products with no lender have no fee to source", () => {
  it.each(["cash", "lease", "ppa"] as const)("%s takes none of the three", (product) => {
    // Handed a fee from every direction, and still takes none of them: cash has
    // no lender, and a lease or PPA sells electricity rather than a system.
    const f = resolveDealerFee({ product, programmePct: 65, dealPct: 50, companyDefaultPct: 18 });
    expect(f).toEqual({ pct: 0, source: "none" });
  });
});

describe("the rule agrees with the precedence financeRowForProduct already used", () => {
  it("reproduces `lp?.dealerFeePct ?? f.dealerFeePct ?? assumptions.defaultDealerFeePct`", () => {
    // Stage 4 moved this precedence out of solar-finance-row.ts unchanged. If
    // the two ever diverge, a deal prices one way and is judged another.
    const cases: [number | null, number | null, number, number][] = [
      [25, 65, 18, 25],
      [0, 65, 18, 0],
      [null, 65, 18, 65],
      [null, 0, 18, 0],
      [null, null, 18, 18],
    ];
    for (const [programmePct, dealPct, companyDefaultPct, expected] of cases) {
      const legacy = programmePct ?? dealPct ?? companyDefaultPct;
      expect(legacy).toBe(expected);
      expect(resolveDealerFee({ ...LOAN, programmePct, dealPct, companyDefaultPct }).pct).toBe(expected);
    }
  });
});
