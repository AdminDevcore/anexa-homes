import { describe, expect, it } from "vitest";
import { year1UtilityAvoidedCents } from "@/lib/solar-proposal";
import type { SavingsModel, SavingsYear } from "@/lib/solar-proposal";

/**
 * The figure a lender's savings analysis asks for: how much of the electricity
 * bill stops arriving in year one.
 *
 * Deliberately GROSS of the loan payment. Amos requires it, their schema cannot
 * express a negative, and their own thirty-year product routinely quotes a
 * payment above the bill it replaces — so a net reading would refuse most of
 * their own book. The net position is `netSavingsCents`, and the comparison
 * chapter already states it plainly.
 */
const year = (over: Partial<SavingsYear> = {}): SavingsYear =>
  ({
    year: 1,
    productionKwh: 17107,
    utilityCostCents: 373196,
    residualGridCents: 0,
    meterFeeCents: 12000,
    solarPaymentCents: 557064,
    vppCreditCents: 40000,
    creditReliefCents: 0,
    solarCostCents: 529064,
    cumulativeSavingsCents: -155868,
    ...over,
  }) as SavingsYear;

const model = (y: SavingsYear[]): SavingsModel => ({ years: y }) as SavingsModel;

describe("year1UtilityAvoidedCents", () => {
  it("is the bill less what the utility still charges", () => {
    // $3,731.96 the utility would have taken, less the $120 meter fee they go
    // on taking. Nothing residual: this roof covers the whole house.
    expect(year1UtilityAvoidedCents(model([year()]))).toBe(361196);
  });

  it("subtracts grid power the household still buys", () => {
    expect(year1UtilityAvoidedCents(model([year({ residualGridCents: 50000 })]))).toBe(311196);
  });

  it("ignores the loan payment entirely", () => {
    // Doubling what the system costs cannot change how much bill it avoids.
    expect(year1UtilityAvoidedCents(model([year({ solarPaymentCents: 1_114_128 })]))).toBe(361196);
  });

  it("reads a document priced before the meter fee was modelled", () => {
    const old = year();
    delete (old as Partial<SavingsYear>).meterFeeCents;
    expect(year1UtilityAvoidedCents(model([old]))).toBe(373196);
  });

  it("is negative when the fixed charges outrun the bill, and says so", () => {
    // A real answer, not an error. The caller refuses to submit it -- see
    // savingsProblems -- rather than this function pretending it is zero.
    expect(year1UtilityAvoidedCents(model([year({ utilityCostCents: 9000 })]))).toBe(-3000);
  });

  it("is null on a model with no years", () => {
    expect(year1UtilityAvoidedCents(model([]))).toBeNull();
  });
});
