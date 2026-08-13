import { describe, it, expect } from "vitest";
import {
  computeProposalFinancials,
  resolveInsuranceFigures,
  financingOptions,
  paymentPlan,
  activeFinanceOption,
  defaultSections,
  defaultUpgrades,
  defaultProposalContent,
  defaultFaq,
  roofingTimeline,
  PROPOSAL_SECTIONS,
} from "../proposal";

describe("computeProposalFinancials", () => {
  it("OOP = deductible + uncovered upgrades; total = RCV + supplements + upgrades", () => {
    const r = computeProposalFinancials({
      rcvCents: 1_800_000,
      acvCents: 1_400_000,
      deductibleCents: 250_000,
      depreciationCents: 400_000,
      approvedSupplementsCents: 300_000,
      upgrades: [
        { label: "Impact shingles", priceCents: 150_000, selected: true },
        { label: "Ridge vent", priceCents: 0, selected: true },
        { label: "Metal (not chosen)", priceCents: 999_999, selected: false },
      ],
    });
    expect(r.customerUpgradesCents).toBe(150_000);
    expect(r.totalProjectValueCents).toBe(1_800_000 + 300_000 + 150_000);
    expect(r.estimatedOutOfPocketCents).toBe(250_000 + 150_000);
  });

  it("ignores unselected and negative upgrade prices", () => {
    const r = computeProposalFinancials({
      rcvCents: 1_000_000,
      acvCents: 0,
      deductibleCents: 100_000,
      depreciationCents: 0,
      approvedSupplementsCents: 0,
      upgrades: [{ label: "Bad", priceCents: -500, selected: true }],
    });
    expect(r.customerUpgradesCents).toBe(0);
    expect(r.estimatedOutOfPocketCents).toBe(100_000);
    expect(r.totalProjectValueCents).toBe(1_000_000);
  });

  it("project discount reduces out-of-pocket but not the deductible", () => {
    const r = computeProposalFinancials({
      rcvCents: 2_400_000,
      acvCents: 0,
      deductibleCents: 500_000,
      depreciationCents: 0,
      approvedSupplementsCents: 0,
      upgrades: [],
      projectDiscountCents: 200_000,
    });
    expect(r.projectDiscountCents).toBe(200_000);
    expect(r.estimatedOutOfPocketCents).toBe(300_000);
  });

  it("CASH: out-of-pocket = project price + upgrades − discount; no insurance figures", () => {
    const r = computeProposalFinancials({
      dealType: "cash",
      rcvCents: 9_999_999, // insurance figures must be ignored for cash
      acvCents: 9_999_999,
      deductibleCents: 9_999_999,
      depreciationCents: 9_999_999,
      approvedSupplementsCents: 9_999_999,
      upgrades: [{ label: "Ridge vent", priceCents: 50_000, selected: true }],
      projectPriceCents: 1_800_000,
      projectDiscountCents: 100_000,
    });
    expect(r.dealType).toBe("cash");
    expect(r.projectPriceCents).toBe(1_800_000);
    expect(r.customerUpgradesCents).toBe(50_000);
    expect(r.totalProjectValueCents).toBe(1_850_000);
    expect(r.estimatedOutOfPocketCents).toBe(1_800_000 + 50_000 - 100_000);
  });

  it("an RCV typed in the builder drives the total project value", () => {
    // The rep has the adjuster's estimate and types it in; the claim record is
    // still empty. The customer's total must follow what was typed.
    const figures = resolveInsuranceFigures({
      dealType: "insurance",
      content: { rcvCents: 2_840_000, approvedSupplementsCents: 320_000 },
      claim: { rcv: 0, acv: 0, deductible: 250_000, depreciation: 0 },
    });
    const r = computeProposalFinancials({ ...figures, upgrades: [] });
    expect(r.totalProjectValueCents).toBe(2_840_000 + 320_000);
    expect(r.estimatedOutOfPocketCents).toBe(250_000); // still the claim's deductible
  });

  it("defaults to insurance when dealType is omitted", () => {
    const r = computeProposalFinancials({
      rcvCents: 1_000_000, acvCents: 0, deductibleCents: 100_000, depreciationCents: 0,
      approvedSupplementsCents: 0, upgrades: [], projectPriceCents: 5_000_000,
    });
    expect(r.dealType).toBe("insurance");
    expect(r.projectPriceCents).toBe(0); // project price ignored for insurance
    expect(r.estimatedOutOfPocketCents).toBe(100_000); // deductible-driven
  });

  it("clamps the discount to the gross out-of-pocket (never negative)", () => {
    const r = computeProposalFinancials({
      rcvCents: 0,
      acvCents: 0,
      deductibleCents: 100_000,
      depreciationCents: 0,
      approvedSupplementsCents: 0,
      upgrades: [],
      projectDiscountCents: 999_999,
    });
    expect(r.projectDiscountCents).toBe(100_000);
    expect(r.estimatedOutOfPocketCents).toBe(0);
  });
});

