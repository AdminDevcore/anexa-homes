import type { Prisma, Role } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { wonLeadFilter } from "@/server/modules/pipeline/sale-line";
import { managerTeamUserFilter } from "@/server/rbac/policies";
import { getCommissionLiability } from "./queries";
import { ledgerVerticalFilter } from "./vertical-filter";

// Whole-dollar formatting keeps reports scannable.
const usd = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
const pct = (n: number) => `${n.toFixed(1)}%`;

export type ReportType = "executive" | "operations" | "financial" | "payroll";
export type Metric = {
  label: string;
  value: string;
  tone?: "pos" | "neg" | "muted";
  hint?: string;
  // Trend (Executive Summary): % change vs the previous equal-length period and a
  // mini series over the last several periods for a sparkline. lowerIsBetter flips
  // the good/bad coloring (e.g. Cash out going down is good).
  deltaPct?: number;
  series?: number[];
  lowerIsBetter?: boolean;
};
export type ReportTable = { title: string; columns: string[]; rows: (string | number)[][] };
/** A report's renderable payload — what PDF/CSV exporters consume. */
export type RenderableReport = {
  title: string;
  periodLabel: string;
  scopeLabel: string;
  metrics: Metric[];
  tables: ReportTable[];
};
export type ReportResult = RenderableReport & {
  type: ReportType;
};

export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  executive: "Executive Summary",
  operations: "Operations",
  financial: "Financial",
  payroll: "Payroll",
};

const FINANCE_ROLES: Role[] = ["super_admin", "admin", "accounting"];

/** Report types this role may view. */
export function allowedReportTypes(role: Role): ReportType[] {
  const types: ReportType[] = ["operations"];
  if (["super_admin", "admin", "accounting", "manager"].includes(role)) types.push("financial");
  if (FINANCE_ROLES.includes(role)) types.push("payroll");
  return types;
}

/**
 * Standalone report sections this role may open as its own page — the same set
 * as {@link allowedReportTypes} plus the Executive Summary scorecard for
 * finance-capable roles. Order here is the hub display order.
 */
export function allowedSections(role: Role): ReportType[] {
  const types = allowedReportTypes(role);
  return [...(types.includes("financial") ? (["executive"] as ReportType[]) : []), ...types];
}

type ReportUser = { companyId: string; userId: string; role: Role };

// ── Period ──────────────────────────────────────────────────────────────────

// Lives in ./period so screens that are not Reports can share the window — the
// Team Performance page needs it and is not a Report. Re-exported because every
// report builder imports `Period` from here.
import type { Period } from "./period";
export { resolvePeriod } from "./period";
export type { Period };

// ── Scope (Company / Rep / Manager-team), permission-aware ───────────────────

export type ScopeOption = { value: string; label: string };
export type ResolvedScope = {
  value: string;
  label: string;
  leadWhere: Prisma.LeadWhereInput; // includes companyId
  userIds: string[] | null; // people whose commission/payroll counts; null = everyone
  isCompany: boolean;
};

/** The scope options this viewer may choose. */
export async function getScopeOptions(user: ReportUser): Promise<ScopeOption[]> {
  if (user.role === "sales_rep" || user.role === "canvasser") {
    return [{ value: `rep:${user.userId}`, label: "Me" }];
  }
  if (user.role === "manager") {
    const team = await prisma.user.findMany({
      where: { companyId: user.companyId, OR: [{ id: user.userId }, { managerId: user.userId }, { salesRep: { managerId: user.userId } }], status: "active" },
      orderBy: { firstName: "asc" },
      select: { id: true, firstName: true, lastName: true },
    });
    return [
      { value: `team:${user.userId}`, label: "My team" },
      ...team.map((u) => ({ value: `rep:${u.id}`, label: `${u.firstName} ${u.lastName}`.trim() })),
    ];
  }
  // Finance / leadership: company + every rep + every manager's team.
  const [reps, managers] = await Promise.all([
    prisma.user.findMany({ where: { companyId: user.companyId, role: { in: ["sales_rep", "canvasser"] }, status: "active" }, orderBy: { firstName: "asc" }, select: { id: true, firstName: true, lastName: true } }),
    prisma.user.findMany({ where: { companyId: user.companyId, role: "manager", status: "active" }, orderBy: { firstName: "asc" }, select: { id: true, firstName: true, lastName: true } }),
  ]);
  return [
    { value: "company", label: "Whole company" },
    ...managers.map((m) => ({ value: `team:${m.id}`, label: `${m.firstName} ${m.lastName}'s team`.trim() })),
    ...reps.map((r) => ({ value: `rep:${r.id}`, label: `${r.firstName} ${r.lastName}`.trim() })),
  ];
}

