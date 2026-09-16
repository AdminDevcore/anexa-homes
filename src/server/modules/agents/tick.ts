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

  try {
    report.reaped = await reapStuckRuns(now);
  } catch (err) {
    // A failing reap costs this tick its reap, not the tick itself: claiming
    // and executing due runs must not be held hostage by a slow or broken
    // reaper. Left at 0 rather than guessed.
    console.error("[agents] reap failed; leaving stuck runs for the reaper's next pass", err);
  }

  const toRun: { runId: string; owned: boolean }[] = [];

  try {
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
      try {
        const verticals = agentRunVerticals(agent.vertical, live);
        // All of an agent's workspaces or none: one that does not fit waits for
        // the next tick rather than half-running, and nothing younger jumps
        // ahead of it. A missing-handler write costs the same budget as a real
        // run — otherwise a dropped handler key spends the whole tick writing
        // failures and alerting instead of running anything.
        const used = toRun.length + report.missingHandler;
        if (used + verticals.length > MAX_RUNS_PER_TICK) break;

        const nextRunAt = nextRunAtFor(agent, now);
        if (nextRunAt === null && agent.enabled && agent.schedule) {
          // croner refused the stored schedule: nextRunAt goes to NULL while
          // enabled stays true, so this agent silently never runs again
          // unless someone is watching the logs for it.
          console.error("[agents] nextRunAtFor returned null for a stored schedule", agent.id, agent.schedule);
        }
        const claimed = await prisma.agent.updateMany({
          where: { id: agent.id, enabled: true, nextRunAt: agent.nextRunAt },
          data: { nextRunAt },
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
          // refuses it — another run for this agent/workspace slipped in
          // between the hasRunInFlight check above and this write. Not our slot.
          const run = await createRun({ agent, vertical, trigger: "scheduled", status: "running", now });
          if (!run) {
            report.skippedInFlight++;
            continue;
          }
          toRun.push({ runId: run.id, owned: true });
        }
      } catch (err) {
        // One agent's claim failing (a pool error, a transient DB blip) must
        // not cost every OTHER due agent its run: those already pushed into
        // toRun stay owned and get executed below regardless.
        console.error("[agents] could not claim", agent.id, err);
      }
    }
  } catch (err) {
    // Finding the due set itself failed. Whatever was already claimed above
    // (stale queued runs picked up before this) still gets executed in the
    // finally below, rather than left running forever.
    console.error("[agents] failed while finding due agents; running whatever was already claimed", err);
  } finally {
    report.started = toRun.length;
    const settled = await Promise.allSettled(toRun.map((r) => executeRun(r.runId, { owned: r.owned, anchorMs })));
    settled.forEach((outcome, i) => {
      if (outcome.status === "rejected") {
        console.error("[agents] a run crashed before it could finish; the reaper will close it", toRun[i].runId, outcome.reason);
      }
      report.results.push({ runId: toRun[i].runId, status: outcome.status === "fulfilled" ? outcome.value : null });
    });
  }

  return report;
}
