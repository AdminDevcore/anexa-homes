import { prisma } from "@/server/db/client";
import { getDealFinancials, getProjectPayout } from "@/server/modules/costs/queries";
import { getScopeEstimatedCostCents } from "@/server/modules/scope/queries";
import { computeDealCommission } from "@/lib/commission";
import { type ReportPeriod, type PnlSegment } from "@/lib/bookkeeping-reports";
import { computeReportsFromDb, jobActivityFromDb } from "./reports-db";

export type BkTxn = {
  id: string;
  date: string;
  description: string;
  amountCents: number; // signed: + money in, − money out
  vendor: string | null;
  account: string | null;
  categoryId: string | null;
  categoryName: string | null;
  /** Department tag. Null = company-level (not attributable to a vertical). */
  vertical: string | null;
  status: string;
  approved: boolean;
  autoSuggested: boolean;
  source: string;
  notes: string | null;
  projectId: string | null;
  projectLabel: string | null;
  attachments: { id: string; name: string }[];
};
export type BkCategory = { id: string; name: string; type: string };
export type BkVendor = {
  id: string;
  name: string;
  companyName: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  einTaxId: string | null;
  is1099: boolean;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  accountNumber: string | null;
  notes: string | null;
};
export type BkProject = { id: string; label: string };
export type PnlRow = { name: string; total: number };

// Per-job book: a project (deal) with its bookkeeping activity rolled up.
export type BkJob = {
  projectId: string;
  leadId: string | null;
  label: string;
  moneyInCents: number;
  moneyOutCents: number;
  netCents: number;
  txnCount: number;
  invoiceCount: number;
  fileCount: number;
  lastActivity: string | null; // ISO — most recent txn/invoice date
};
export type BkInvoice = {
  id: string;
  projectId: string;
  invoiceNumber: string;
  status: string;
  amountCents: number;
  dueAt: string | null;
  paidAt: string | null;
};
export type BkFile = { id: string; projectId: string; name: string; kind: string };
export type BkReconciliation = {
  id: string;
  account: string;
  statementDate: string;
  endingBalanceCents: number;
  beginningBalanceCents: number;
  clearedCount: number;
  createdAt: string;
};

export type BookkeepingData = {
  transactions: BkTxn[];
  categories: BkCategory[];
  vendors: BkVendor[];
  projects: BkProject[];
  jobs: BkJob[];
  invoices: BkInvoice[];
  jobFiles: BkFile[];
  reconciliations: BkReconciliation[];
  /**
   * Whether `transactions` above is the WHOLE ledger or just its newest page.
   *
   * The client's period picker recomputes the P&L locally so a change of period
   * is instant. That is exact only while the page it recomputes over is the
   * whole ledger; past the cap it would report a period that sits below the cut
   * as $0 while the server and the PDF said otherwise. False tells the picker
   * to ask the server instead. See `/api/bookkeeping/reports`.
   */
  ledgerComplete: boolean;
  summary: { moneyIn: number; moneyOut: number; net: number; uncategorized: number; outstanding: number };
  pnl: {
    income: PnlRow[];
    expense: PnlRow[];
    totalIncome: number;
    totalExpense: number;
    netProfit: number;
    /** Per-department breakout; always reconciles to the totals above. */
    segments: PnlSegment[];
  };
  balanceSheet: {
    assets: PnlRow[];
    liabilities: PnlRow[];
    equity: PnlRow[];
    totalAssets: number;
    totalLiabilities: number;
    totalEquity: number;
  };
};

/**
 * How many transactions the ledger TABLE renders. Not a reporting limit — see
 * `reports-db.ts`, which aggregates over the whole ledger regardless.
 */
export const TRANSACTION_PAGE = 1000;

