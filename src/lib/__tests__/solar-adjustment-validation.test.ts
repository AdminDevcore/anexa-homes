import { describe, it, expect } from "vitest";
import { validateFinance, canGenerate, type FinanceForValidation } from "@/lib/solar-validation";
import { DISCLOSURE_TEMPLATE_SUGGESTION } from "@/lib/solar-contract-adjustment";
import { SOLAR_ASSUMPTION_DEFAULTS } from "@/server/modules/solar/settings";
import { roleCan } from "@/server/rbac/matrix";

/**
 * What stops a proposal being generated with a contract adjustment nobody has
 * finished configuring — and who is allowed to configure one.
 *
 * The failure being guarded is not an exception. A programme switched on with
 * no amount, no label or no disclosure behind it generates a perfectly ordinary
 * document that simply LEAVES OUT the reconciliation a household is entitled to
 * see. Nobody gets an error; the paper is just quietly wrong.
 */

/** The Participate shape: $5.50/W flat on a 65% fee, 0% over 360 months. */
const finance = (over: Partial<FinanceForValidation> = {}): FinanceForValidation => ({
  product: "loan",
  grossPpwCents: 550,
  dealerFeePct: 65,
  contractPriceCents: 48_400_00,
  rateMillsPerKwh: null,
  monthlyPaymentCents: null,
  escalatorPct: null,
  termYears: null,
  downPaymentCents: null,
  loanMonthlyPaymentCents: null,
  aprPct: 0,
  loanTermMonths: 360,
  maxFinalPpwCents: 550,
  finalPpwMode: "flat",
  fromRateSheet: true,
  hasPaymentFactor: false,
  ...over,
});

const COMPLETE = {
  enabled: true,
  fixedCents: 70_000_00,
  label: "Participate Program Contribution",
  disclosure: DISCLOSURE_TEMPLATE_SUGGESTION,
};

const codes = (f: FinanceForValidation) =>
  validateFinance(f, SOLAR_ASSUMPTION_DEFAULTS, "lead-1").map((i) => i.code);

const issue = (f: FinanceForValidation, code: string) =>
  validateFinance(f, SOLAR_ASSUMPTION_DEFAULTS, "lead-1").find((i) => i.code === code);

describe("a half-configured programme blocks generation", () => {
  it("refuses when the amount is missing", () => {
    const f = finance({ contractAdjustment: { ...COMPLETE, fixedCents: null } });
    const found = issue(f, "pricing.adjustment_incomplete");
    expect(found?.severity).toBe("block");
    expect(found?.message).toContain("no adjustment amount is set");
    expect(canGenerate(validateFinance(f, SOLAR_ASSUMPTION_DEFAULTS))).toBe(false);
  });

  it("refuses when the customer-facing label is missing", () => {
    expect(
      issue(finance({ contractAdjustment: { ...COMPLETE, label: null } }), "pricing.adjustment_incomplete")
        ?.message
    ).toContain("no customer-facing label is set");
  });

  it("refuses when the disclosure is missing", () => {
    expect(
      issue(
        finance({ contractAdjustment: { ...COMPLETE, disclosure: "   " } }),
        "pricing.adjustment_incomplete"
      )?.message
    ).toContain("no customer disclosure is written");
  });

  it("names every missing part at once rather than one per attempt", () => {
    const found = issue(
      finance({ contractAdjustment: { enabled: true, fixedCents: null, label: null, disclosure: null } }),
      "pricing.adjustment_incomplete"
    );
    expect(found?.message).toContain("no adjustment amount is set");
    expect(found?.message).toContain("no customer-facing label is set");
    expect(found?.message).toContain("no customer disclosure is written");
  });

  it("sends the fix to lender settings, not to the deal", () => {
    // The figure is a term of the partner's programme. A "take me there" link
    // pointing at the financing step would send a rep to a screen with no
    // control on it.
    expect(
      issue(finance({ contractAdjustment: { ...COMPLETE, fixedCents: null } }), "pricing.adjustment_incomplete")
        ?.action?.href
    ).toBe("/portal/settings/solar-lenders");
  });
});

describe("a complete programme raises nothing", () => {
  it("lets a properly configured partner through", () => {
    expect(codes(finance({ contractAdjustment: COMPLETE }))).not.toContain(
      "pricing.adjustment_incomplete"
    );
  });

  it("says nothing at all about a partner that runs no programme", () => {
    for (const contractAdjustment of [undefined, null, { enabled: false, fixedCents: null, label: null, disclosure: null }]) {
      const found = codes(finance({ contractAdjustment })).filter((c) => c.startsWith("pricing.adjustment"));
      expect(found).toEqual([]);
    }
  });

  it("warns rather than blocks when the deal is quoted on a product the programme cannot reach", () => {
    // Only a loan has a lender advancing a contract for a contribution to come
    // off. A rep who switched product should be told the reconciliation has
    // gone, not stopped.
    const found = issue(
      finance({ product: "cash", dealerFeePct: 0, contractAdjustment: COMPLETE }),
      "pricing.adjustment_not_applied"
    );
    expect(found?.severity).toBe("warn");
    expect(found?.message).toContain("Participate Program Contribution");
  });

  it("does not warn about a programme that has not started yet", () => {
    expect(
      codes(
        finance({
          product: "cash",
          dealerFeePct: 0,
          contractAdjustment: { ...COMPLETE, effectiveAt: "2099-01-01" },
        })
      )
    ).not.toContain("pricing.adjustment_not_applied");
  });
});

describe("the customer's price still has to be there", () => {
  it("blocks a deal with no contract price, adjustment or not", () => {
    expect(codes(finance({ contractPriceCents: 0, contractAdjustment: COMPLETE }))).toContain(
      "pricing.contract_price_zero"
    );
  });

  it("blocks a price per watt outside the company's band", () => {
    // Measured on an ordinary partner. Under a FLAT one the band reads the
    // published rate instead — the base a rep types there is a residual, not a
    // price — which is `bandPpwCents`'s own rule and predates this feature.
    expect(
      codes(
        finance({
          grossPpwCents: 0,
          maxFinalPpwCents: null,
          finalPpwMode: null,
          contractAdjustment: COMPLETE,
        })
      )
    ).toContain("pricing.ppw_out_of_range");
  });
});

describe("who may change the adjustment", () => {
  // The figure lives on the lender, and lenders live in Settings. There is no
  // second permission for it, deliberately: a resource with its own bespoke
  // check is a resource whose access rules have to be remembered separately.
  it("is configurable by a super admin", () => {
    expect(roleCan("super_admin", "update", "Settings")).toBe(true);
  });

  it("is configurable by an admin, where the permission system allows it", () => {
    expect(roleCan("admin", "update", "Settings")).toBe(true);
  });

  it("is NOT configurable by a sales representative", () => {
    expect(roleCan("sales_rep", "update", "Settings")).toBe(false);
    // Nor may they open the screen it lives on.
    expect(roleCan("sales_rep", "read", "Settings")).toBe(false);
  });

  it("leaves a sales representative able to build and read proposals", () => {
    // They see the figures the adjustment produces on the deal, and on the
    // customer's document. What they cannot do is move the term behind them.
    expect(roleCan("sales_rep", "create", "Proposal")).toBe(true);
    expect(roleCan("sales_rep", "read", "Proposal")).toBe(true);
  });

  it("is out of reach of a manager and a canvasser too", () => {
    expect(roleCan("manager", "update", "Settings")).toBe(false);
    expect(roleCan("canvasser", "update", "Settings")).toBe(false);
  });
});
