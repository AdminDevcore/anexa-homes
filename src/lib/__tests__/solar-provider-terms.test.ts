import { describe, it, expect } from "vitest";
import {
  buybackLine,
  hasProviderTerms,
  providerTermsLine,
  vppLine,
  type ProviderTerms,
} from "@/lib/solar-provider-terms";

const blank: ProviderTerms = {
  buyback: false,
  buybackRateMills: null,
  vpp: false,
  vppProgramme: null,
  vppUpfrontCents: null,
  vppAnnualCents: null,
  notes: null,
};

describe("what a provider does for a solar customer, as one line", () => {
  it("prints a buyback rate to the mill", () => {
    // Export credits are quoted in tenths of a cent — $0.095, not $0.10 — and a
    // rate rounded to the cent is a different offer.
    expect(buybackLine({ ...blank, buyback: true, buybackRateMills: 95 })).toBe(
      "Buyback $0.095/kWh"
    );
  });

  it("says a provider buys back even when nobody recorded a rate", () => {
    // A real and common answer: they buy back at a figure that moves with the
    // market. Waiting for a number that may never exist would hide the fact.
    expect(buybackLine({ ...blank, buyback: true })).toBe("Buys back exported power");
    expect(buybackLine({ ...blank, buyback: true, buybackRateMills: 0 })).toBe(
      "Buys back exported power"
    );
  });

  it("says nothing at all when they do not buy back", () => {
    expect(buybackLine(blank)).toBeNull();
    // Including when a rate is stranded on the row from before somebody
    // un-ticked it — the flag is what was answered, the rate is only detail.
    expect(buybackLine({ ...blank, buybackRateMills: 95 })).toBeNull();
  });

  it("leads a battery programme with its own name", () => {
    // The customer signs up to "Renew Home", and that is what appears on their
    // statement. A rep saying "your retailer pays you" has created a question
    // they cannot answer.
    expect(
      vppLine({
        ...blank,
        vpp: true,
        vppProgramme: "Renew Home",
        vppUpfrontCents: 50_000,
        vppAnnualCents: 12_000,
      })
    ).toBe("VPP · Renew Home — $500 upfront + $120/yr");
  });

  it("still reports a programme with no name and no money on it", () => {
    expect(vppLine({ ...blank, vpp: true })).toBe("Battery programme");
    expect(vppLine({ ...blank, vpp: true, vppUpfrontCents: 50_000 })).toBe(
      "Battery programme — $500 upfront"
    );
  });

  it("joins both halves for the summary beside a name", () => {
    expect(
      providerTermsLine({
        ...blank,
        buyback: true,
        buybackRateMills: 95,
        vpp: true,
        vppProgramme: "Renew Home",
        vppAnnualCents: 12_000,
      })
    ).toBe("Buyback $0.095/kWh · VPP · Renew Home — $120/yr");
  });

  it("tells 'nothing recorded' apart from 'they do neither'", () => {
    // THE DISTINCTION THE WHOLE FEATURE TURNS ON. Both render an empty summary,
    // and only one of them means the answer is no — so the callers ask this
    // before deciding which sentence to print. Silence read as "no" is how a
    // rep quotes a buyback nobody ever confirmed, or misses one that exists.
    expect(hasProviderTerms(blank)).toBe(false);
    expect(providerTermsLine(blank)).toBe("");

    const checkedAndNegative = { ...blank, notes: "Called March 2026 — they do not buy back." };
    expect(hasProviderTerms(checkedAndNegative)).toBe(true);
    expect(providerTermsLine(checkedAndNegative)).toBe("");
  });
});