export async function getBookkeepingData(companyId: string, period?: ReportPeriod): Promise<BookkeepingData> {
  const [txns, categories, vendors, projects, recons] = await Promise.all([
    prisma.transaction.findMany({
      where: { companyId },
      orderBy: { date: "desc" },
      /**
       * THE LEDGER TABLE'S PAGE, and nothing else.
       *
       * No total is derived from this array any more. Every figure the P&L,
       * the balance sheet, the top cards and the per-job rollup report now
       * comes from `reports-db.ts`, which aggregates in Postgres over the whole
       * ledger — because applying a reporting period to the newest 1,000 rows
       * silently reports $0 for any period that sits below the cut.
       */
      take: TRANSACTION_PAGE,
      include: {
        category: { select: { id: true, name: true, type: true } },
        attachments: { orderBy: { createdAt: "asc" }, select: { id: true, name: true } },
      },
    }),
    prisma.bookkeepingCategory.findMany({ where: { companyId }, orderBy: [{ type: "asc" }, { name: "asc" }] }),
    prisma.bookkeepingVendor.findMany({ where: { companyId }, orderBy: { name: "asc" } }),
    prisma.project.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      take: 300,
      select: { id: true, leadId: true, projectNumber: true, lead: { select: { id: true, firstName: true, lastName: true } } },
    }),
    prisma.reconciliation.findMany({ where: { companyId }, orderBy: { statementDate: "desc" }, take: 100 }),
  ]);

  const projMap = new Map(projects.map((p) => [p.id, `${p.projectNumber}${p.lead ? ` · ${p.lead.firstName} ${p.lead.lastName}` : ""}`]));

  // Per-job book: invoices for these jobs + any file attached to the job or its deal.
  const projectIds = projects.map((p) => p.id);
  const leadIds = projects.map((p) => p.leadId).filter((id): id is string => !!id);
  const [invoiceRows, fileRows] = await Promise.all([
    projectIds.length
      ? prisma.invoice.findMany({
          where: { companyId, projectId: { in: projectIds } },
          orderBy: { createdAt: "desc" },
          select: { id: true, projectId: true, invoiceNumber: true, status: true, amount: true, dueAt: true, paidAt: true },
        })
      : Promise.resolve([]),
    projectIds.length || leadIds.length
      ? prisma.fileAsset.findMany({
          where: {
            companyId,
            OR: [{ projectId: { in: projectIds } }, { leadId: { in: leadIds } }],
          },
          orderBy: { createdAt: "desc" },
          select: { id: true, name: true, kind: true, projectId: true, leadId: true },
        })
      : Promise.resolve([]),
  ]);

  // Map a file to a job: prefer its projectId, else the project sharing its leadId.
  const projectByLead = new Map(projects.filter((p) => p.leadId).map((p) => [p.leadId!, p.id]));
  const jobFiles: BkFile[] = fileRows
    .map((f): BkFile | null => {
      const projectId = f.projectId ?? (f.leadId ? projectByLead.get(f.leadId) ?? null : null);
      return projectId ? { id: f.id, projectId, name: f.name, kind: String(f.kind) } : null;
    })
    .filter((f): f is BkFile => !!f);

  const invoices: BkInvoice[] = invoiceRows.map((iv) => ({
    id: iv.id,
    projectId: iv.projectId,
    invoiceNumber: iv.invoiceNumber,
    status: iv.status,
    amountCents: iv.amount,
    dueAt: iv.dueAt ? iv.dueAt.toISOString() : null,
    paidAt: iv.paidAt ? iv.paidAt.toISOString() : null,
  }));

  const transactions: BkTxn[] = txns.map((t) => ({
    id: t.id,
    date: t.date.toISOString(),
    description: t.description,
    amountCents: t.amountCents,
    vendor: t.vendor,
    account: t.account,
    categoryId: t.categoryId,
    categoryName: t.category?.name ?? null,
    vertical: t.vertical,
    status: t.status,
    approved: t.approved,
    autoSuggested: t.autoSuggested,
    source: t.source,
    notes: t.notes,
    projectId: t.projectId,
    projectLabel: t.projectId ? projMap.get(t.projectId) ?? "Deal" : null,
    attachments: t.attachments.map((a) => ({ id: a.id, name: a.name })),
  }));

  /**
   * Period-aware P&L, Balance Sheet and the top cards — all from Postgres.
   *
   * Previously summed over `txns`, the capped page above, which made every one
   * of these figures wrong the moment a company passed 1,000 transactions. See
   * `computeReportsFromDb`.
   */
  const dbReports = await computeReportsFromDb(companyId, period);
  const { pnl: pnlReport, balanceSheet } = dbReports;
  const { income, expense, totalIncome, totalExpense, netProfit, segments } = pnlReport;
  const { moneyIn, moneyOut, uncategorized } = dbReports;

  // Roll up each job's bookkeeping activity. A job appears if it has any
  // transaction, invoice, or attached file.
  const invCountByJob = new Map<string, number>();
  for (const iv of invoices) invCountByJob.set(iv.projectId, (invCountByJob.get(iv.projectId) ?? 0) + 1);
  const fileCountByJob = new Map<string, number>();
  for (const f of jobFiles) fileCountByJob.set(f.projectId, (fileCountByJob.get(f.projectId) ?? 0) + 1);

  // Grouped in Postgres for the same reason as the statement above: a job whose
  // transactions had aged off the page reported less than it had taken.
  const jobAgg = await jobActivityFromDb(companyId);

  const jobIds = new Set<string>([...jobAgg.keys(), ...invCountByJob.keys(), ...fileCountByJob.keys()]);

  /**
   * Names for exactly the jobs that appear, however old.
   *
   * `projects` above is the newest 300, which is the right page for a picker
   * and the wrong list for this: now that the rollup groups the whole ledger, a
   * job older than that page would surface with money against it and render as
   * an unlinked "Deal". Fetched by id so the list is bounded by what is
   * actually shown rather than by an arbitrary recency window.
   */
  const jobProjects = jobIds.size
    ? await prisma.project.findMany({
        where: { companyId, id: { in: [...jobIds] } },
        select: {
          id: true,
          leadId: true,
          projectNumber: true,
          lead: { select: { firstName: true, lastName: true } },
        },
      })
    : [];
  const jobLabel = new Map(
    jobProjects.map((p) => [
      p.id,
      `${p.projectNumber}${p.lead ? ` · ${p.lead.firstName} ${p.lead.lastName}` : ""}`,
    ])
  );
  const projectLeadId = new Map(jobProjects.map((p) => [p.id, p.leadId]));
  const jobs: BkJob[] = [...jobIds]
    .map((projectId) => {
      const a = jobAgg.get(projectId);
      return {
        projectId,
        leadId: projectLeadId.get(projectId) ?? null,
        label: jobLabel.get(projectId) ?? projMap.get(projectId) ?? "Deal",
        moneyInCents: a?.in ?? 0,
        moneyOutCents: a?.out ?? 0,
        netCents: (a?.in ?? 0) - (a?.out ?? 0),
        txnCount: a?.count ?? 0,
        invoiceCount: invCountByJob.get(projectId) ?? 0,
        fileCount: fileCountByJob.get(projectId) ?? 0,
        lastActivity: a?.last ? new Date(a.last).toISOString() : null,
      };
    })
    .sort((x, y) => (y.lastActivity ?? "").localeCompare(x.lastActivity ?? ""));

  return {
    transactions,
    categories: categories.map((c) => ({ id: c.id, name: c.name, type: c.type })),
    vendors: vendors.map((v) => ({
      id: v.id, name: v.name, companyName: v.companyName, contactName: v.contactName,
      email: v.email, phone: v.phone, einTaxId: v.einTaxId, is1099: v.is1099,
      address: v.address, city: v.city, state: v.state, zip: v.zip,
      accountNumber: v.accountNumber, notes: v.notes,
    })),
    projects: projects.map((p) => ({ id: p.id, label: projMap.get(p.id)! })),
    jobs,
    invoices,
    jobFiles,
    reconciliations: recons.map((r) => ({
      id: r.id,
      account: r.account,
      statementDate: r.statementDate.toISOString(),
      endingBalanceCents: r.endingBalanceCents,
      beginningBalanceCents: r.beginningBalanceCents,
      clearedCount: r.clearedCount,
      createdAt: r.createdAt.toISOString(),
    })),
    ledgerComplete: txns.length < TRANSACTION_PAGE,
    summary: {
      moneyIn,
      moneyOut,
      net: moneyIn - moneyOut,
      uncategorized,
      // Money left to collect = issued (sent) invoices not yet paid.
      outstanding: invoices.filter((iv) => iv.status === "sent").reduce((s, iv) => s + iv.amountCents, 0),
    },
    pnl: { income, expense, totalIncome, totalExpense, netProfit, segments },
    balanceSheet,
  };
}

