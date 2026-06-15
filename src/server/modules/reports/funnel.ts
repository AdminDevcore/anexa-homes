import { prisma } from "@/server/db/client";
import type { Period, RenderableReport, ResolvedScope } from "./builders";

type ReportUser = { companyId: string; userId: string; role: string };
const usd = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
const pct = (n: number) => `${n.toFixed(1)}%`;
const DAY = 86_400_000;

/**
 * Sales funnel + pipeline velocity. Period metrics (created / appointments / won)
 * mirror the Operations report's lead-as-appointment convention so the numbers
 * reconcile, plus a current-snapshot waterfall of open deals per stage with the
 * average time each has been sitting in its stage (where deals stall).
 */
export async function buildFunnelReport(user: ReportUser, period: Period, scope: ResolvedScope): Promise<RenderableReport> {
  const inPeriod = { gte: period.from, lte: period.to };
  const leadWhere = scope.leadWhere;
  const now = Date.now();

  const [created, appts, won, lost, junk, openLeads, defaultPipeline] = await Promise.all([
    prisma.lead.count({ where: { ...leadWhere, createdAt: inPeriod } }),
    prisma.lead.count({ where: { ...leadWhere, appointmentAt: inPeriod } }),
    prisma.lead.count({ where: { ...leadWhere, status: "won", createdAt: inPeriod } }),
    prisma.lead.count({ where: { ...leadWhere, status: "lost", createdAt: inPeriod } }),
    prisma.lead.count({ where: { ...leadWhere, status: "junk", createdAt: inPeriod } }),
    prisma.lead.findMany({ where: { ...leadWhere, status: "open" }, select: { stageId: true, value: true, claimPrice: true, stageChangedAt: true, createdAt: true } }),
    prisma.pipeline.findFirst({ where: { companyId: user.companyId }, orderBy: { isDefault: "desc" }, include: { stages: { orderBy: { position: "asc" }, select: { id: true, name: true } } } }),
  ]);

  const closingRate = appts > 0 ? (won / appts) * 100 : 0;
  const ageDays = (since: Date) => Math.max(0, Math.floor((now - since.getTime()) / DAY));

  // Current open pipeline grouped by stage (waterfall) with avg time-in-stage.
  const stageAgg = new Map<string, { count: number; value: number; ageSum: number }>();
  for (const l of openLeads) {
    const sid = l.stageId ?? "none";
    const e = stageAgg.get(sid) ?? { count: 0, value: 0, ageSum: 0 };
    e.count += 1;
    e.value += l.claimPrice ?? l.value;
    e.ageSum += ageDays(l.stageChangedAt ?? l.createdAt);
    stageAgg.set(sid, e);
  }
  const funnelRows: (string | number)[][] = (defaultPipeline?.stages ?? [])
    .filter((s) => stageAgg.has(s.id))
    .map((s) => {
      const e = stageAgg.get(s.id)!;
      return [s.name, e.count, usd(e.value), `${Math.round(e.ageSum / e.count)}d`];
    });
  const noneE = stageAgg.get("none");
  if (noneE) funnelRows.push(["(no stage)", noneE.count, usd(noneE.value), `${Math.round(noneE.ageSum / noneE.count)}d`]);

  const totalOpen = openLeads.length;
  const avgAge = totalOpen > 0 ? Math.round(openLeads.reduce((s, l) => s + ageDays(l.stageChangedAt ?? l.createdAt), 0) / totalOpen) : 0;

  const stillOpen = Math.max(0, created - won - lost - junk);
  const share = (n: number) => pct(created > 0 ? (n / created) * 100 : 0);

  return {
    title: "Sales Funnel & Velocity",
    periodLabel: period.label,
    scopeLabel: scope.label,
    metrics: [
      { label: "New leads", value: String(created), hint: "in period" },
      { label: "Appointments", value: String(appts), hint: "in period" },
      { label: "Won", value: String(won), tone: "pos", hint: "in period" },
      { label: "Closing rate", value: pct(closingRate), hint: "won / appts" },
      { label: "Open pipeline", value: String(totalOpen), hint: "current" },
      { label: "Avg age in stage", value: `${avgAge}d`, tone: avgAge > 30 ? "neg" : undefined, hint: "open deals" },
    ],
    tables: [
      {
        title: "Pipeline funnel — current open deals",
        columns: ["Stage", "Open deals", "Pipeline value", "Avg days in stage"],
        rows: funnelRows,
      },
      {
        title: "Outcomes — leads created in period",
        columns: ["Outcome", "Leads", "Share"],
        rows: [
          ["Won", won, share(won)],
          ["Lost", lost, share(lost)],
          ["Junk", junk, share(junk)],
          ["Still open", stillOpen, share(stillOpen)],
        ],
      },
    ],
  };
}