describe("resolveInsuranceFigures", () => {
  const claim = { rcv: 2_000_000, acv: 1_600_000, deductible: 250_000, depreciation: 400_000 };

  it("uses the claim and project when the builder left everything blank", () => {
    expect(
      resolveInsuranceFigures({ dealType: "insurance", content: {}, claim, supplementCents: 300_000 })
    ).toEqual({
      rcvCents: 2_000_000,
      acvCents: 1_600_000,
      depreciationCents: 400_000,
      approvedSupplementsCents: 300_000,
      deductibleCents: 250_000,
    });
  });

  it("every typed figure overrides the stored one", () => {
    expect(
      resolveInsuranceFigures({
        dealType: "insurance",
        content: {
          rcvCents: 2_840_000,
          acvCents: 2_190_000,
          depreciationCents: 650_000,
          approvedSupplementsCents: 320_000,
          deductibleCents: 100_000,
        },
        claim,
        supplementCents: 300_000,
      })
    ).toEqual({
      rcvCents: 2_840_000,
      acvCents: 2_190_000,
      depreciationCents: 650_000,
      approvedSupplementsCents: 320_000,
      deductibleCents: 100_000,
    });
  });

  it("a typed 0 is an override, not a blank", () => {
    // "No recoverable depreciation on this claim" must not silently become the
    // claim's $4,000. This is the whole reason the chain uses ?? and not ||.
    const r = resolveInsuranceFigures({
      dealType: "insurance",
      content: { depreciationCents: 0, approvedSupplementsCents: 0 },
      claim,
      supplementCents: 300_000,
    });
    expect(r.depreciationCents).toBe(0);
    expect(r.approvedSupplementsCents).toBe(0);
    expect(r.rcvCents).toBe(2_000_000); // untouched fields still fall back
  });

  it("falls back to zero when there is no claim at all", () => {
    expect(resolveInsuranceFigures({ dealType: "insurance", content: {}, claim: null })).toEqual({
      rcvCents: 0,
      acvCents: 0,
      depreciationCents: 0,
      approvedSupplementsCents: 0,
      deductibleCents: 0,
    });
  });

  it("cash deals zero every figure, even one left in the content by an earlier draft", () => {
    expect(
      resolveInsuranceFigures({
        dealType: "cash",
        content: { rcvCents: 2_840_000, deductibleCents: 250_000 },
        claim,
        supplementCents: 300_000,
      })
    ).toEqual({
      rcvCents: 0,
      acvCents: 0,
      depreciationCents: 0,
      approvedSupplementsCents: 0,
      deductibleCents: 0,
    });
  });
});

describe("financingOptions", () => {
  it("splits the amount across each term at 0% interest, sorted ascending", () => {
    const opts = financingOptions(300_000, [60, 12, 24]);
    expect(opts.map((o) => o.months)).toEqual([12, 24, 60]);
    expect(opts[0].monthlyCents).toBe(25_000); // 3000 / 12
    expect(opts[2].monthlyCents).toBe(5_000); // 3000 / 60
  });

  it("rounds the monthly up so the schedule never under-collects", () => {
    const [opt] = financingOptions(100_000, [12]);
    expect(opt.monthlyCents).toBe(Math.ceil(100_000 / 12));
    expect(opt.monthlyCents * 12).toBeGreaterThanOrEqual(100_000);
  });
});