// ── Per-job settlement: "what's left for us" ────────────────────────────────
// Reuses the DEAL's own financials (getDealFinancials) so these numbers match the
// deal page exactly: job cost comes from bookkeeping, overhead is removed, and the
// rep commission is the same split the deal shows (estimate until real commission
// records exist, then the actual lines + overrides). Also computes how much of the
// collectible is still owed (left to collect) vs. already collected (money in).

export type JobSettlementLine = { id: string; label: string | null; recipient: string; amountCents: number; status: string };
export type JobSettlement = {
  projectId: string;
  contractCents: number;
  supplementCents: number;
  deductibleCents: number;
  collectibleCents: number; // expected total to collect (contract + supplement + deductible)
  jobCostCents: number; // ACTUAL job cost from bookkeeping (matches the deal)
  estCostCents: number; // ESTIMATED job cost from the scope cost template (falls back to actual)
  overheadCents: number;
  paFeeCents: number; // public-adjuster fee on the supplement (matches the deal)
  repName: string | null;
  repSplitPct: number | null; // the rep's split % of the pool on this deal
  repDeductiblePct: number | null; // the rep's separate % of the deductible
  repWaivesSupplement: boolean; // rep waived the supplement (paid early, excluded from their pool)
  supplementWaivedKeptCents: number; // supplement net the company keeps when waived (0 otherwise)
  companyProvidedLead: boolean; // provided-lead vs self-gen split
  commissionEstimateCents: number; // REP estimate from split rules (pre-generation)
  commissionActualCents: number; // sum of ALL real commission records (rep + overrides + crew)
  repCommissionActualCents: number; // just the assigned rep's generated commission
  hasActualCommission: boolean;
  commissionLines: JobSettlementLine[];
  collectedCents: number; // money already collected (money-in transactions)
  leftToCollectCents: number; // collectible − collected
  companyProfitCents: number; // collectible − jobCost − overhead − paFee − commission
};

