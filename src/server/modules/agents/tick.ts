import type { AgentRunStatus } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { companyVerticals } from "@/server/auth/vertical";
import { MAX_RUNS_PER_TICK } from "./budget";
import { reapStuckRuns } from "./reaper";
import { handlerFor } from "./registry";
import { AGENT_SELECT, createRun, executeRun, hasRunInFlight, writeMissingHandlerRun } from "./runner";
import { nextRunAtFor } from "./schedule";
import { agentRunVerticals } from "./verticals";

/** A Run now whose after() has not started it within this long is started by the tick. */
export const STALE_QUEUED_MS = 30_000;
const DUE_BATCH = 50;

export type TickReport = {
  reaped: number;
  started: number;
  missingHandler: number;
  skippedInFlight: number;
  results: { runId: string; status: AgentRunStatus | null }[];
};

/**
 * One minute of the clock:
 *  1. reap stuck runs;
 *  2. start manual runs after() never picked up;
 *  3. claim due agents, oldest first, while every workspace each will run in
 *     still fits under the cap — a compare-and-set on nextRunAt, so two ticks
 *     cannot both claim one (no lock table, and raw SQL is lint-banned here);
 *  4. execute everything started, concurrently, inside the budget (budget.ts).
 */
export async function tick(now: Date = new Date()): Promise<TickReport> {
  const anchorMs = now.getTime();
  const report: TickReport = { reaped: 0, started: 0, missingHandler: 0, skippedInFlight: 0, results: [] };

  report.reaped = await reapStuckRuns(now);

  const toRun: { runId: string; owned: boolean }[] = [];

  const stale = await prisma.agentRun.findMany({
    where: { status: "queued", createdAt: { lt: new Date(anchorMs - STALE_QUEUED_MS) } },
    orderBy: { createdAt: "asc" },
    take: MAX_RUNS_PER_TICK,
    select: { id: true },
  });
  for (const run of stale) toRun.push({ runId: run.id, owned: false });

  const live = companyVerticals();
  const due = await prisma.agent.findMany({
    where: { enabled: true, nextRunAt: { lte: now } },
    orderBy: { nextRunAt: "asc" },
    take: DUE_BATCH,
    select: { ...AGENT_SELECT, vertical: true, enabled: true, schedule: true, nextRunAt: true },
  });

  for (const agent of due) {
    const verticals = agentRunVerticals(agent.vertical, live);
    // All of an agent's workspaces or none: one that does not fit waits for the
    // next tick rather than half-running, and nothing younger jumps ahead of it.
    if (toRun.length + verticals.length > MAX_RUNS_PER_TICK) break;

    const claimed = await prisma.agent.updateMany({
      where: { id: agent.id, enabled: true, nextRunAt: agent.nextRunAt },
      data: { nextRunAt: nextRunAtFor(agent, now) },
    });
    if (claimed.count === 0) continue;

    for (const vertical of verticals) {
      if (await hasRunInFlight(agent.id, vertical)) {
        report.skippedInFlight++;
        continue;
      }
      if (!handlerFor(agent.handlerKey)) {
        await writeMissingHandlerRun({ agent, vertical, trigger: "scheduled", now });
        report.missingHandler++;
        continue;
      }
      // createRun returns null when the database's one-in-flight index
      // refuses it — another run for this agent/workspace slipped in between
      // the hasRunInFlight check above and this write. Not our slot.
      const run = await createRun({ agent, vertical, trigger: "scheduled", status: "running", now });
      if (!run) {
        report.skippedInFlight++;
        continue;
      }
      toRun.push({ runId: run.id, owned: true });
    }
  }

  report.started = toRun.length;
  const settled = await Promise.allSettled(toRun.map((r) => executeRun(r.runId, { owned: r.owned, anchorMs })));
  settled.forEach((outcome, i) => {
    if (outcome.status === "rejected") {
      console.error("[agents] a run crashed before it could finish; the reaper will close it", toRun[i].runId, outcome.reason);
    }
    report.results.push({ runId: toRun[i].runId, status: outcome.status === "fulfilled" ? outcome.value : null });
  });
  return report;
}
