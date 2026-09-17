import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { asActiveVertical } from "@/server/vertical/context";
import { CRON_MAX_DURATION_SECONDS } from "./budget";
import { notifyRun } from "./notify";
import { truncateSummary } from "./result";

/**
 * No run stays `running` forever.
 *
 * Every run executes inside a function the platform kills
 * `CRON_MAX_DURATION_SECONDS` after it starts: the tick's start, or Run now's
 * click. Both are at or before the run's own `startedAt`, so a `running` run
 * older than that limit plus REAP_GRACE_MS is certainly dead — the process
 * that owned it stopped (deploy, crash, platform limit) and never wrote a
 * final status. A younger run may still be applying changes (up to 285 s of
 * the budget), so it is left alone: reaping it early would record "nothing
 * known to have happened" over deals that did move, and send a false alert.
 *
 * The agent's own `timeoutSeconds` plays no part here — it bounds how long a
 * HANDLER may run inside a live tick (see budget.ts), not how long a dead
 * process's row is allowed to sit before the next tick notices. It can also
 * be edited while a run is in flight.
 */
export const REAP_GRACE_MS = 60_000;
export const QUEUED_EXPIRY_MS = 10 * 60_000;
// Kept low: each row here costs an updateMany plus a notifyRun (dynamic
// import and fireEvent) before the tick gets to claim or execute anything.
// 200 sequential rows could eat the whole 300 s budget on their own.
const BATCH = 25;
const RUNNING_CUTOFF_MS = CRON_MAX_DURATION_SECONDS * 1000 + REAP_GRACE_MS;

const RUN_SELECT = {
  id: true,
  companyId: true,
  vertical: true,
  leadId: true,
  startedAt: true,
  agent: { select: { name: true } },
} satisfies Prisma.AgentRunSelect;

type StuckRun = Prisma.AgentRunGetPayload<{ select: typeof RUN_SELECT }>;

export async function reapStuckRuns(now: Date): Promise<number> {
  const nowMs = now.getTime();
  let reaped = 0;

  const running = await prisma.agentRun.findMany({
    where: { status: "running", startedAt: { lt: new Date(nowMs - RUNNING_CUTOFF_MS) } },
    orderBy: { startedAt: "asc" },
    take: BATCH,
    select: RUN_SELECT,
  });
  for (const run of running) {
    // The query above requires startedAt < cutoff, so every row here has one.
    const startedMs = run.startedAt!.getTime();
    const minutes = Math.max(1, Math.round((nowMs - startedMs - CRON_MAX_DURATION_SECONDS * 1000) / 60_000));
    const message =
      `Reaped: still marked running ${minutes} min past the ${CRON_MAX_DURATION_SECONDS} s limit on any run. ` +
      "The process running it stopped (deploy, crash or platform limit); nothing after the last log line is known to have happened.";
    if (await close(run, "running", now, message)) reaped++;
  }

  const queued = await prisma.agentRun.findMany({
    where: { status: "queued", createdAt: { lt: new Date(nowMs - QUEUED_EXPIRY_MS) } },
    orderBy: { createdAt: "asc" },
    take: BATCH,
    select: RUN_SELECT,
  });
  for (const run of queued) {
    if (await close(run, "queued", now, "Never started.")) reaped++;
  }

  return reaped;
}

/** Compare-and-set on the status it was found in: a run that finished meanwhile keeps its own verdict. */
async function close(run: StuckRun, from: "running" | "queued", now: Date, message: string): Promise<boolean> {
  const done = await prisma.agentRun.updateMany({
    where: { id: run.id, status: from },
    data: { status: "failed", finishedAt: now, summary: truncateSummary(message), error: message },
  });
  if (done.count === 0) return false;
  await notifyRun({
    companyId: run.companyId,
    vertical: asActiveVertical(run.vertical),
    leadId: run.leadId,
    status: "failed",
    summary: message,
    agentName: run.agent.name,
  });
  return true;
}