/**
 * Settlements for the given jobs, keyed by projectId. Each reuses getDealFinancials
 * + getProjectPayout so it matches the deal's Financials/Payout. `jobs` carries the
 * money already collected (money-in) so we can show "left to collect".
 */
export async function getJobSettlements(
  companyId: string,
  jobs: { projectId: string; moneyInCents: number; leadId?: string | null }[]
): Promise<Record<string, JobSettlement>> {
  if (jobs.length === 0) return {};

  const results = await Promise.all(
    jobs.map(async (job) => {
      const f = await getDealFinancials(companyId, job.projectId);
      if (!f) return null;
      const payout = await getProjectPayout(companyId, job.projectId);
      // Estimated cost from the scope (falls back to the actual booked cost).
      const estCostRaw = job.leadId ? await getScopeEstimatedCostCents(companyId, job.leadId) : null;
      // `??` doesn't catch NaN — guard explicitly so a bad scope total can never poison profit.
      const estCost = estCostRaw != null && Number.isFinite(estCostRaw) ? estCostRaw : f.jobCostCents;
      const dc = f.breakdown;
      const collectible = dc.revenueCents;
      const hasActual = payout.lines.length > 0;
      // The assigned rep's OWN generated commission (excludes overrides/crew).
      const repCommissionActual = f.rep
        ? payout.lines.filter((l) => l.userId === f.rep!.id).reduce((s, l) => s + l.amount, 0)
        : 0;
      // Estimated rep commission, recomputed on the ESTIMATED-cost pool (the
      // report's estimate uses scope cost; the deal's own breakdown uses ACTUAL
      // booked cost). Reuses the exact engine so it respects the supplement waiver
      // and the rep's separate deductible %.
      const estDc = computeDealCommission({
        baseCents: f.contractValue,
        supplementCents: f.supplementCents,
        deductibleCents: f.deductibleCents,
        costCents: estCost,
        overheadPct: f.overheadPct,
        paFeePct: f.paFeePct,
        repSplitPct: f.rep?.splitPct ?? 0,
        repDeductiblePct: f.rep?.deductiblePct ?? 0,
        repWaivesSupplement: !f.repGetsSupplement,
      });
      const commissionEstimate = estDc.repCommissionCents;
      // Amount the company keeps from a waived supplement (pool minus rep basis).
      const supplementWaivedKept = estDc.poolCents - estDc.repPoolBasisCents;

      const commission = hasActual ? payout.total : commissionEstimate;
      // Company profit = revenue − cost − PA fee − commission. Overhead is RETAINED
      // by the company (not an external cost), so it stays inside company profit
      // (= company overhead + the company's share of the split).
      const companyProfit = collectible - f.jobCostCents - dc.paFeeCents - commission;

      const settlement: JobSettlement = {
        projectId: job.projectId,
        contractCents: f.contractValue,
        supplementCents: f.supplementCents,
        deductibleCents: f.deductibleCents,
        collectibleCents: collectible,
        jobCostCents: f.jobCostCents,
        estCostCents: estCost,
        overheadCents: dc.overheadCents,
        paFeeCents: dc.paFeeCents,
        repName: f.rep?.name ?? null,
        repSplitPct: f.rep?.splitPct ?? null,
        repDeductiblePct: f.rep?.deductiblePct ?? null,
        repWaivesSupplement: !f.repGetsSupplement,
        supplementWaivedKeptCents: supplementWaivedKept,
        companyProvidedLead: f.companyProvidedLead,
        commissionEstimateCents: commissionEstimate,
        commissionActualCents: payout.total,
        repCommissionActualCents: repCommissionActual,
        hasActualCommission: hasActual,
        commissionLines: payout.lines.map((l) => ({ id: l.id, label: l.label, recipient: l.recipient, amountCents: l.amount, status: l.status })),
        collectedCents: job.moneyInCents,
        leftToCollectCents: collectible - job.moneyInCents,
        companyProfitCents: companyProfit,
      };
      return settlement;
    })
  );

  const out: Record<string, JobSettlement> = {};
  for (const s of results) if (s) out[s.projectId] = s;
  return out;
}