async function teamUserIds(companyId: string, managerId: string): Promise<string[]> {
  const team = await prisma.user.findMany({
    where: { companyId, OR: [{ id: managerId }, { managerId }, { salesRep: { managerId } }] },
    select: { id: true },
  });
  return team.map((u) => u.id);
}

/** Resolve a scope value to filters, enforcing what the viewer may see. */
export async function resolveScope(user: ReportUser, value?: string): Promise<ResolvedScope> {
  const base: Prisma.LeadWhereInput = { companyId: user.companyId };
  const repScope = (repId: string, label: string): ResolvedScope => ({
    value: `rep:${repId}`,
    label,
    leadWhere: { ...base, OR: [{ assignedRepId: repId }, { createdBy: { salesRepId: repId } }] },
    userIds: [repId],
    isCompany: false,
  });

  // Rep / canvasser: always only themselves.
  if (user.role === "sales_rep" || user.role === "canvasser") {
    return repScope(user.userId, "Me");
  }

  // Manager: team or a rep within the team.
  if (user.role === "manager") {
    if (value?.startsWith("rep:")) {
      const repId = value.slice(4);
      const ids = await teamUserIds(user.companyId, user.userId);
      if (ids.includes(repId)) {
        const u = await prisma.user.findUnique({ where: { id: repId }, select: { firstName: true, lastName: true } });
        return repScope(repId, u ? `${u.firstName} ${u.lastName}`.trim() : "Rep");
      }
    }
    const ids = await teamUserIds(user.companyId, user.userId);
    return {
      value: `team:${user.userId}`,
      label: "My team",
      leadWhere: { ...base, OR: [{ assignedRep: managerTeamUserFilter(user.userId) }, { createdBy: managerTeamUserFilter(user.userId) }] },
      userIds: ids,
      isCompany: false,
    };
  }

  // Finance / leadership.
  if (value?.startsWith("rep:")) {
    const repId = value.slice(4);
    const u = await prisma.user.findUnique({ where: { id: repId, companyId: user.companyId }, select: { firstName: true, lastName: true } });
    if (u) return repScope(repId, `${u.firstName} ${u.lastName}`.trim());
  }
  if (value?.startsWith("team:")) {
    const managerId = value.slice(5);
    const m = await prisma.user.findUnique({ where: { id: managerId, companyId: user.companyId }, select: { firstName: true, lastName: true } });
    if (m) {
      const ids = await teamUserIds(user.companyId, managerId);
      return {
        value: `team:${managerId}`,
        label: `${m.firstName} ${m.lastName}'s team`.trim(),
        leadWhere: { ...base, OR: [{ assignedRep: managerTeamUserFilter(managerId) }, { createdBy: managerTeamUserFilter(managerId) }] },
        userIds: ids,
        isCompany: false,
      };
    }
  }
  // Default = whole company.
  return { value: "company", label: "Whole company", leadWhere: base, userIds: null, isCompany: true };
}

/** Project ids that belong to the scope (for tagging transactions by rep/team). */
async function scopeProjectIds(scope: ResolvedScope): Promise<string[] | null> {
  if (scope.isCompany) return null; // no filter — all company transactions
  const projects = await prisma.project.findMany({ where: { lead: scope.leadWhere }, select: { id: true } });
  return projects.map((p) => p.id);
}

