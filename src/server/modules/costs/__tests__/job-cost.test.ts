import { describe, it, expect } from "vitest";
import { jobCostFromTransactions, type JobCostTxn } from "../job-cost";

const base = {
  id: "t",
  date: new Date("2026-06-01T00:00:00Z"),
  description: "x",
  vendor: null as string | null,
};

function txn(over: Partial<JobCostTxn>): JobCostTxn {
  return {
    ...base,
    amountCents: -10000,
    approved: true,
    category: { name: "Materials", excludeFromJobCost: false },
    ...over,
  };
}

describe("jobCostFromTransactions", () => {
  it("counts an approved expense with a normal category", () => {
    const r = jobCostFromTransactions([txn({ id: "a", amountCents: -25000 })]);
    expect(r.totalCents).toBe(25000); // expense magnitude becomes positive cost
    expect(r.expenses).toHaveLength(1);
    expect(r.expenses[0].costCents).toBe(25000);
  });

  it("ignores un-approved transactions", () => {
    expect(jobCostFromTransactions([txn({ approved: false })]).totalCents).toBe(0);
  });

  it("ignores income (money in)", () => {
    expect(jobCostFromTransactions([txn({ amountCents: 50000 })]).totalCents).toBe(0);
  });

  it("excludes contractor-sales (flagged) categories", () => {
    const r = jobCostFromTransactions([
      txn({ id: "m", amountCents: -10000, category: { name: "Materials", excludeFromJobCost: false } }),
      txn({ id: "c", amountCents: -40000, category: { name: "Contractor Sales", excludeFromJobCost: true } }),
    ]);
    expect(r.totalCents).toBe(10000); // only the materials line
    expect(r.expenses.map((e) => e.category)).toEqual(["Materials"]);
  });

  it("ignores uncategorized transactions", () => {
    expect(jobCostFromTransactions([txn({ category: null })]).totalCents).toBe(0);
  });

  it("sums several qualifying expenses", () => {
    const r = jobCostFromTransactions([
      txn({ id: "a", amountCents: -10000 }),
      txn({ id: "b", amountCents: -5000, category: { name: "Labor", excludeFromJobCost: false } }),
    ]);
    expect(r.totalCents).toBe(15000);
    expect(r.expenses).toHaveLength(2);
  });
});
