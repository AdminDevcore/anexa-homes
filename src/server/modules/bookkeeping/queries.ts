import { prisma } from "@/server/db/client";

export type BkTxn = {
  id: string;
  date: string;
  description: string;
  amountCents: number; // signed: + money in, − money out
  vendor: string | null;
  account: string | null;
  categoryId: string | null;
  categoryName: string | null;
  status: string;
  approved: boolean;
  autoSuggested: boolean;
  source: string;
  notes: string | null;
  projectId: string | null;
  projectLabel: string | null;
};
export type BkCategory = { id: string; name: string; type: string };
export type BkVendor = { id: string; name: string };
export type BkProject = { id: string; label: string };
export type PnlRow = { name: string; total: number };

export type BookkeepingData = {
  transactions: BkTxn[];
  categories: BkCategory[];
  vendors: BkVendor[];
  projects: BkProject[];
  connected: boolean;
  provider: string | null;
  summary: { moneyIn: number; moneyOut: number; net: number; uncategorized: number };
  pnl: { income: PnlRow[]; expense: PnlRow[]; totalIncome: number; totalExpense: number; netProfit: number };
  balanceSheet: {
    assets: PnlRow[];
    liabilities: PnlRow[];
    equity: PnlRow[];
    totalAssets: number;
    totalLiabilities: number;
    totalEquity: number;
  };
};

export async function getBookkeepingData(companyId: string): Promise<BookkeepingData> {
  const [txns, categories, vendors, projects, settings] = await Promise.all([
    prisma.transaction.findMany({
      where: { companyId },
      orderBy: { date: "desc" },
      take: 1000,
      include: { category: { select: { id: true, name: true, type: true } } },
    }),
    prisma.bookkeepingCategory.findMany({ where: { companyId }, orderBy: [{ type: "asc" }, { name: "asc" }] }),
    prisma.bookkeepingVendor.findMany({ where: { companyId }, orderBy: { name: "asc" } }),
    prisma.project.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      take: 300,
      select: { id: true, projectNumber: true, lead: { select: { firstName: true, lastName: true } } },
    }),
    prisma.companySettings.findUnique({ where: { companyId }, select: { bookkeepingProvider: true, bookkeepingApiKey: true } }),
  ]);

  const projMap = new Map(projects.map((p) => [p.id, `${p.projectNumber}${p.lead ? ` · ${p.lead.firstName} ${p.lead.lastName}` : ""}`]));

  const transactions: BkTxn[] = txns.map((t) => ({
    id: t.id,
    date: t.date.toISOString(),
    description: t.description,
    amountCents: t.amountCents,
    vendor: t.vendor,
    account: t.account,
    categoryId: t.categoryId,
    categoryName: t.category?.name ?? null,
    status: t.status,
    approved: t.approved,
    autoSuggested: t.autoSuggested,
    source: t.source,
    notes: t.notes,
    projectId: t.projectId,
    projectLabel: t.projectId ? projMap.get(t.projectId) ?? "Deal" : null,
  }));

  // Cash-basis totals + P&L grouped by category.
  let moneyIn = 0, moneyOut = 0, uncategorized = 0;
  const incomeByCat = new Map<string, number>();
  const expenseByCat = new Map<string, number>();
  for (const t of txns) {
    if (t.amountCents >= 0) moneyIn += t.amountCents;
    else moneyOut += -t.amountCents;
    if (!t.categoryId) uncategorized += 1;
    const name = t.category?.name ?? "Uncategorized";
    if (t.amountCents >= 0) incomeByCat.set(name, (incomeByCat.get(name) ?? 0) + t.amountCents);
    else expenseByCat.set(name, (expenseByCat.get(name) ?? 0) + -t.amountCents);
  }
  const toRows = (m: Map<string, number>) => [...m.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total);
  const income = toRows(incomeByCat);
  const expense = toRows(expenseByCat);
  const totalIncome = moneyIn;
  const totalExpense = moneyOut;
  const netProfit = totalIncome - totalExpense;

  // Simplified cash-basis balance sheet: Cash on hand = net of all transactions;
  // retained earnings (equity) = net profit. Assets = Liabilities + Equity.
  const cash = moneyIn - moneyOut;
  const balanceSheet = {
    assets: [{ name: "Cash on hand", total: cash }],
    liabilities: [] as PnlRow[],
    equity: [{ name: "Retained earnings", total: netProfit }],
    totalAssets: cash,
    totalLiabilities: 0,
    totalEquity: netProfit,
  };

  return {
    transactions,
    categories: categories.map((c) => ({ id: c.id, name: c.name, type: c.type })),
    vendors: vendors.map((v) => ({ id: v.id, name: v.name })),
    projects: projects.map((p) => ({ id: p.id, label: projMap.get(p.id)! })),
    connected: !!settings?.bookkeepingApiKey,
    provider: settings?.bookkeepingProvider ?? null,
    summary: { moneyIn, moneyOut, net: moneyIn - moneyOut, uncategorized },
    pnl: { income, expense, totalIncome, totalExpense, netProfit },
    balanceSheet,
  };
}
