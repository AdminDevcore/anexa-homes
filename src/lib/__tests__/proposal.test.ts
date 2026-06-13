import { describe, it, expect } from "vitest";
import {
  computeProposalFinancials,
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
