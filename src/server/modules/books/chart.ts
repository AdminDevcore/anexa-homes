import type { LedgerAccountType, LedgerAccountSubtype } from "@prisma/client";
import { prisma } from "@/server/db/client";

/**
 * THE CHART OF ACCOUNTS for a roofing + solar contractor.
 *
 * Four digits, grouped by leading digit, exactly as docs/architecture/
 * books-build.md settles it:
 *
 *   1000 assets · 2000 liabilities · 3000 equity · 4000 income
 *   5000 job costs (COGS) · 6000 operating · 7000 other income · 8000 other expense
 *
 * ── AN ACCOUNT IS A ROW, NOT AN ENUM BRANCH ─────────────────────────────────
 * Nothing in this codebase branches on a specific account NUMBER. A bookkeeper
 * may add, rename and renumber freely, and more banks, savings accounts and
 * credit cards are added the same way. What the code needs to find, it finds by
 * `systemKey` — a stable handle that survives every rename.
 *
 * ── WHY COMMISSIONS ARE 6000 AND SUBCONTRACTOR LABOUR IS 5000 ───────────────
 * This is the one classification that is easy to get wrong and expensive to
 * fix, and the existing single-entry ledger already had it right (see
 * payroll/post-bookkeeping.ts). A rep's commission is paid OUT OF the job's
 * profit, so booking it as a cost of the job makes every deal look worse the
 * better it was sold. A subcontractor's invoice is the opposite: it is what the
 * job cost to build, the textbook job cost. Same payroll run, same money
 * leaving the same account, opposite treatment in the books.
 */

/**
 * The handles the code resolves accounts by. Adding one here and forgetting to
 * seed it is a type error at the call site, not a runtime surprise.
 */
export const SYSTEM_ACCOUNT_KEYS = [
  "undeposited_funds",
  "accounts_receivable",
  "accounts_payable",
  "credit_cards",
  "commissions_payable",
  "payroll_payable",
  "opening_balance_equity",
  "retained_earnings",
  "owner_contributions",
  "owner_draws",
  "roofing_revenue",
  "solar_revenue",
  "materials",
  "subcontractor_labor",
  "permits",
  "dealer_fees",
  "funding_variance",
  "commissions_expense",
  "commission_chargebacks",
  "payroll_expense",
  "bank_fees",
] as const;

export type SystemAccountKey = (typeof SYSTEM_ACCOUNT_KEYS)[number];

export type SeedAccount = {
  number: string;
  name: string;
  type: LedgerAccountType;
  subtype: LedgerAccountSubtype;
  systemKey?: SystemAccountKey;
  /** The parent's NUMBER. Resolved to an id after the first pass. */
  parent?: string;
  taxLine?: string;
  description?: string;
};

