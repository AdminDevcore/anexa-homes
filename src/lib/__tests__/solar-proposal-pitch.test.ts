import { describe, it, expect } from "vitest";
import { coverPitch, lifetimeFigure, monthlyToday } from "@/lib/solar-proposal-pitch";
import type { ProposalPaymentOption, SavingsModel } from "@/lib/solar-proposal";

/**
 * What the cover is allowed to promise.
 *
 * The rule under test: the cover leads with the strongest statement that is
 * TRUE OF THIS DEAL. A fixed "you pay less every month" template is a lie on a
 * financed deal whose payment lands above the bill it replaces — and those
 * deals exist in production, which is what this module was written for.
 */

const YEAR = (year: number, utilityYear1: number): SavingsModel["years"][number] => ({
  year,
  productionKwh: 10_076,
  utilityCostCents: utilityYear1,
  residualGridCents: 60_430,
  meterFeeCents: 12_000,
  solarPaymentCents: 0,
  solarCostCents: 72_430,
  cumulativeSavingsCents: 0,
});

/** A 25-year model, because the horizon is what names the figure. */
const YEARS = (utilityYear1: number): SavingsModel["years"] =>
  Array.from({ length: 25 }, (_, i) => YEAR(i + 1, utilityYear1));

const savings = (net: number, utilityYear1 = 215_600): SavingsModel => ({
  years: YEARS(utilityYear1),
  utilityCostAvoidedCents: 5_644_415,
  solarPaidCents: 2_640_000,
  netSavingsCents: net,
  totalSavingsCents: net,
  paybackYear: net >= 0 ? 14 : null,
});

const option = (
  monthlyCents: number | null,
  postSolarMonthlyCents: number,
): ProposalPaymentOption =>
  ({
    key: "k",
    label: "Amos 30 Y",
    quoted: true,
    monthlyCents,
    postSolarMonthlyCents,
    savings: savings(1),
    // The financing block is not read by the pitch; the menu row is.
    financing: {} as ProposalPaymentOption["financing"],
  }) as ProposalPaymentOption;

describe("monthlyToday", () => {
  it("prefers the bill the customer actually reported", () => {
    expect(monthlyToday(18_000, savings(1))).toBe(18_000);
  });

  it("falls back to year one of the model, which always exists", () => {
    // 215,600 cents a year of utility cost → 17,967 a month.
    expect(monthlyToday(null, savings(1, 215_600))).toBe(17_967);
  });
});

describe("coverPitch", () => {
  it("offers the cash swap when there is no monthly payment to quote", () => {
    const p = coverPitch({ billCents: 18_000, option: option(null, 5_036), savings: savings(1) });
    expect(p).toEqual({
      kind: "cash-then",
      todayCents: 18_000,
      afterCents: 5_036,
      priceCents: null,
    });
  });

  it("draws the monthly swap when the new monthly genuinely lands below the bill", () => {
    // 9,000 payment + 3,000 residual = 12,000, against an 18,000 bill.
    const p = coverPitch({ billCents: 18_000, option: option(9_000, 3_000), savings: savings(1) });
    expect(p).toEqual({ kind: "monthly-swap", todayCents: 18_000, afterCents: 12_000 });
  });

  /**
   * The whole reason this module exists. Prod's v3 quotes an 11 kW system on a
   * 30-year Amos programme at roughly $330 a month against a $180 bill. Leading
   * that cover with "what changes on the first of the month" would hand the
   * homeowner the worst framing of the deal in the largest type on the page.
   */
  it("refuses to lead on money when the payment is not below the bill", () => {
    const p = coverPitch({ billCents: 18_000, option: option(33_000, 800), savings: savings(-1) });
    expect(p.kind).toBe("coverage");
  });

  it("refuses to lead on money when the payment merely ties the bill", () => {
    const p = coverPitch({ billCents: 18_000, option: option(15_000, 3_000), savings: savings(1) });
    expect(p.kind).toBe("coverage");
  });
});

describe("lifetimeFigure", () => {
  it("calls a positive result a saving, and keeps the payback year", () => {
    const f = lifetimeFigure(savings(3_004_415));
    expect(f.label).toBe("Projected 25-year net saving");
    expect(f.cents).toBe(3_004_415);
    expect(f.tone).toBe("good");
    expect(f.paybackYear).toBe(14);
  });

  /**
   * "Net saving: -$19,217" is an oxymoron printed in accent orange. The number
   * does not change and nothing is hidden — the label follows the sign, the
   * figure is stated in the positive, and the accent is withheld.
   */
  it("calls a negative result a cost, states it positive, and drops the accent", () => {
    const f = lifetimeFigure(savings(-1_921_700));
    expect(f.label).toBe("Projected 25-year net cost");
    expect(f.cents).toBe(1_921_700);
    expect(f.tone).toBe("plain");
    expect(f.paybackYear).toBeNull();
  });

  it("names the horizon it was actually modelled over", () => {
    const s = savings(1);
    s.years = Array.from({ length: 30 }, (_, i) => YEAR(i + 1, 215_600));
    expect(lifetimeFigure(s).label).toBe("Projected 30-year net saving");
  });
});
