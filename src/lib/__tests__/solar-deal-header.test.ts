import { describe, expect, it } from "vitest";
import { financingCard } from "@/lib/solar-deal-header";

const NONE = { product: null, creditLender: null, creditStatus: null, designLender: null } as const;

describe("financingCard", () => {
  it("states Cash outright — the bug this replaced showed 'Not selected'", () => {
    // A cash deal has no lender BY DEFINITION. Falling through to the
    // no-lender branch made a finished decision read as an unarranged loan.
    expect(financingCard({ ...NONE, product: "cash" })).toEqual({
      label: "Financing",
      value: "Cash",
      hint: "Paid in full · no lender",
    });
  });

  it("still says Cash when a lender was picked on the design and then dropped", () => {
    // The design's lender only filters the equipment catalogue. Once the deal
    // is priced as cash, naming that partner would claim a loan that is not
    // there.
    const card = financingCard({ ...NONE, product: "cash", designLender: "GoodLeap" });
    expect(card.value).toBe("Cash");
  });

  it("names the approved lender and leads the hint with the product", () => {
    expect(
      financingCard({
        product: "loan",
        creditLender: "GoodLeap",
        creditStatus: "approved",
        designLender: "Sunlight Financial",
      })
    ).toEqual({ label: "Financing", value: "GoodLeap", hint: "Loan · Approved" });
  });

  it("distinguishes a lease from a loan with the same partner on it", () => {
    const loan = financingCard({ ...NONE, product: "loan", designLender: "Sunrun" });
    const lease = financingCard({ ...NONE, product: "lease", designLender: "Sunrun" });
    expect(loan.hint).toBe("Loan · No application yet");
    expect(lease.hint).toBe("Lease · No application yet");
  });

  it("falls back to the design's lender when no application exists yet", () => {
    expect(financingCard({ ...NONE, product: "ppa", designLender: "Sunnova" })).toEqual({
      label: "Financing",
      value: "Sunnova",
      hint: "PPA · No application yet",
    });
  });

  it("ignores a blank lender name from the webhook rather than rendering an empty tile", () => {
    const card = financingCard({
      product: "loan",
      creditLender: "   ",
      creditStatus: "submitted",
      designLender: "GoodLeap",
    });
    expect(card.value).toBe("GoodLeap");
    expect(card.hint).toBe("Loan · No application yet");
  });

  it("keeps its slot with a placeholder on a deal that has decided nothing", () => {
    // Undecided is not the same as cash: no SolarFinance row means the
    // Financing step was never saved.
    expect(financingCard(NONE)).toEqual({
      label: "Financing",
      value: null,
      hint: "No lender selected",
    });
  });
});
