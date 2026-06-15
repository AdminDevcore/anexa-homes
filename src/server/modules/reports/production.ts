import { prisma } from "@/server/db/client";
import type { Prisma } from "@prisma/client";
import type { Period, RenderableReport, ResolvedScope } from "./builders";

type ReportUser = { companyId: string; userId: string; role: string };
const sq = (n: number) => `${n.toFixed(1)} sq`;

/**
 * Production & crew throughput. Current job pipeline by production status, plus
 * field progress from daily reports filed in the period (squares completed, crew
 * size) rolled up per job. Installs scheduled and jobs completed in the period.
 */
export async function buildProductionReport(user: ReportUser, period: Period, scope: ResolvedScope): Promise<RenderableReport> {
  const inPeriod = { gte: period.from, lte: period.to };
  const projectWhere: Prisma.ProjectWhereInput = { companyId: user.companyId, lead: scope.leadWhere };
  const dailyProjectFilter: Prisma.DailyReportWhereInput = scope.isCompany ? {} : { project: { lead: scope.leadWhere } };

  const [byStatus, dailies, installsScheduled, completedInPeriod] = await Promise.all([
    prisma.project.groupBy({ by: ["status"], where: projectWhere, _count: { _all: true } }),
    prisma.dailyReport.findMany({
      where: { companyId: user.companyId, date: inPeriod, ...dailyProjectFilter },
      select: { squaresCompleted: true, crewSize: true, project: { select: { projectNumber: true, lead: { select: { firstName: true, lastName: true } } } } },
    }),
    prisma.project.count({ where: { ...projectWhere, installDate: inPeriod } }),
    prisma.project.count({ where: { ...projectWhere, completedAt: inPeriod } }),
  ]);

  const totalSquares = dailies.reduce((s, d) => s + d.squaresCompleted, 0);
  const avgCrew = dailies.length > 0 ? dailies.reduce((s, d) => s + d.crewSize, 0) / dailies.length : 0;
  const inProduction = byStatus.find((s) => s.status === "in_production")?._count._all ?? 0;

  // Roll up daily reports per job.
  const byJob = new Map<string, { customer: string; squares: number; reports: number }>();
  for (const d of dailies) {
    const job = d.project?.projectNumber ?? "—";
    const customer = d.project?.lead ? `${d.project.lead.firstName} ${d.project.lead.lastName}`.trim() : "—";
    const e = byJob.get(job) ?? { customer, squares: 0, reports: 0 };
    e.squares += d.squaresCompleted; e.reports += 1;
    byJob.set(job, e);
  }

  const STATUS_ORDER = ["not_started", "in_production", "on_hold", "qc", "completed", "closed", "cancelled"];

  return {
    title: "Production & Throughput",
    periodLabel: period.label,
    scopeLabel: scope.label,
    metrics: [
      { label: "In production", value: String(inProduction), hint: "current" },
      { label: "Completed", value: String(completedInPeriod), tone: "pos", hint: "in period" },
      { label: "Installs scheduled", value: String(installsScheduled), hint: "in period" },
      { label: "Squares completed", value: sq(totalSquares), hint: "in period" },
      { label: "Daily reports", value: String(dailies.length), hint: "in period" },
      { label: "Avg crew size", value: avgCrew.toFixed(1) },
    ],
    tables: [
      {
        title: "Jobs by status (current)",
        columns: ["Status", "Jobs"],
        rows: [...byStatus]
          .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status))
          .map((s) => [s.status.replace(/_/g, " "), s._count._all]),
      },
      {
        title: "Production by job (in period)",
        columns: ["Job #", "Customer", "Squares", "Reports"],
        rows: [...byJob.entries()]
          .sort((a, b) => b[1].squares - a[1].squares)
          .map(([job, e]) => [job, e.customer, sq(e.squares), e.reports]),
      },
    ],
  };
}
