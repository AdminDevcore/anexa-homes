import { prisma } from "@/server/db/client";
import { getSaleLine } from "@/server/modules/pipeline/sale-line";
import { solarContractByLead } from "./solar-contract";
import type { Prisma } from "@prisma/client";
import type { Period, RenderableReport, ResolvedScope } from "./builders";

type ReportUser = { companyId: string; userId: string; role: string };
const usd = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
const pct = (n: number) => `${n.toFixed(1)}%`;
const nm = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`.trim() || "—";

/**
 * Rep scorecard / leaderboard. One row per rep for the period: appointments and
 * wins (lead-as-appointment convention, matching Operations), jobs sold and
 * contract revenue, commission earned (all statuses, created in period), and
 * current open follow-up tasks. Sorted by revenue.
 */
export async function buildRepScorecardReport(user: ReportUser, period: Period, scope: ResolvedScope): Promise<RenderableReport> {
  const inPeriod = { gte: period.from, lte: period.to };
  const leadWhere = scope.leadWhere;
  const projectWhere: Prisma.ProjectWhereInput = { companyId: user.companyId, lead: leadWhere };
  const userScope = scope.userIds ? { in: scope.userIds } : undefined;

  // Won is the deal's STAGE, not `Lead.status` — see lib/sold-stage.ts.
  const saleLine = await getSaleLine(user.companyId);

  const [leads, projects, comms, openTasks] = await Promise.all([
    prisma.lead.findMany({
      where: { ...leadWhere, createdAt: inPeriod },
      // `id` and `vertical` are the sold-but-not-yet-in-production case: a
      // solar deal past the sale line with no Project has no contract for the
      // projects query below to sum. See `solarContractByLead`.
      select: {
        id: true,
        vertical: true,
        stageId: true,
        assignedRep: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
    prisma.project.findMany({
      where: { ...projectWhere, createdAt: inPeriod },
      select: {
        leadId: true,
        contractValue: true,
        lead: { select: { assignedRep: { select: { id: true, firstName: true, lastName: true } } } },
      },
    }),
    prisma.commission.findMany({
      where: { companyId: user.companyId, createdAt: inPeriod, ...(userScope ? { userId: userScope } : {}) },
      select: { amount: true, userId: true, user: { select: { firstName: true, lastName: true } } },
    }),
    prisma.task.groupBy({
      by: ["assigneeId"],
      where: { companyId: user.companyId, status: { in: ["todo", "in_progress"] }, ...(userScope ? { assigneeId: userScope } : {}) },
      _count: { _all: true },
    }),
  ]);

  type Row = { name: string; appts: number; won: number; jobs: number; revenue: number; commission: number; openTasks: number };
  const rows = new Map<string, Row>();
  const ensure = (id: string, name: string) => {
    let r = rows.get(id);
    if (!r) { r = { name, appts: 0, won: 0, jobs: 0, revenue: 0, commission: 0, openTasks: 0 }; rows.set(id, r); }
    return r;
  };

  /**
   * The solar deals that are SOLD but have no job yet.
   *
   * Only those: a deal with a Project is answered by the Project's own column
   * below, which is stamped from the same proposal, and a deal that has not
   * reached the sale line has no revenue to book at all. Looking up only the
   * gap keeps this to one extra query on the rows that need it.
   */
  const projectLeadIds = new Set(projects.map((p) => p.leadId));
  const soldSolarWithoutJob = leads
    .filter(
      (l) =>
        l.vertical === "solar" &&
        !!l.stageId &&
        saleLine.stageIds.has(l.stageId) &&
        !projectLeadIds.has(l.id)
    )
    .map((l) => l.id);
  const solarContracts = await solarContractByLead(user.companyId, soldSolarWithoutJob);

  for (const l of leads) {
    if (!l.assignedRep) continue;
    const r = ensure(l.assignedRep.id, nm(l.assignedRep));
    r.appts++;
    if (l.stageId && saleLine.stageIds.has(l.stageId)) r.won++;
    // Sold, no job yet — book the contract so a row cannot read "won 1, $0".
    // `jobs` deliberately does NOT move: nothing is in production.
    const pending = solarContracts.get(l.id);
    if (pending) r.revenue += pending;
  }
  for (const p of projects) {
    const ar = p.lead?.assignedRep;
    if (!ar) continue;
    const r = ensure(ar.id, nm(ar));
    r.jobs++;
    r.revenue += p.contractValue;
  }
  for (const c of comms) {
    const r = ensure(c.userId, nm(c.user));
    r.commission += c.amount;
  }
  for (const t of openTasks) {
    if (!t.assigneeId) continue;
    const r = rows.get(t.assigneeId);
    if (r) r.openTasks += t._count._all;
  }

  const list = [...rows.values()].sort((a, b) => b.revenue - a.revenue || b.won - a.won);
  const totalAppts = list.reduce((s, r) => s + r.appts, 0);
  const totalWon = list.reduce((s, r) => s + r.won, 0);
  const totalRev = list.reduce((s, r) => s + r.revenue, 0);
  const topCloser = [...list].sort((a, b) => b.won - a.won)[0];

  return {
    title: "Rep Scorecard",
    periodLabel: period.label,
    scopeLabel: scope.label,
    metrics: [
      { label: "Reps with activity", value: String(list.length) },
      { label: "Top closer", value: topCloser && topCloser.won > 0 ? topCloser.name : "—", hint: "deals won" },
      { label: "Total revenue", value: usd(totalRev), tone: "pos", hint: "in period" },
      { label: "Avg close rate", value: pct(totalAppts > 0 ? (totalWon / totalAppts) * 100 : 0), hint: "won / appts" },
    ],
    tables: [
      {
        title: "Leaderboard",
        columns: ["Rep", "Appts", "Won", "Close %", "Jobs", "Revenue", "Commission", "Open tasks"],
        rows: [
          ...list.map((r) => [r.name, r.appts, r.won, pct(r.appts > 0 ? (r.won / r.appts) * 100 : 0), r.jobs, usd(r.revenue), usd(r.commission), r.openTasks]),
          ...(list.length ? [["Total", totalAppts, totalWon, pct(totalAppts > 0 ? (totalWon / totalAppts) * 100 : 0), list.reduce((s, r) => s + r.jobs, 0), usd(totalRev), usd(list.reduce((s, r) => s + r.commission, 0)), list.reduce((s, r) => s + r.openTasks, 0)]] : []),
        ],
      },
    ],
  };
}
