import { prisma } from "@/server/db/client";
import { getSaleLine } from "@/server/modules/pipeline/sale-line";
import type { Period, RenderableReport, ResolvedScope } from "./builders";
import { solarContractByLead } from "./solar-contract";

type ReportUser = { companyId: string; userId: string; role: string };
const usd = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
const pct = (n: number) => `${n.toFixed(1)}%`;

/**
 * Lead source ROI / marketing attribution. For leads created in the period,
 * grouped by source: volume, deals won, close rate, and realized revenue
 * (the won deal's project contract + supplement + deductible, or the lead's
 * claim/estimated value as a fallback). Tells you which channels make money.
 */
export async function buildLeadSourceReport(user: ReportUser, period: Period, scope: ResolvedScope): Promise<RenderableReport> {
  const inPeriod = { gte: period.from, lte: period.to };

  // Won is the deal's STAGE, not `Lead.status` — see lib/sold-stage.ts.
  const saleLine = await getSaleLine(user.companyId);

  const leads = await prisma.lead.findMany({
    where: { ...scope.leadWhere, createdAt: inPeriod },
    select: {
      id: true,
      vertical: true,
      stageId: true,
      value: true,
      claimPrice: true,
      source: { select: { name: true } },
      project: { select: { contractValue: true, supplementCents: true, deductibleCents: true } },
    },
  });

  /**
   * The solar deals that are sold but have no job yet.
   *
   * The `claimPrice ?? value` fallback below is roofing's: `claimPrice` is null
   * on solar and `value` is the household's NET after the federal credits, so a
   * solar deal without a Project attributed its source a figure 30–50% under
   * the contract. See `solarContractByLead`.
   */
  const soldSolarWithoutJob = leads
    .filter((l) => l.vertical === "solar" && !l.project && !!l.stageId && saleLine.stageIds.has(l.stageId))
    .map((l) => l.id);
  const solarContracts = await solarContractByLead(user.companyId, soldSolarWithoutJob);

  type Agg = { leads: number; won: number; revenue: number };
  const bySource = new Map<string, Agg>();
  for (const l of leads) {
    const name = l.source?.name ?? "Direct / unattributed";
    const e = bySource.get(name) ?? { leads: 0, won: 0, revenue: 0 };
    e.leads += 1;
    if (l.stageId && saleLine.stageIds.has(l.stageId)) {
      e.won += 1;
      e.revenue += l.project
        ? l.project.contractValue + l.project.supplementCents + l.project.deductibleCents
        : (solarContracts.get(l.id) ?? l.claimPrice ?? l.value);
    }
    bySource.set(name, e);
  }

  const rows = [...bySource.entries()]
    .map(([name, e]) => ({ name, ...e }))
    .sort((a, b) => b.revenue - a.revenue || b.won - a.won);

  const totalLeads = leads.length;
  const totalWon = rows.reduce((s, r) => s + r.won, 0);
  const totalRev = rows.reduce((s, r) => s + r.revenue, 0);
  const best = [...rows].sort((a, b) => b.won - a.won)[0];

  const avg = (rev: number, won: number) => usd(won > 0 ? Math.round(rev / won) : 0);

  return {
    title: "Lead Source ROI",
    periodLabel: period.label,
    scopeLabel: scope.label,
    metrics: [
      { label: "Leads", value: String(totalLeads), hint: "in period" },
      { label: "Won", value: String(totalWon), tone: "pos" },
      { label: "Close rate", value: pct(totalLeads > 0 ? (totalWon / totalLeads) * 100 : 0) },
      { label: "Revenue", value: usd(totalRev), tone: "pos", hint: "won deals" },
      { label: "Top source", value: best && best.won > 0 ? best.name : "—", hint: "by deals won" },
      { label: "Sources", value: String(rows.length), hint: "with leads" },
    ],
    tables: [
      {
        title: "By source — leads created in period",
        columns: ["Source", "Leads", "Won", "Close rate", "Revenue", "Avg job"],
        rows: [
          ...rows.map((r) => [r.name, r.leads, r.won, pct(r.leads > 0 ? (r.won / r.leads) * 100 : 0), usd(r.revenue), avg(r.revenue, r.won)]),
          ...(rows.length ? [["Total", totalLeads, totalWon, pct(totalLeads > 0 ? (totalWon / totalLeads) * 100 : 0), usd(totalRev), avg(totalRev, totalWon)]] : []),
        ],
      },
    ],
  };
}
