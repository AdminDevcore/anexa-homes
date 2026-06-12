import { prisma } from "@/server/db/client";

// A deal's job cost is derived from BOOKKEEPING, not manual entry: approved
// expense transactions tagged to the deal, EXCLUDING categories flagged
// `excludeFromJobCost` (e.g. "Contractor Sales" — sales-rep payouts paid via the
// profit split, which must not be double-counted as a cost).

export type JobCostTxn = {
  id: string;
  date: Date;
  description: string;
  vendor: string | null;
  amountCents: number; // signed: negative = money out (expense)
  approved: boolean;
  category: { name: string; excludeFromJobCost: boolean } | null;
};

export type JobCostExpense = {
  id: string;
  date: string;
  description: string;
  vendor: string | null;
  category: string | null;
  costCents: number; // positive cost (magnitude of the expense)
};

/** Pure: which tagged transactions count as deal job cost, and the total. */
export function jobCostFromTransactions(txns: JobCostTxn[]): {
  totalCents: number;
  expenses: JobCostExpense[];
} {
  const expenses: JobCostExpense[] = [];
  for (const t of txns) {
    if (!t.approved) continue; // only booked transactions
    if (t.amountCents >= 0) continue; // expenses only (money out)
    if (!t.category || t.category.excludeFromJobCost) continue; // skip uncategorized + contractor payouts
    expenses.push({
      id: t.id,
      date: t.date.toISOString(),
      description: t.description,
      vendor: t.vendor,
      category: t.category.name,
      costCents: -t.amountCents,
    });
  }
  return { totalCents: expenses.reduce((s, e) => s + e.costCents, 0), expenses };
}

/** The deal's job cost from bookkeeping (approved, project-tagged, non-excluded expenses). */
export async function getDealJobCost(
  companyId: string,
  projectId: string
): Promise<{ totalCents: number; expenses: JobCostExpense[] }> {
  const txns = await prisma.transaction.findMany({
    where: { companyId, projectId },
    orderBy: { date: "desc" },
    select: {
      id: true,
      date: true,
      description: true,
      vendor: true,
      amountCents: true,
      approved: true,
      category: { select: { name: true, excludeFromJobCost: true } },
    },
  });
  return jobCostFromTransactions(txns);
}
