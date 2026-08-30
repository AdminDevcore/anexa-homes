import { describe, it, expect } from "vitest";
import {
  adjustmentIsEffective,
  contractAdjustmentProblems,
  contractReconciles,
  monthlyReconciles,
  reconcileContract,
  renderDisclosure,
  DISCLOSURE_TEMPLATE_SUGGESTION,
  type LenderContractAdjustment,
} from "@/lib/solar-contract-adjustment";

/**
 * The arithmetic that makes a contract value and a customer's obligation two
 * different numbers, and the rules that stop them being confused.
 *
 * The worked example throughout is the real one: an 8.80 kW system quoted at
 * $5.50 a watt, on a partner whose contract carries a $70,000 programme
 * contribution.
 */

const PARTICIPATE: LenderContractAdjustment = {
  enabled: true,
  fixedCents: 70_000_00,
  label: "Participate Program Contribution",
  disclosure: DISCLOSURE_TEMPLATE_SUGGESTION,
};

/** 8,800 W at $5.50/W. */
const CUSTOMER_PRICE_CENTS = 48_400_00;

describe("the two figures", () => {
  it("adds the configured contribution to the customer's price and changes nothing else", () => {
    const r = reconcileContract({
      customerObligationCents: CUSTOMER_PRICE_CENTS,
      adjustment: PARTICIPATE,
      lenderName: "Participate",
    });

    expect(r).not.toBeNull();
    expect(r!.customerObligationCents).toBe(48_400_00);
    expect(r!.adjustmentCents).toBe(70_000_00);
    expect(r!.lenderContractValueCents).toBe(118_400_00);
    expect(contractReconciles(r!)).toBe(true);
  });

  it("never moves the obligation it was handed", () => {
    // The whole safety property of this feature in one assertion: whatever the
    // contribution, the number the customer owes comes out exactly as it went
    // in. A version of this that "adjusted" the price would still produce a
    // reconciliation that adds up.
    for (const fixedCents of [1_00, 70_000_00, 500_000_00]) {
      const r = reconcileContract({
        customerObligationCents: CUSTOMER_PRICE_CENTS,
        adjustment: { ...PARTICIPATE, fixedCents },
      });
      expect(r!.customerObligationCents).toBe(CUSTOMER_PRICE_CENTS);
    }
  });

  it("says nothing at all when the partner runs no programme", () => {
    expect(reconcileContract({ customerObligationCents: CUSTOMER_PRICE_CENTS, adjustment: null }))
      .toBeNull();
    expect(
      reconcileContract({
        customerObligationCents: CUSTOMER_PRICE_CENTS,
        adjustment: { ...PARTICIPATE, enabled: false },
      })
    ).toBeNull();
  });
});

describe("a half-configured programme", () => {
  it("is refused rather than quoted, and names the missing part", () => {
    expect(contractAdjustmentProblems({ ...PARTICIPATE, fixedCents: null })).toEqual([
      "no adjustment amount is set",
    ]);
    expect(contractAdjustmentProblems({ ...PARTICIPATE, label: "  " })).toEqual([
      "no customer-facing label is set",
    ]);
    expect(contractAdjustmentProblems({ ...PARTICIPATE, disclosure: null })).toEqual([
      "no customer disclosure is written",
    ]);
    expect(
      contractAdjustmentProblems({ enabled: true, fixedCents: 0, label: null, disclosure: null })
    ).toHaveLength(3);
  });

  it("is complete when all three are there, and is nothing at all when switched off", () => {
    expect(contractAdjustmentProblems(PARTICIPATE)).toEqual([]);
    // Off is not "incomplete": it is every lender in the database.
    expect(contractAdjustmentProblems({ enabled: false, fixedCents: null, label: null, disclosure: null }))
      .toEqual([]);
    expect(contractAdjustmentProblems(null)).toEqual([]);
  });

  it("renders no reconciliation at all rather than a $0 contribution", () => {
    // Silent HERE and loud in validation. A preview missing a block is
    // recoverable; a document quoting a $0 "Program Contribution" at a
    // homeowner is not.
    expect(
      reconcileContract({
        customerObligationCents: CUSTOMER_PRICE_CENTS,
        adjustment: { ...PARTICIPATE, fixedCents: null },
      })
    ).toBeNull();
  });
});

describe("the effective date", () => {
  const at = new Date("2026-09-15T12:00:00Z");

  it("treats no date as already running", () => {
    expect(adjustmentIsEffective(PARTICIPATE, at)).toBe(true);
  });

  it("does not apply before its start date", () => {
    const future = { ...PARTICIPATE, effectiveAt: new Date("2026-10-01T00:00:00Z") };
    expect(adjustmentIsEffective(future, at)).toBe(false);
    expect(reconcileContract({ customerObligationCents: CUSTOMER_PRICE_CENTS, adjustment: future, at }))
      .toBeNull();
  });

  it("applies on and after it", () => {
    const started = { ...PARTICIPATE, effectiveAt: new Date("2026-09-01T00:00:00Z") };
    expect(adjustmentIsEffective(started, at)).toBe(true);
    expect(
      reconcileContract({ customerObligationCents: CUSTOMER_PRICE_CENTS, adjustment: started, at })!
        .lenderContractValueCents
    ).toBe(118_400_00);
  });

  it("accepts the ISO string a form posts as readily as a Date", () => {
    expect(adjustmentIsEffective({ ...PARTICIPATE, effectiveAt: "2026-09-01" }, at)).toBe(true);
    expect(adjustmentIsEffective({ ...PARTICIPATE, effectiveAt: "2026-10-01" }, at)).toBe(false);
  });
});