// ── Report builders ──────────────────────────────────────────────────────────

export async function buildReport(user: ReportUser, type: ReportType, period: Period, scope: ResolvedScope): Promise<ReportResult> {
  if (type === "financial") return buildFinancial(user, period, scope);
  if (type === "payroll") return buildPayroll(user, period, scope);
  return buildOperations(user, period, scope);
}

/** Build a single standalone section, including the Executive Summary scorecard. */
export async function buildReportSection(user: ReportUser, type: ReportType, period: Period, scope: ResolvedScope): Promise<ReportResult> {
  if (type === "executive") return buildExecutive(user, period, scope);
  return buildReport(user, type, period, scope);
}

export type MasterReport = {
  title: string;
  periodLabel: string;
  scopeLabel: string;
  sections: ReportResult[];
};

/**
 * One combined company report: every section the viewer is allowed to see
 * (operations / financial / payroll), for the same period + scope. A sales rep
 * gets operations only; finance roles get all three.
 */
export async function buildMasterReport(user: ReportUser, period: Period, scope: ResolvedScope): Promise<MasterReport> {
  const types = allowedReportTypes(user.role);
  // Finance-capable roles get the at-a-glance Executive Summary on top.
  const showExecutive = types.includes("financial");
  const [executive, sections] = await Promise.all([
    showExecutive ? buildExecutive(user, period, scope) : Promise.resolve(null),
    Promise.all(types.map((t) => buildReport(user, t, period, scope))),
  ]);
  return {
    title: "Company Report",
    periodLabel: period.label,
    scopeLabel: scope.label,
    sections: [...(executive ? [executive] : []), ...sections],
  };
}