export const SEED_CHART: SeedAccount[] = [
  // ── 1000 ASSETS ───────────────────────────────────────────────────────────
  // The two real bank accounts. Each gets a BankAccount row on top of it, which
  // is what carries the institution, the last 4 and the default vertical.
  { number: "1010", name: "Truist Checking — Roofing", type: "asset", subtype: "bank" },
  { number: "1020", name: "Truist Checking — Solar", type: "asset", subtype: "bank" },
  {
    number: "1050",
    name: "Undeposited Funds",
    type: "asset",
    subtype: "undeposited_funds",
    systemKey: "undeposited_funds",
    description: "Money received but not yet deposited. Cleared by a deposit.",
  },
  {
    number: "1200",
    name: "Accounts Receivable",
    type: "asset",
    subtype: "accounts_receivable",
    systemKey: "accounts_receivable",
    description: "What customers and carriers owe us. Posted by invoices.",
  },
  { number: "1700", name: "Vehicles & Equipment", type: "asset", subtype: "fixed_asset" },

  // ── 2000 LIABILITIES ──────────────────────────────────────────────────────
  {
    number: "2000",
    name: "Accounts Payable",
    type: "liability",
    subtype: "accounts_payable",
    systemKey: "accounts_payable",
    description: "What we owe vendors. Posted by bills.",
  },
  {
    number: "2100",
    name: "Credit Cards",
    type: "liability",
    subtype: "credit_card",
    systemKey: "credit_cards",
    description: "Parent for every company card. A card is a LIABILITY, and each one is a child row.",
  },
  {
    number: "2200",
    name: "Commissions Payable",
    type: "liability",
    subtype: "other_current_liability",
    systemKey: "commissions_payable",
    description: "Approved commission not yet paid. Cleared when the payment goes out.",
  },
  {
    number: "2210",
    name: "Payroll Payable",
    type: "liability",
    subtype: "other_current_liability",
    systemKey: "payroll_payable",
    description: "Approved contractor pay and payroll not yet paid.",
  },
  { number: "2300", name: "Sales Tax Payable", type: "liability", subtype: "other_current_liability" },
  { number: "2500", name: "Loans & Notes Payable", type: "liability", subtype: "long_term_liability" },

  // ── 3000 EQUITY ───────────────────────────────────────────────────────────
  {
    number: "3000",
    name: "Opening Balance Equity",
    type: "equity",
    subtype: "equity",
    systemKey: "opening_balance_equity",
    description:
      "The other side of every opening balance. It should return to zero once the books are truly open; a balance here means an opening balance was never explained.",
  },
  { number: "3100", name: "Owner Contributions", type: "equity", subtype: "equity", systemKey: "owner_contributions" },
  { number: "3200", name: "Owner Draws", type: "equity", subtype: "equity", systemKey: "owner_draws" },
  {
    number: "3900",
    name: "Retained Earnings",
    type: "equity",
    subtype: "equity",
    systemKey: "retained_earnings",
    description: "Prior years' net income. Reports roll income into this at year end; nothing posts here by hand.",
  },

  // ── 4000 INCOME ───────────────────────────────────────────────────────────
  // Revenue is split by vertical here AND tagged on the line. The account gives
  // the CPA a familiar statement; the tag is what makes a combined P&L possible.
  { number: "4000", name: "Roofing Revenue", type: "income", subtype: "income", systemKey: "roofing_revenue" },
  { number: "4100", name: "Solar Revenue", type: "income", subtype: "income", systemKey: "solar_revenue" },
  { number: "4900", name: "Discounts & Allowances", type: "income", subtype: "income" },

  // ── 5000 JOB COSTS (COGS) ─────────────────────────────────────────────────
  { number: "5000", name: "Materials", type: "cogs", subtype: "cogs", systemKey: "materials" },
  {
    number: "5100",
    name: "Subcontractor Labor",
    type: "cogs",
    subtype: "cogs",
    systemKey: "subcontractor_labor",
    description: "What the job cost to build. Job-cost INCLUDED, unlike commission.",
  },
  { number: "5200", name: "Permits & Inspections", type: "cogs", subtype: "cogs", systemKey: "permits" },
  { number: "5300", name: "Equipment Rental", type: "cogs", subtype: "cogs" },
  {
    number: "5400",
    name: "Dealer Fees",
    type: "cogs",
    subtype: "cogs",
    systemKey: "dealer_fees",
    description: "The lender's fee on a financed solar deal — a real cost of that sale.",
  },
  {
    number: "5500",
    name: "Funding Variance",
    type: "cogs",
    subtype: "cogs",
    systemKey: "funding_variance",
    description:
      "Expected funding minus what the lender actually deposited. Never silently absorbed: an unexplained variance is the first sign a deal was funded differently from how it was sold.",
  },

  // ── 6000 OPERATING EXPENSES ───────────────────────────────────────────────
  {
    number: "6000",
    name: "Commissions",
    type: "expense",
    subtype: "expense",
    systemKey: "commissions_expense",
    description:
      "Paid out of the job's profit, so it is NOT a job cost — see the header. Tagged to the deal and the vertical all the same, so job profitability can show it.",
  },
  {
    number: "6010",
    name: "Commission Chargebacks",
    type: "expense",
    subtype: "expense",
    systemKey: "commission_chargebacks",
    description:
      "Recoveries get their own line. Netted into Commissions they would quietly reduce the expense and there would be no way to answer 'how much did we recover this year'.",
  },
  { number: "6100", name: "Payroll", type: "expense", subtype: "expense", systemKey: "payroll_expense" },
  { number: "6110", name: "Payroll Taxes", type: "expense", subtype: "expense" },
  { number: "6200", name: "Advertising & Marketing", type: "expense", subtype: "expense" },
  { number: "6250", name: "Lead Generation", type: "expense", subtype: "expense" },
  { number: "6300", name: "Office & Software", type: "expense", subtype: "expense" },
  { number: "6400", name: "Rent", type: "expense", subtype: "expense" },
  { number: "6450", name: "Utilities", type: "expense", subtype: "expense" },
  { number: "6500", name: "Insurance", type: "expense", subtype: "expense" },
  { number: "6600", name: "Vehicle & Fuel", type: "expense", subtype: "expense" },
  { number: "6700", name: "Professional Fees", type: "expense", subtype: "expense" },
  {
    number: "6800",
    name: "Bank & Merchant Fees",
    type: "expense",
    subtype: "expense",
    systemKey: "bank_fees",
  },
  { number: "6900", name: "Meals & Entertainment", type: "expense", subtype: "expense" },
  { number: "6950", name: "Travel", type: "expense", subtype: "expense" },
  { number: "6990", name: "Dues & Subscriptions", type: "expense", subtype: "expense" },

  // ── 7000 / 8000 OTHER ─────────────────────────────────────────────────────
  { number: "7000", name: "Interest Income", type: "other_income", subtype: "other_income" },
  { number: "7100", name: "Rebates & Incentives", type: "other_income", subtype: "other_income" },
  { number: "8000", name: "Interest Expense", type: "other_expense", subtype: "other_expense" },
  { number: "8100", name: "Depreciation", type: "other_expense", subtype: "other_expense" },
];

