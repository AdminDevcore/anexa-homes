import { describe, expect, it } from "vitest";
import {
  customerProductLabel,
  lenderProductLabel,
  withoutDealerFee,
} from "@/lib/solar-lender-product";

/**
 * The dealer fee is what a lender charges the COMPANY. It sits inside the price
 * a household is quoted and is never a line they are shown — but an unnamed
 * programme's label carried it onto the proposal, its payment menu and the
 * filed PDFs. Pricing rework, Stage 1.
 */
describe("the dealer fee never reaches a customer's label", () => {
  const unnamed = { product: "loan" as const, name: null, aprPct: 0, termMonths: 360, dealerFeePct: 25 };

  it("keeps the fee on the label a rep matches against the rate sheet", () => {
    expect(lenderProductLabel(unnamed)).toBe("30 yr · 0% · fee 25%");
  });

  it("drops it from the label frozen into the customer's document", () => {
    expect(customerProductLabel(unnamed)).toBe("30 yr · 0%");
  });

  it("leaves a named programme's name alone", () => {
    expect(customerProductLabel({ ...unnamed, name: "Amos 30 Year Solar", dealerFeePct: 65 })).toBe(
      "Amos 30 Year Solar"
    );
  });

  it("takes the fee out of a label frozen before the change, as it renders", () => {
    expect(withoutDealerFee("Credit Humen · 30 yr · 0% · fee 25%")).toBe("Credit Humen · 30 yr · 0%");
    expect(withoutDealerFee("25 yr · 6.99% · fee 18.5%")).toBe("25 yr · 6.99%");
  });

  it("passes through a label with no fee in it, and an absent one", () => {
    expect(withoutDealerFee("Pay in full")).toBe("Pay in full");
    expect(withoutDealerFee("Amos · Amos 30 Year Solar")).toBe("Amos · Amos 30 Year Solar");
    expect(withoutDealerFee("No fee 0% promo")).toBe("No fee 0% promo");
    expect(withoutDealerFee(null)).toBeNull();
    expect(withoutDealerFee(undefined)).toBeUndefined();
  });
});