// ── Executive summary ────────────────────────────────────────────────────────
// The owner's at-a-glance scorecard: sales, cash, profitability, backlog, and
// liabilities for the period — the numbers you check to know company health.
async function buildExecutive(user: ReportUser, period: Period, scope: ResolvedScope): Promise<ReportResult> {
  const inPeriod = { gte: period.from, lte: period.to };
  const leadWhere = scope.leadWhere;
  const projectWhere: Prisma.ProjectWhereInput = { companyId: user.companyId, lead: leadWhere };
  const projIds = await scopeProjectIds(scope);
  // `projIds` is null for a company-wide scope, which used to mean NO filter at
  // all — that is how both verticals' money ended up in one report. The ledger
  // filter is unconditional for exactly that reason.
  const txnProjectFilter = {
    ...(projIds ? { projectId: { in: projIds } } : {}),
    ...(await ledgerVerticalFilter()),
  };
  // Backlog = signed work not yet finished, keyed off the deal's PIPELINE
  // STAGE: a job counts until its deal reaches a won stage (Paid / Closed) or a
  // lost one (Cancelled). A job whose deal has no stage still counts — it is
  // signed work that has not been finished.
  //
  // It used to key off `Project.status`, a second status that duplicated the
  // pipeline (which already has In Production, QC Inspection, Paid and
  // Cancelled as stages) and had to be advanced by hand in a separate control
  // on the deal page. That control is gone; `Project.status` survives only as a
  // field inside the admin Edit Job dialog, so it now drifts from reality the
  // moment nobody remembers to open that dialog. The stage is moved every day
  // because it IS the pipeline, which makes it the honest input for a money
  // figure.

  // Won is decided by the deal's STAGE — `Lead.status` has a `won` value that
  // nothing in the app writes, so every count built on it read zero. See
  // lib/sold-stage.ts.
  const isWon = await wonLeadFilter(user.companyId);

  const [appts, won, soldAgg, activeProjects, txns, collectedAgg, liability, leadsBySource, wonBySource] = await Promise.all([
    prisma.lead.count({ where: { ...leadWhere, createdAt: inPeriod } }),
    prisma.lead.count({ where: { ...leadWhere, ...isWon, createdAt: inPeriod } }),
    prisma.project.aggregate({ where: { ...projectWhere, createdAt: inPeriod }, _sum: { contractValue: true }, _count: { _all: true } }),
    prisma.project.findMany({
      where: { ...projectWhere, status: { notIn: ["cancelled"] } },
      select: {
        contractValue: true,
        deductibleCents: true,
        supplementCents: true,
        lead: { select: { stage: { select: { isWon: true, isLost: true } } } },
      },
    }),
    prisma.transaction.findMany({ where: { companyId: user.companyId, date: inPeriod, ...txnProjectFilter }, select: { amountCents: true } }),
    prisma.transaction.aggregate({ where: { companyId: user.companyId, amountCents: { gt: 0 }, ...txnProjectFilter }, _sum: { amountCents: true } }),
    getCommissionLiability(user.companyId, scope),
    prisma.lead.groupBy({ by: ["sourceId"], where: { ...leadWhere, createdAt: inPeriod }, _count: { _all: true } }),
    prisma.lead.groupBy({ by: ["sourceId"], where: { ...leadWhere, ...isWon, createdAt: inPeriod }, _count: { _all: true } }),
  ]);

  let moneyIn = 0, moneyOut = 0;
  for (const t of txns) { if (t.amountCents >= 0) moneyIn += t.amountCents; else moneyOut += -t.amountCents; }
  const net = moneyIn - moneyOut;
  const contracted = soldAgg._sum.contractValue ?? 0;
  const jobsSold = soldAgg._count._all;
  const avgJob = jobsSold > 0 ? Math.round(contracted / jobsSold) : 0;
  const closingRate = appts > 0 ? (won / appts) * 100 : 0;

  // ── Trend: last 8 equal-length windows ending at period.to (uniform for any
  // preset). The final window == the current period, so each series ends on the
  // card's value; the delta compares the last two windows.
  type Bucket = { contracted: number; collected: number; cashOut: number; net: number; jobsSold: number; closingRate: number };
  const dur = Math.max(86_400_000, period.to.getTime() - period.from.getTime());
  const N = 8;
  async function bucketStats(from: Date, to: Date): Promise<Bucket> {
    const w = { gte: from, lte: to };
    const [a, wn, sold, btxns] = await Promise.all([
      prisma.lead.count({ where: { ...leadWhere, createdAt: w } }),
      prisma.lead.count({ where: { ...leadWhere, ...isWon, createdAt: w } }),
      prisma.project.aggregate({ where: { ...projectWhere, createdAt: w }, _sum: { contractValue: true }, _count: { _all: true } }),
      prisma.transaction.findMany({ where: { companyId: user.companyId, date: w, ...txnProjectFilter }, select: { amountCents: true } }),
    ]);
    let ci = 0, co = 0;
    for (const t of btxns) { if (t.amountCents >= 0) ci += t.amountCents; else co += -t.amountCents; }
    return { contracted: sold._sum.contractValue ?? 0, collected: ci, cashOut: co, net: ci - co, jobsSold: sold._count._all, closingRate: a > 0 ? (wn / a) * 100 : 0 };
  }
  const windows = Array.from({ length: N }, (_, k) => {
    const to = new Date(period.to.getTime() - (N - 1 - k) * dur);
    return { from: new Date(to.getTime() - dur), to };
  });
  const buckets = await Promise.all(windows.map((win) => bucketStats(win.from, win.to)));
  const series = (pick: (b: Bucket) => number) => buckets.map(pick);
  const delta = (pick: (b: Bucket) => number) => {
    const cur = pick(buckets[N - 1]); const prev = pick(buckets[N - 2]);
    return prev !== 0 ? ((cur - prev) / Math.abs(prev)) * 100 : cur > 0 ? 100 : cur < 0 ? -100 : 0;
  };

  const backlog = activeProjects
    .filter((p) => !p.lead?.stage?.isWon && !p.lead?.stage?.isLost)
    .reduce((s, p) => s + p.contractValue, 0);
  const supplement = activeProjects.reduce((s, p) => s + p.supplementCents, 0);
  const collectible = activeProjects.reduce((s, p) => s + p.contractValue + p.deductibleCents + p.supplementCents, 0);
  const collected = collectedAgg._sum.amountCents ?? 0;
  const ar = Math.max(0, collectible - collected);
  const commOwed = liability.lockedInCents + liability.estimatedCents;
  const netMargin = moneyIn > 0 ? (net / moneyIn) * 100 : 0;

  // Marketing ROI: leads + close rate per source.
  const wonCountBySource = new Map<string | null, number>(wonBySource.map((s) => [s.sourceId, s._count._all]));
  const sourceIds = leadsBySource.map((s) => s.sourceId).filter((x): x is string => !!x);
  const sourceNames = sourceIds.length
    ? await prisma.leadSource.findMany({ where: { id: { in: sourceIds } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(sourceNames.map((s) => [s.id, s.name]));
  const sourceRows = leadsBySource
    .map((s) => {
      const leads = s._count._all;
      const w = wonCountBySource.get(s.sourceId) ?? 0;
      return { name: s.sourceId ? (nameById.get(s.sourceId) ?? "Other") : "Direct / unattributed", leads, won: w };
    })
    .sort((a, b) => b.leads - a.leads);

  return {
    type: "executive",
    title: "Executive Summary",
    periodLabel: period.label,
    scopeLabel: scope.label,
    metrics: [
      { label: "Revenue contracted", value: usd(contracted), tone: "pos", hint: "sold in period", deltaPct: delta((b) => b.contracted), series: series((b) => b.contracted) },
      { label: "Jobs sold", value: String(jobsSold), hint: "in period", deltaPct: delta((b) => b.jobsSold), series: series((b) => b.jobsSold) },
      { label: "Avg job size", value: usd(avgJob) },
      { label: "Closing rate", value: pct(closingRate), hint: "won / appts", deltaPct: delta((b) => b.closingRate), series: series((b) => b.closingRate) },
      { label: "Revenue collected", value: usd(moneyIn), tone: "pos", hint: "cash in", deltaPct: delta((b) => b.collected), series: series((b) => b.collected) },
      { label: "Cash out", value: usd(moneyOut), tone: "neg", hint: "in period", deltaPct: delta((b) => b.cashOut), series: series((b) => b.cashOut), lowerIsBetter: true },
      { label: "Net cash", value: usd(net), tone: net >= 0 ? "pos" : "neg", hint: "in period", deltaPct: delta((b) => b.net), series: series((b) => b.net) },
      { label: "Net margin", value: pct(netMargin), tone: netMargin >= 0 ? "pos" : "neg" },
      { label: "Signed backlog", value: usd(backlog), hint: "in progress" },
      { label: "Left to collect", value: usd(ar), hint: "A/R, current" },
      { label: "Commission liability", value: usd(commOwed), tone: "neg", hint: "owed" },
      { label: "Supplements approved", value: usd(supplement), tone: "pos", hint: "current" },
    ],
    tables: [
      {
        title: "Cash flow (in period)",
        columns: ["Flow", "Amount"],
        rows: [
          ["Money in", usd(moneyIn)],
          ["Money out", usd(moneyOut)],
          ["Net cash", usd(net)],
        ],
      },
      {
        title: "Lead sources (in period)",
        columns: ["Source", "Leads", "Won", "Close rate"],
        rows: sourceRows.map((r) => [r.name, r.leads, r.won, pct(r.leads > 0 ? (r.won / r.leads) * 100 : 0)]),
      },
    ],
  };
}

async function buildOperations(user: ReportUser, period: Period, scope: ResolvedScope): Promise<ReportResult> {
  const inPeriod = { gte: period.from, lte: period.to };
  const leadWhere = scope.leadWhere;
  const projectWhere: Prisma.ProjectWhereInput = { companyId: user.companyId, lead: leadWhere };

  const [appts, won, jobsSold, inProduction, completed, byStatus, projectsForRep] = await Promise.all([
    prisma.lead.count({ where: { ...leadWhere, createdAt: inPeriod } }),
    prisma.lead.count({ where: { ...leadWhere, ...(await wonLeadFilter(user.companyId)), createdAt: inPeriod } }),
    prisma.project.count({ where: { ...projectWhere, createdAt: inPeriod } }),
    prisma.project.count({ where: { ...projectWhere, status: "in_production" } }),
    prisma.project.count({ where: { ...projectWhere, status: { in: ["completed", "closed"] } } }),
    prisma.project.groupBy({ by: ["status"], where: projectWhere, _count: { _all: true } }),
    prisma.project.findMany({ where: projectWhere, select: { contractValue: true, lead: { select: { assignedRep: { select: { firstName: true, lastName: true } } } } } }),
  ]);

  const closingRate = appts > 0 ? (won / appts) * 100 : 0;

  // By rep: jobs + contract value.
  const repAgg = new Map<string, { jobs: number; revenue: number }>();
  for (const p of projectsForRep) {
    const rep = p.lead?.assignedRep ? `${p.lead.assignedRep.firstName} ${p.lead.assignedRep.lastName}`.trim() : "Unassigned";
    const a = repAgg.get(rep) ?? { jobs: 0, revenue: 0 };
    a.jobs += 1;
    a.revenue += p.contractValue;
    repAgg.set(rep, a);
  }

  return {
    type: "operations",
    title: "Operations Report",
    periodLabel: period.label,
    scopeLabel: scope.label,
    metrics: [
      { label: "Appointments", value: String(appts), hint: "created in period" },
      { label: "Won", value: String(won), tone: "pos" },
      { label: "Closing rate", value: pct(closingRate) },
      { label: "Jobs sold", value: String(jobsSold), hint: "in period" },
      { label: "In production", value: String(inProduction), hint: "current" },
      { label: "Completed", value: String(completed), hint: "current" },
    ],
    tables: [
      {
        title: "Jobs by status (current)",
        columns: ["Status", "Jobs"],
        rows: byStatus.map((s) => [s.status.replace(/_/g, " "), s._count._all]),
      },
      {
        title: "By rep",
        columns: ["Rep", "Jobs", "Contract value"],
        rows: [...repAgg.entries()].sort((a, b) => b[1].revenue - a[1].revenue).map(([rep, a]) => [rep, a.jobs, usd(a.revenue)]),
      },
    ],
  };
}

async function buildFinancial(user: ReportUser, period: Period, scope: ResolvedScope): Promise<ReportResult> {
  const inPeriod = { gte: period.from, lte: period.to };
  const projIds = await scopeProjectIds(scope);
  // `projIds` is null for a company-wide scope, which used to mean NO filter at
  // all — that is how both verticals' money ended up in one report. The ledger
  // filter is unconditional for exactly that reason.
  const txnProjectFilter = {
    ...(projIds ? { projectId: { in: projIds } } : {}),
    ...(await ledgerVerticalFilter()),
  };

  // 1099 / subcontractor vendor names — for "contractor payments".
  const vendors1099 = await prisma.bookkeepingVendor.findMany({ where: { companyId: user.companyId, is1099: true }, select: { name: true } });
  const contractorNames = new Set(vendors1099.map((v) => v.name.toLowerCase()));

  const [txns, commissionPaid, liability, activeProjects, collectedAgg] = await Promise.all([
    prisma.transaction.findMany({ where: { companyId: user.companyId, date: inPeriod, ...txnProjectFilter }, select: { amountCents: true, vendor: true, category: { select: { name: true } } } }),
    prisma.commission.aggregate({ where: { companyId: user.companyId, status: "paid", paidAt: inPeriod, ...(scope.userIds ? { userId: { in: scope.userIds } } : {}) }, _sum: { amount: true } }),
    // Owed = generated-unpaid + estimated on active deals (the real liability).
    getCommissionLiability(user.companyId, scope),
    // Active deals' expected collectible (current snapshot).
    prisma.project.findMany({ where: { companyId: user.companyId, lead: scope.leadWhere, status: { notIn: ["cancelled"] } }, select: { contractValue: true, deductibleCents: true, supplementCents: true } }),
    // Money already collected on those deals = positive transactions tagged to them.
    prisma.transaction.aggregate({ where: { companyId: user.companyId, amountCents: { gt: 0 }, ...txnProjectFilter }, _sum: { amountCents: true } }),
  ]);

  let moneyIn = 0, moneyOut = 0, contractor = 0;
  const expenseByCat = new Map<string, number>();
  // Contractor spend split per contractor: by 1099 vendor name, else by category.
  const contractorByName = new Map<string, number>();
  for (const t of txns) {
    if (t.amountCents >= 0) moneyIn += t.amountCents;
    else {
      const out = -t.amountCents;
      moneyOut += out;
      const cat = t.category?.name ?? "Uncategorized";
      expenseByCat.set(cat, (expenseByCat.get(cat) ?? 0) + out);
      const is1099Vendor = !!(t.vendor && contractorNames.has(t.vendor.toLowerCase()));
      const isContractor = is1099Vendor || /contractor|subcontractor|labor|crew/i.test(t.category?.name ?? "");
      if (isContractor) {
        contractor += out;
        const bucket = is1099Vendor ? t.vendor! : cat;
        contractorByName.set(bucket, (contractorByName.get(bucket) ?? 0) + out);
      }
    }
  }

  const collectible = activeProjects.reduce((s, p) => s + p.contractValue + p.deductibleCents + p.supplementCents, 0);
  const collected = collectedAgg._sum.amountCents ?? 0;
  const leftToCollect = Math.max(0, collectible - collected);
  const commPaid = commissionPaid._sum.amount ?? 0;
  const commOwed = liability.lockedInCents + liability.estimatedCents;
  const net = moneyIn - moneyOut;

  return {
    type: "financial",
    title: "Financial Report",
    periodLabel: period.label,
    scopeLabel: scope.label,
    metrics: [
      { label: "Revenue collected", value: usd(moneyIn), tone: "pos", hint: "in period" },
      { label: "Left to collect", value: usd(leftToCollect), hint: "current" },
      { label: "Commissions paid", value: usd(commPaid), tone: "neg", hint: "in period" },
      { label: "Commissions owed", value: usd(commOwed), hint: "generated + estimated" },
      { label: "Contractor payments", value: usd(contractor), tone: "neg", hint: "in period" },
      { label: "Net cash", value: usd(net), tone: net >= 0 ? "pos" : "neg", hint: "in period" },
    ],
    tables: [
      {
        title: "Commissions owed — locked-in vs. estimated",
        columns: ["Rep", "Locked-in", "Estimated", "Total"],
        rows: [
          ...liability.byRep.map((r) => [r.name, usd(r.lockedInCents), usd(r.estimatedCents), usd(r.lockedInCents + r.estimatedCents)]),
          ["Total", usd(liability.lockedInCents), usd(liability.estimatedCents), usd(commOwed)],
        ],
      },
      {
        title: "Contractor payments by contractor (in period)",
        columns: ["Contractor", "Amount"],
        rows: [...contractorByName.entries()].sort((a, b) => b[1] - a[1]).map(([name, amt]) => [name, usd(amt)]),
      },
      {
        title: "Expenses by category (in period)",
        columns: ["Category", "Amount"],
        rows: [...expenseByCat.entries()].sort((a, b) => b[1] - a[1]).map(([cat, amt]) => [cat, usd(amt)]),
      },
    ],
  };
}

async function buildPayroll(user: ReportUser, period: Period, scope: ResolvedScope): Promise<ReportResult> {
  const inPeriod = { gte: period.from, lte: period.to };
  // Payroll runs whose pay period overlaps the report period.
  const runs = await prisma.payrollRun.findMany({
    where: { companyId: user.companyId, periodStart: { lte: period.to }, periodEnd: { gte: period.from } },
    orderBy: { periodStart: "desc" },
    select: {
      id: true, label: true, status: true, periodStart: true, periodEnd: true,
      items: { select: { userId: true, amount: true, paid: true, user: { select: { firstName: true, lastName: true } } } },
    },
  });

  const userFilter = scope.userIds ? new Set(scope.userIds) : null;
  const visible = (uid: string) => !userFilter || userFilter.has(uid);
  let total = 0, paid = 0, pending = 0;
  const byPerson = new Map<string, { paid: number; pending: number }>();
  for (const run of runs) {
    for (const it of run.items) {
      if (!visible(it.userId)) continue;
      total += it.amount;
      if (it.paid) paid += it.amount; else pending += it.amount;
      const name = `${it.user.firstName} ${it.user.lastName}`.trim();
      const e = byPerson.get(name) ?? { paid: 0, pending: 0 };
      if (it.paid) e.paid += it.amount; else e.pending += it.amount;
      byPerson.set(name, e);
    }
  }

  // Compact period label, e.g. "Jun 7 – Jun 19, 2026".
  const fmtRange = (a: Date, b: Date) => {
    const d = (x: Date) => x.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return `${d(a)} – ${d(b)}, ${b.getFullYear()}`;
  };
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  const [commPaid, liability] = await Promise.all([
    prisma.commission.aggregate({
      where: { companyId: user.companyId, status: "paid", paidAt: inPeriod, ...(scope.userIds ? { userId: { in: scope.userIds } } : {}) },
      _sum: { amount: true },
    }),
    // Remaining commission liability: generated-unpaid + estimated on active deals.
    getCommissionLiability(user.companyId, scope),
  ]);
  const estRemaining = liability.lockedInCents + liability.estimatedCents;

  return {
    type: "payroll",
    title: "Payroll Report",
    periodLabel: period.label,
    scopeLabel: scope.label,
    metrics: [
      { label: "Total payroll", value: usd(total), hint: "in period" },
      { label: "Paid", value: usd(paid), tone: "pos" },
      { label: "Pending", value: usd(pending), tone: "neg" },
      { label: "Commissions paid", value: usd(commPaid._sum.amount ?? 0), tone: "pos", hint: "in period" },
      { label: "Upcoming commissions", value: usd(estRemaining), tone: "neg", hint: "generated + estimated" },
    ],
    tables: [
      {
        title: "This period's payroll · by person",
        columns: ["Person", "Paid", "Pending", "Total"],
        rows: [
          ...[...byPerson.entries()]
            .sort((a, b) => b[1].paid + b[1].pending - (a[1].paid + a[1].pending))
            .map(([name, e]) => [name, usd(e.paid), usd(e.pending), usd(e.paid + e.pending)]),
          ...(byPerson.size > 0 ? [["Total", usd(paid), usd(pending), usd(total)]] : []),
        ],
      },
      {
        title: "Upcoming commissions · by person",
        columns: ["Person", "Generated", "Estimated", "Total"],
        rows: [
          ...liability.byRep.map((r) => [r.name, usd(r.lockedInCents), usd(r.estimatedCents), usd(r.lockedInCents + r.estimatedCents)]),
          ...(liability.byRep.length > 0 ? [["Total", usd(liability.lockedInCents), usd(liability.estimatedCents), usd(estRemaining)]] : []),
        ],
      },
      {
        title: "Payroll runs",
        columns: ["Run", "Period", "Total", "Status"],
        rows: runs.map((r) => {
          const runTotal = r.items.filter((it) => visible(it.userId)).reduce((s, it) => s + it.amount, 0);
          return [r.label, fmtRange(r.periodStart, r.periodEnd), usd(runTotal), cap(r.status)];
        }),
      },
    ],
  };
}