/**
 * Create any seed account this company is missing. IDEMPOTENT, and it never
 * touches an account that already exists.
 *
 * That last part matters: a bookkeeper who renames "Office & Software" to
 * "Software" must not have it renamed back on the next deploy. Existence is
 * decided by NUMBER, which is the one thing the seed owns.
 */
export async function ensureChartOfAccounts(companyId: string): Promise<{ created: number }> {
  const existing = await prisma.ledgerAccount.findMany({
    where: { companyId },
    select: { id: true, number: true },
  });
  const idByNumber = new Map(existing.map((a) => [a.number, a.id]));

  let created = 0;
  // Two passes so a child can point at a parent created in the same run,
  // whatever order SEED_CHART happens to list them in.
  for (const account of SEED_CHART) {
    if (idByNumber.has(account.number)) continue;
    const row = await prisma.ledgerAccount.create({
      data: {
        companyId,
        number: account.number,
        name: account.name,
        type: account.type,
        subtype: account.subtype,
        systemKey: account.systemKey ?? null,
        taxLine: account.taxLine ?? null,
        description: account.description ?? null,
      },
      select: { id: true },
    });
    idByNumber.set(account.number, row.id);
    created += 1;
  }

  for (const account of SEED_CHART) {
    if (!account.parent) continue;
    const id = idByNumber.get(account.number);
    const parentId = idByNumber.get(account.parent);
    if (!id || !parentId) continue;
    await prisma.ledgerAccount.update({ where: { id }, data: { parentId } });
  }

  return { created };
}

/**
 * The id of a system account, or null when this company has not been seeded.
 *
 * Posting routines take the id from here rather than hard-coding a number, so
 * renumbering the chart cannot break a posting path.
 */
export async function systemAccountId(
  companyId: string,
  key: SystemAccountKey
): Promise<string | null> {
  const account = await prisma.ledgerAccount.findFirst({
    where: { companyId, systemKey: key },
    select: { id: true },
  });
  return account?.id ?? null;
}

/** Normal balance: which side increases this class of account. */
export function normalBalance(type: LedgerAccountType): "debit" | "credit" {
  switch (type) {
    case "asset":
    case "cogs":
    case "expense":
    case "other_expense":
      return "debit";
    case "liability":
    case "equity":
    case "income":
    case "other_income":
      return "credit";
  }
}

/** Which statement an account belongs on. */
export function statementOf(type: LedgerAccountType): "balance_sheet" | "profit_and_loss" {
  return type === "asset" || type === "liability" || type === "equity"
    ? "balance_sheet"
    : "profit_and_loss";
}
