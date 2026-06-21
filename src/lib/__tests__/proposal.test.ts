import { describe, it, expect } from "vitest";
import {
  computeProposalFinancials,
  financingOptions,
  requiredPhotosMet,
  defaultSections,
  defaultUpgrades,
  defaultProposalContent,
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

describe("requiredPhotosMet", () => {
  it("false until every required slot has a photo", () => {
    const items = [
      { id: "a", required: true },
      { id: "b", required: false },
      { id: "c", required: true },
    ];
    expect(requiredPhotosMet(items, { a: 1, b: 0, c: 0 })).toBe(false);
    expect(requiredPhotosMet(items, { a: 2, b: 0, c: 1 })).toBe(true);
  });

  it("true when there are no required items", () => {
    expect(requiredPhotosMet([{ id: "x", required: false }], {})).toBe(true);
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

  it("defaultProposalContent is a complete starting blob", () => {
    const c = defaultProposalContent();
    expect(c.upgrades?.length).toBeGreaterThan(0);
    expect(c.selectedSections?.length).toBe(PROPOSAL_SECTIONS.length);
    expect(c.faq?.length).toBeGreaterThan(0);
    expect(c.whyAnexa?.length).toBeGreaterThan(0);
  });
});
