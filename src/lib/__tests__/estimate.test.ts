import { describe, it, expect } from "vitest";
import { computeEstimate, lineTotalCents, lineCostCents, formatEstimateDollars } from "@/lib/estimate";

const line = (
  quantity: number,
  unitPriceCents: number,
  costPerUnitCents = 0,
  category?: string,
) => ({ quantity, unitPriceCents, costPerUnitCents, category });

describe("estimate line math", () => {
  it("multiplies quantity by the unit price", () => {
    expect(lineTotalCents(line(25, 45000))).toBe(1125000);
    expect(lineCostCents(line(25, 45000, 28000))).toBe(700000);
  });

  it("rounds to whole cents rather than carrying a fraction", () => {
    // 33.333 sq × $1.005/unit — the kind of quantity a roof measurement produces.
    expect(lineTotalCents(line(33.333, 100.5))).toBe(3350);
  });
});

describe("computeEstimate", () => {
  it("totals an empty estimate to zero without dividing by zero", () => {
    const calc = computeEstimate([]);
    expect(calc.subtotalCents).toBe(0);
    expect(calc.totalCents).toBe(0);
    expect(calc.marginPct).toBe(0);
  });

  it("subtotals every line and reports cost and margin", () => {
    const calc = computeEstimate([
      line(25, 45000, 28000, "Roofing"),
      line(1, 150000, 90000, "Roofing"),
    ]);
    expect(calc.subtotalCents).toBe(1275000);
    expect(calc.costCents).toBe(790000);
    expect(calc.totalCents).toBe(1275000);
    expect(calc.grossProfitCents).toBe(485000);
    expect(calc.marginPct).toBeCloseTo(38.04, 1);
  });

  it("takes the discount off the subtotal and measures margin on what actually arrives", () => {
    const calc = computeEstimate([line(10, 100000, 60000)], { discountCents: 200000 });
    expect(calc.subtotalCents).toBe(1000000);
    expect(calc.discountCents).toBe(200000);
    expect(calc.totalCents).toBe(800000);
    expect(calc.costCents).toBe(600000);
    // Margin is against the discounted total, not the subtotal.
    expect(calc.grossProfitCents).toBe(200000);
    expect(calc.marginPct).toBeCloseTo(25, 5);
  });

  it("clamps a discount larger than the subtotal instead of going negative", () => {
    const calc = computeEstimate([line(1, 50000)], { discountCents: 900000 });
    expect(calc.discountCents).toBe(50000);
    expect(calc.totalCents).toBe(0);
    // A free job is free, never money owed to the customer.
    expect(calc.totalCents).toBeGreaterThanOrEqual(0);
  });

  it("reports a negative profit when priced below cost", () => {
    const calc = computeEstimate([line(1, 50000, 80000)]);
    expect(calc.grossProfitCents).toBe(-30000);
    expect(calc.marginPct).toBeLessThan(0);
  });

  it("costs nothing when no cost template is selected", () => {
    const calc = computeEstimate([line(25, 45000)]);
    expect(calc.costCents).toBe(0);
    expect(calc.grossProfitCents).toBe(calc.totalCents);
  });

  it("groups by category, biggest first, and defaults a blank category to General", () => {
    const calc = computeEstimate([
      line(1, 10000, 0, "Gutters"),
      line(1, 90000, 0, "Roofing"),
      line(1, 5000, 0, "  "),
    ]);
    expect(calc.byCategory.map((c) => c.category)).toEqual(["Roofing", "Gutters", "General"]);
    expect(calc.byCategory[0].priceCents).toBe(90000);
  });
});

describe("formatEstimateDollars", () => {
  it("renders whole dollars with separators", () => {
    expect(formatEstimateDollars(1275000)).toBe("$12,750");
  });

  it("keeps the sign on a negative", () => {
    expect(formatEstimateDollars(-30000)).toBe("-$300");
  });
});
