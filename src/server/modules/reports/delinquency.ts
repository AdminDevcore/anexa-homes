import { prisma } from "@/server/db/client";
import { stageTiming, type StageStatus } from "@/lib/stage-status";
import type { RenderableReport, ResolvedScope } from "./builders";

export type DelinquencyRow = {
  leadId: string;
  customer: string;
  stageName: string;
  stageColor: string;
  status: Exclude<StageStatus, "none" | "on_track">; // due_soon | overdue
  daysInStage: number;
  targetDays: number;
  daysOver: number;
  rep: string;
  inStageSince: string; // formatted date
};

export type DelinquencyGroup = {
  stageName: string;
  stageColor: string;
  targetDays: number;
  rows: DelinquencyRow[];
};

export type DelinquencyMetrics = { overdue: number; dueSoon: number; tracked: number; avgOver: number; worst: number };

export type DelinquencyReport = {
  scopeLabel: string;
  includeDueSoon: boolean;
  generatedLabel: string;
  groups: DelinquencyGroup[];
  rows: DelinquencyRow[]; // flat, worst-first
  metrics: DelinquencyMetrics;
};

/** Shape the pure computation needs — what the prisma query selects. */
export type DelinquencyLeadInput = {
  id: string;
  firstName: string;
  lastName: string;
  createdAt: Date;
  stageChangedAt: Date | null;
  assignedRep: { firstName: string; lastName: string } | null;
  stage: { name: string; color: string; targetDays: number; position: number } | null;
};

const fmtDate = (d: Date | string | null, createdAt: Date | string) =>
  new Date(d ?? createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/**
 * Pure computation: turn fetched leads into grouped, sorted delinquency rows +
 * metrics. Kept prisma-free so the days-over / grouping logic is unit-testable.
 * Uses the same `stageTiming` math as the pipeline board and the overdue-alert
 * cron so the numbers always agree.
 */
export function computeDelinquency(
  leads: DelinquencyLeadInput[],
  includeDueSoon: boolean,
  now: number,
): { groups: DelinquencyGroup[]; rows: DelinquencyRow[]; metrics: DelinquencyMetrics } {
  let tracked = 0;
  const all: DelinquencyRow[] = [];
  const stagePosition = new Map<string, number>();
  for (const lead of leads) {
    if (!lead.stage) continue;
    tracked++;
    const t = stageTiming(lead.stageChangedAt, lead.createdAt, lead.stage.targetDays, now);
    if (t.status !== "overdue" && t.status !== "due_soon") continue;
    if (t.status === "due_soon" && !includeDueSoon) continue;
    stagePosition.set(lead.stage.name, lead.stage.position);
    all.push({
      leadId: lead.id,
      customer: `${lead.firstName} ${lead.lastName}`.trim() || "Unnamed deal",
      stageName: lead.stage.name,
      stageColor: lead.stage.color,
      status: t.status,
      daysInStage: t.daysInStage,
      targetDays: t.targetDays,
      daysOver: t.overdueBy,
      rep: lead.assignedRep ? `${lead.assignedRep.firstName} ${lead.assignedRep.lastName}`.trim() : "Unassigned",
      inStageSince: fmtDate(lead.stageChangedAt, lead.createdAt),
    });
  }

  // Worst first: most days over, then longest in stage.
  all.sort((a, b) => b.daysOver - a.daysOver || b.daysInStage - a.daysInStage);

  // Group by stage in pipeline order.
  const byStage = new Map<string, DelinquencyGroup>();
  for (const r of all) {
    const g = byStage.get(r.stageName) ?? {
      stageName: r.stageName,
      stageColor: r.stageColor,
      targetDays: r.targetDays,
      rows: [],
    };
    g.rows.push(r);
    byStage.set(r.stageName, g);
  }
  const groups = [...byStage.values()].sort(
    (a, b) => (stagePosition.get(a.stageName) ?? 0) - (stagePosition.get(b.stageName) ?? 0),
  );

  const overdueRows = all.filter((r) => r.status === "overdue");
  const dueSoonRows = all.filter((r) => r.status === "due_soon");
  const avgOver = overdueRows.length
    ? Math.round(overdueRows.reduce((s, r) => s + r.daysOver, 0) / overdueRows.length)
    : 0;
  const worst = overdueRows.length ? Math.max(...overdueRows.map((r) => r.daysOver)) : 0;

  return {
    groups,
    rows: all,
    metrics: { overdue: overdueRows.length, dueSoon: dueSoonRows.length, tracked, avgOver, worst },
  };
}

/**
 * Fetch open deals in SLA-tracked stages within the scope and compute the
 * delinquency / follow-up list.
 */
export async function buildDelinquencyReport(
  scope: ResolvedScope,
  opts: { includeDueSoon?: boolean } = {},
  now: number = Date.now(),
): Promise<DelinquencyReport> {
  const includeDueSoon = !!opts.includeDueSoon;

  const leads = await prisma.lead.findMany({
    where: { ...scope.leadWhere, status: "open", stage: { targetDays: { gt: 0 } } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      createdAt: true,
      stageChangedAt: true,
      assignedRep: { select: { firstName: true, lastName: true } },
      stage: { select: { name: true, color: true, targetDays: true, position: true } },
    },
  });

  const { groups, rows, metrics } = computeDelinquency(leads, includeDueSoon, now);

  return {
    scopeLabel: scope.label,
    includeDueSoon,
    generatedLabel: new Date(now).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    groups,
    rows,
    metrics,
  };
}

const STATUS_LABEL: Record<DelinquencyRow["status"], string> = { overdue: "Overdue", due_soon: "Due soon" };

/** Adapt to the generic renderable shape for CSV / PDF export. */
export function delinquencyRenderable(report: DelinquencyReport): RenderableReport {
  return {
    title: "Overdue Jobs Report",
    periodLabel: `As of ${report.generatedLabel}`,
    scopeLabel: report.scopeLabel,
    metrics: [
      { label: "Overdue deals", value: String(report.metrics.overdue), tone: "neg" },
      ...(report.includeDueSoon ? [{ label: "Due soon", value: String(report.metrics.dueSoon) } as const] : []),
      { label: "Deals tracked", value: String(report.metrics.tracked), hint: "in SLA stages" },
      { label: "Avg days over", value: String(report.metrics.avgOver), hint: "overdue deals" },
      { label: "Worst offender", value: `${report.metrics.worst} days over` },
    ],
    tables: report.groups.map((g) => ({
      title: `${g.stageName} · limit ${g.targetDays}d`,
      columns: ["Job / Customer", "Status", "Days in stage", "Limit", "Days over", "Rep", "In stage since"],
      rows: g.rows.map((r) => [
        r.customer,
        STATUS_LABEL[r.status],
        r.daysInStage,
        r.targetDays,
        r.daysOver,
        r.rep,
        r.inStageSince,
      ]),
    })),
  };
}