describe("the disclosure", () => {
  it("substitutes the figures rather than carrying any of its own", () => {
    const r = reconcileContract({
      customerObligationCents: CUSTOMER_PRICE_CENTS,
      adjustment: PARTICIPATE,
      lenderName: "Participate",
    })!;

    expect(r.disclosure).toContain("$118,400");
    expect(r.disclosure).toContain("$70,000");
    expect(r.disclosure).toContain("$48,400");
    expect(r.disclosure).toContain("Participate Program Contribution");
    // No token survives into what a homeowner reads.
    expect(r.disclosure).not.toMatch(/\{contractValue\}|\{adjustment\}|\{customerObligation\}/);
  });

  it("prints the administrator's words and never any of its own", () => {
    const r = reconcileContract({
      customerObligationCents: CUSTOMER_PRICE_CENTS,
      adjustment: {
        ...PARTICIPATE,
        label: "Prepaid Lease Credit",
        disclosure: "{label}: {adjustment} of the {contractValue} contract. You owe {customerObligation}.",
      },
    })!;
    expect(r.disclosure).toBe(
      "Prepaid Lease Credit: $70,000 of the $118,400 contract. You owe $48,400."
    );
    // The words the app must never introduce on its own.
    expect(r.disclosure).not.toMatch(/discount|incentive|tax credit|rebate/i);
  });

  it("leaves an unknown token visible rather than blanking it", () => {
    // A typo somebody can see beats a gap nobody notices until it is on paper.
    expect(
      renderDisclosure("{label} — {mystery}", {
        label: "X",
        lender: null,
        contractValueCents: 1,
        adjustmentCents: 1,
        customerObligationCents: 0,
      })
    ).toBe("X — {mystery}");
  });
});

describe("the payment has to come off the customer's money", () => {
  it("accepts the interest-free payment on the obligation", () => {
    // $48,400 over 360 months at 0% is $134.44.
    expect(
      monthlyReconciles({
        financedAmountCents: 48_400_00,
        aprPct: 0,
        termMonths: 360,
        monthlyCents: 134_44,
      })
    ).toBe(true);
  });

  it("rejects a payment amortised from the contract value instead", () => {
    // $118,400 over 360 months is $328.89 — the exact failure this feature can
    // produce, and the one nothing on the page would look wrong about. At the
    // 0% these terms quote, no honest payment on $48,400 gets near it.
    expect(
      monthlyReconciles({
        financedAmountCents: 48_400_00,
        aprPct: 0,
        termMonths: 360,
        monthlyCents: 328_89,
      })
    ).toBe(false);
  });

  it("rejects a payment that could never repay the principal", () => {
    expect(
      monthlyReconciles({
        financedAmountCents: 48_400_00,
        aprPct: 0,
        termMonths: 360,
        monthlyCents: 50_00,
      })
    ).toBe(false);
  });

  it("leaves a real programme's structure alone", () => {
    // A published payment factor legitimately disagrees with a straight
    // amortisation — 25 years at 4.99% on $48,400 amortises to about $283, and
    // a factor carrying the dealer fee comes out above it. This check exists to
    // catch the wrong PRINCIPAL, not the wrong rate.
    for (const monthlyCents of [283_00, 310_00, 350_00]) {
      expect(
        monthlyReconciles({
          financedAmountCents: 48_400_00,
          aprPct: 4.99,
          termMonths: 300,
          monthlyCents,
        })
      ).toBe(true);
    }
  });

  it("still catches the contract value on a programme that charges interest", () => {
    // The same 2.45x inflation, on terms that are not interest-free.
    expect(
      monthlyReconciles({
        financedAmountCents: 48_400_00,
        aprPct: 4.99,
        termMonths: 300,
        monthlyCents: 692_00,
      })
    ).toBe(false);
  });

  it("does not reject a programme built around a paydown", () => {
    // The quoted figure is the WITH-paydown one: it repays the principal LESS
    // the lump, so a floor measured against the whole principal would refuse
    // every such product.
    expect(
      monthlyReconciles({
        financedAmountCents: 48_400_00,
        aprPct: 0,
        termMonths: 360,
        paydownCents: 14_520_00,
        monthlyCents: 94_11,
      })
    ).toBe(true);
  });

  it("has nothing to say about a deal with no payment or no term", () => {
    expect(
      monthlyReconciles({ financedAmountCents: 48_400_00, termMonths: 360, monthlyCents: null })
    ).toBe(true);
    expect(
      monthlyReconciles({ financedAmountCents: 48_400_00, termMonths: null, monthlyCents: 100_00 })
    ).toBe(true);
  });
});

describe("the invariant", () => {
  it("fails a reconciliation whose figures do not add up", () => {
    expect(
      contractReconciles({
        label: "X",
        adjustmentCents: 70_000_00,
        customerObligationCents: 48_400_00,
        // One dollar out. A document is refused rather than printing three
        // numbers a homeowner is invited to sum.
        lenderContractValueCents: 118_401_00,
        disclosure: "",
      })
    ).toBe(false);
  });
});