describe("paymentPlan", () => {
  const financing = { enabled: true, termsMonths: [12, 24, 60] };

  it("the headline is the LOWEST monthly — the longest term", () => {
    const plan = paymentPlan({ outOfPocketCents: 1_800_000, financing });
    expect(plan.headline?.months).toBe(60);
    expect(plan.headline?.monthlyCents).toBe(Math.ceil(1_800_000 / 60));
    // Every other option costs more per month than the headline.
    for (const o of plan.financeOptions) {
      expect(o.monthlyCents).toBeGreaterThanOrEqual(plan.headline!.monthlyCents);
    }
  });

  it("chips stay ascending by term so they read 12 → 24 → 60", () => {
    const plan = paymentPlan({ outOfPocketCents: 300_000, financing: { enabled: true, termsMonths: [60, 12, 24] } });
    expect(plan.financeOptions.map((o) => o.months)).toEqual([12, 24, 60]);
  });

  it("no monthly column when financing is off, has no terms, or nothing is owed", () => {
    expect(paymentPlan({ outOfPocketCents: 1_800_000, financing: { enabled: false, termsMonths: [60] } }).financeOptions).toEqual([]);
    expect(paymentPlan({ outOfPocketCents: 1_800_000, financing: { enabled: true, termsMonths: [] } }).financeOptions).toEqual([]);
    expect(paymentPlan({ outOfPocketCents: 0, financing }).financeOptions).toEqual([]);
    expect(paymentPlan({ outOfPocketCents: 1_800_000 }).headline).toBeNull();
  });

  it("both columns are the same money — 0% means when, not how much", () => {
    const plan = paymentPlan({ outOfPocketCents: 1_800_000, financing });
    expect(plan.totalCents).toBe(1_800_000);
    // Rounding up per month can only ever over-collect, never under-collect.
    expect(plan.headline!.monthlyCents * plan.headline!.months).toBeGreaterThanOrEqual(plan.totalCents);
  });

  it("finances the out-of-pocket for BOTH deal types — price on cash, deductible on insurance", () => {
    const cash = computeProposalFinancials({
      dealType: "cash", rcvCents: 0, acvCents: 0, deductibleCents: 0, depreciationCents: 0,
      approvedSupplementsCents: 0, upgrades: [], projectPriceCents: 1_800_000,
    });
    const ins = computeProposalFinancials({
      dealType: "insurance", rcvCents: 2_400_000, acvCents: 0, deductibleCents: 250_000,
      depreciationCents: 0, approvedSupplementsCents: 0, upgrades: [],
    });
    expect(paymentPlan({ outOfPocketCents: cash.estimatedOutOfPocketCents, financing }).totalCents).toBe(1_800_000);
    // The deductible, NOT the RCV — the carrier's money is never financed.
    expect(paymentPlan({ outOfPocketCents: ins.estimatedOutOfPocketCents, financing }).totalCents).toBe(250_000);
  });

  it("clamps a negative amount rather than quoting a negative payment", () => {
    expect(paymentPlan({ outOfPocketCents: -5_000, financing }).totalCents).toBe(0);
  });
});

describe("activeFinanceOption", () => {
  const plan = paymentPlan({ outOfPocketCents: 1_800_000, financing: { enabled: true, termsMonths: [12, 24, 60] } });

  it("honours the term the customer picked", () => {
    expect(activeFinanceOption(plan, { mode: "finance", months: 24, at: "" })?.months).toBe(24);
  });

  it("falls back to the headline when the rep later removed that term", () => {
    expect(activeFinanceOption(plan, { mode: "finance", months: 999, at: "" })?.months).toBe(60);
  });

  it("shows the headline for a cash pick or no pick at all", () => {
    expect(activeFinanceOption(plan, { mode: "cash", at: "" })?.months).toBe(60);
    expect(activeFinanceOption(plan, undefined)?.months).toBe(60);
  });

  it("is null when there is no financing on offer", () => {
    const none = paymentPlan({ outOfPocketCents: 1_800_000 });
    expect(activeFinanceOption(none, { mode: "finance", months: 24, at: "" })).toBeNull();
  });
});

describe("defaults", () => {
  it("defaultSections covers all sections, enabled, ordered", () => {
    const s = defaultSections();
    expect(s.map((x) => x.id)).toEqual([...PROPOSAL_SECTIONS]);
    expect(s.every((x) => x.enabled)).toBe(true);
    expect(s.map((x) => x.order)).toEqual(s.map((_, i) => i));
  });

  it("defaultUpgrades are all unselected with zero price", () => {
    expect(defaultUpgrades().every((u) => !u.selected && u.priceCents === 0)).toBe(true);
  });

  it("defaultProposalContent seeds upgrades + sections, but NOT faq/why (renderer fills deal-type-aware)", () => {
    const c = defaultProposalContent();
    expect(c.upgrades?.length).toBeGreaterThan(0);
    expect(c.selectedSections?.length).toBe(PROPOSAL_SECTIONS.length);
    expect(c.faq).toBeUndefined();
    expect(c.whyAnexa).toBeUndefined();
  });
});

describe("deal-type-aware copy", () => {
  it("cash timeline has no claim/adjuster/supplement/depreciation steps", () => {
    const cash = roofingTimeline("cash").join(" | ").toLowerCase();
    expect(cash).not.toMatch(/claim|adjuster|supplement|depreciation/);
    const ins = roofingTimeline("insurance").join(" | ").toLowerCase();
    expect(ins).toMatch(/claim filed/);
    expect(ins).toMatch(/adjuster/);
  });

  it("cash FAQ drops deductible/depreciation language; insurance keeps it", () => {
    const cash = defaultFaq("cash").map((f) => `${f.q} ${f.a}`).join(" ").toLowerCase();
    expect(cash).not.toMatch(/deductible|depreciation|carrier|supplement/);
    const ins = defaultFaq("insurance").map((f) => f.q).join(" ").toLowerCase();
    expect(ins).toMatch(/deductible/);
  });
});
