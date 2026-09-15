import type { AgentRunStatus, AgentRunTrigger, Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import type { ActiveVertical } from "@/lib/vertical";
import { asActiveVertical, runInVertical } from "@/server/vertical/context";
import { moveDeal, resolveChanges, runStageEnteredAutomations, type StageMove } from "./apply-changes";
import { canStart, handlerDeadlineMs, pastApplyDeadline } from "./budget";
import { emptyDetail, errorText, missingHandlerMessage, readDetail } from "./detail";
import { buildDeps } from "./deps";
import { discardAll, finalStatus, planChanges } from "./gate";
import { notifyRun } from "./notify";
import { handlerFor } from "./registry";
import { parseAgentResult, truncateSummary } from "./result";
import { withTimeout } from "./timeout";
import type { AgentDeps, ChangeRecord, RequestedChange, RunDetail } from "./types";

/**
 * Runs an agent once, in one workspace, and writes down everything.
 *
 * Shared by the cron tick and Run now. Nothing here knows about Vercel, so a
 * worker outside it can call executeRun(runId) against the same tables.
 * Nothing is retried: a failure waits for a person.
 */

export const AGENT_SELECT = {
  id: true,
  companyId: true,
  name: true,
  handlerKey: true,
  config: true,
  timeoutSeconds: true,
  requiresHumanGate: true,
} satisfies Prisma.AgentSelect;

export type RunnableAgent = Prisma.AgentGetPayload<{ select: typeof AGENT_SELECT }>;

type NewRun = {
  agent: RunnableAgent;
  vertical: ActiveVertical;
  trigger: AgentRunTrigger;
  triggeredById?: string | null;
  now?: Date;
};

const json = (value: unknown) => value as Prisma.InputJsonValue;
const firstLine = (err: unknown) => (err instanceof Error ? err.message : String(err)).split("\n")[0];

export async function hasRunInFlight(agentId: string, vertical: ActiveVertical): Promise<boolean> {
  const inFlight = await prisma.agentRun.count({
    where: { agentId, vertical, status: { in: ["queued", "running"] } },
  });
  return inFlight > 0;
}

/**
 * The run row, written BEFORE anything executes, so a run that dies mid-flight still exists for the reaper.
 *
 * Returns `{ id }` on success, or `null` if a run is already queued or running for this agent
 * in this workspace. Catches Prisma P2002 (unique constraint violation) and returns null, because
 * the partial unique index `agent_runs_one_in_flight` on `(agentId, vertical) WHERE status IN
 * ('queued','running')` is AgentRun's only unique constraint, so P2002 always means a run is
 * already in flight. Any other error is rethrown.
 */
export async function createRun(input: NewRun & { status: "queued" | "running" }): Promise<{ id: string } | null> {
  try {
    return await prisma.agentRun.create({
      data: {
        companyId: input.agent.companyId,
        agentId: input.agent.id,
        vertical: input.vertical,
        trigger: input.trigger,
        status: input.status,
        triggeredById: input.triggeredById ?? null,
        startedAt: input.status === "running" ? (input.now ?? new Date()) : null,
        detail: json(emptyDetail(input.agent)),
      },
      select: { id: true },
    });
  } catch (err) {
    // P2002 = unique constraint violation. Check both the error code and message for Prisma errors.
    const isP2002 =
      (typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === "P2002") ||
      (err instanceof Error && err.message.includes("P2002"));
    if (isP2002) {
      return null;
    }
    throw err;
  }
}

/** A due or manual run of an agent whose handler is not in this build: recorded as failed, and announced. */
export async function writeMissingHandlerRun(input: NewRun): Promise<{ id: string; error: string }> {
  const error = missingHandlerMessage(input.agent.handlerKey);
  const now = input.now ?? new Date();
  const run = await prisma.agentRun.create({
    data: {
      companyId: input.agent.companyId,
      agentId: input.agent.id,
      vertical: input.vertical,
      trigger: input.trigger,
      status: "failed",
      triggeredById: input.triggeredById ?? null,
      startedAt: now,
      finishedAt: now,
      summary: truncateSummary(error),
      error,
      detail: json({ ...emptyDetail(input.agent), durationMs: 0 }),
    },
    select: { id: true },
  });
  await notifyRun({ companyId: input.agent.companyId, vertical: input.vertical, leadId: null, status: "failed", summary: error, agentName: input.agent.name });
  return { id: run.id, error };
}

export type ExecuteOptions = {
  /** The tick created this run as `running`, so there is no queued → running claim to make. */
  owned?: boolean;
  /** When the time budget started: the tick's start, or Run now's click. */
  anchorMs?: number;
  /** Test seam: a fake outside world. */
  deps?: AgentDeps;
  /** Test seam: cap the handler deadline below the budget. */
  maxHandlerMs?: number;
};

type RunCtx = {
  runId: string;
  companyId: string;
  vertical: ActiveVertical;
  leadId: string | null;
  agentName: string;
  detail: RunDetail;
  startedMs: number;
};

type Verdict = { status: "success" | "failed" | "needs_human"; summary: string; error?: string | null };

export async function executeRun(runId: string, opts: ExecuteOptions = {}): Promise<AgentRunStatus | null> {
  const anchorMs = opts.anchorMs ?? Date.now();

  if (!opts.owned) {
    const claimed = await prisma.agentRun.updateMany({
      where: { id: runId, status: "queued" },
      data: { status: "running", startedAt: new Date() },
    });
    if (claimed.count === 0) return null;
  }

  const run = await prisma.agentRun.findUnique({
    where: { id: runId },
    select: { id: true, companyId: true, vertical: true, trigger: true, leadId: true, startedAt: true, detail: true, agent: { select: AGENT_SELECT } },
  });
  if (!run) return null;

  const { agent } = run;
  const ctx: RunCtx = {
    runId: run.id,
    companyId: run.companyId,
    vertical: asActiveVertical(run.vertical),
    leadId: run.leadId,
    agentName: agent.name,
    detail: readDetail(run.detail),
    startedMs: run.startedAt?.getTime() ?? Date.now(),
  };

  const handler = handlerFor(agent.handlerKey);
  if (!handler) {
    const message = missingHandlerMessage(agent.handlerKey);
    return finalize(ctx, { status: "failed", summary: message, error: message });
  }

  const config = handler.parseConfig(agent.config);
  if (!config.ok) {
    return finalize(ctx, { status: "failed", summary: `Config is invalid: ${config.error}`, error: config.error });
  }

  const budgetMs = handlerDeadlineMs(agent.timeoutSeconds, anchorMs, Date.now());
  if (!canStart(budgetMs)) {
    const message = "Not started: less than 5 seconds of the time budget were left.";
    return finalize(ctx, { status: "failed", summary: message, error: message });
  }
  const deadlineMs = Math.min(budgetMs, opts.maxHandlerMs ?? Number.POSITIVE_INFINITY);

  const controller = new AbortController();
  const outcome = await runInVertical(ctx.vertical, () =>
    withTimeout(
      () =>
        handler.run({
          companyId: run.companyId,
          vertical: ctx.vertical,
          runId: run.id,
          trigger: run.trigger,
          leadId: run.leadId,
          config: config.config,
          signal: controller.signal,
          log: (line) => {
            ctx.detail.log.push(String(line));
          },
          deps: opts.deps ?? buildDeps(run.companyId),
        }),
      deadlineMs,
      controller
    )
  );

  if (outcome.kind === "threw") {
    return finalize(ctx, { status: "failed", summary: `Handler threw: ${firstLine(outcome.err)}`, error: errorText(outcome.err) });
  }
  if (outcome.kind === "timeout") {
    const message = `Timed out after ${Math.max(1, Math.ceil(deadlineMs / 1000))} s.`;
    return finalize(ctx, { status: "failed", summary: message, error: message });
  }

  const parsed = parseAgentResult(outcome.value);
  if (!parsed.ok) {
    return finalize(ctx, { status: "failed", summary: "Handler returned an invalid result.", error: parsed.error });
  }

  const result = parsed.result;
  const changes = result.changes ?? [];
  ctx.detail.handler = result.detail ?? null;

  if (result.status === "failed") {
    ctx.detail.changes = discardAll(changes, "Not applied: the handler reported failure.");
    return finalize(ctx, { status: "failed", summary: result.summary, error: result.error ?? result.summary });
  }

  let applied: Awaited<ReturnType<typeof applyChanges>>;
  try {
    applied = await runInVertical(ctx.vertical, () => applyChanges(ctx, agent, changes, anchorMs));
  } catch (err) {
    ctx.detail.changes = discardAll(changes, "Not applied: the changes could not be checked.");
    return finalize(ctx, { status: "failed", summary: `Failed while checking changes: ${firstLine(err)}`, error: errorText(err) });
  }

  ctx.detail.changes = applied.records;
  await runStageEnteredAutomations(run.companyId, ctx.vertical, applied.moves);

  if (applied.tooLate) {
    return finalize(ctx, {
      status: "failed",
      summary: "Failed: the run passed its apply deadline, so no change was applied.",
      error: "Apply deadline passed before changes were applied.",
    });
  }
  if (applied.error !== null) {
    return finalize(ctx, { status: "failed", summary: `Failed while applying changes: ${firstLine(applied.error)}`, error: errorText(applied.error) });
  }

  const status = finalStatus(result.status, applied.records);
  return finalize(ctx, {
    status,
    summary: result.summary,
    error: status === "failed" ? (result.error ?? "A requested change was invalid, so nothing was applied.") : (result.error ?? null),
  });
}

/** Plan every change through the gate, then apply the ones it allows, in order. Call inside the run's workspace. */
async function applyChanges(
  ctx: RunCtx,
  agent: RunnableAgent,
  changes: RequestedChange[],
  anchorMs: number
): Promise<{ records: ChangeRecord[]; moves: StageMove[]; tooLate: boolean; error: unknown }> {
  const planned = planChanges(await resolveChanges(ctx.companyId, changes), agent.requiresHumanGate);
  const moves: StageMove[] = [];

  if (pastApplyDeadline(anchorMs, Date.now())) {
    const records = planned.map(
      (c): ChangeRecord => (c.outcome === "applied" ? { ...c, outcome: "discarded", note: "Not applied: the run passed its apply deadline." } : c)
    );
    return { records, moves, tooLate: true, error: null };
  }

  const records: ChangeRecord[] = [];
  let error: unknown = null;
  for (const c of planned) {
    if (c.outcome !== "applied" || !c.toStage) {
      records.push(c);
      continue;
    }
    if (error !== null) {
      records.push({ ...c, outcome: "discarded", note: "Not applied: an earlier change in this run failed." });
      continue;
    }
    try {
      await moveDeal(ctx.companyId, c.leadId, c.fromStage?.id ?? null, c.toStage, { kind: "agent", agentName: agent.name });
      moves.push({ leadId: c.leadId, stageId: c.toStage.id });
      records.push(c);
    } catch (err) {
      error = err;
      records.push({ ...c, outcome: "discarded", note: `Not applied: ${firstLine(err)}` });
    }
  }
  return { records, moves, tooLate: false, error };
}

/**
 * Write the verdict, if the run is still ours. The compare-and-set on
 * `running` is what makes the reaper's word final: when it closed the run
 * first, this run stays failed and what came back is kept as lateResult.
 */
async function finalize(ctx: RunCtx, verdict: Verdict): Promise<AgentRunStatus> {
  const finishedAt = new Date();
  ctx.detail.durationMs = finishedAt.getTime() - ctx.startedMs;
  const summary = truncateSummary(verdict.summary);

  const done = await prisma.agentRun.updateMany({
    where: { id: ctx.runId, status: "running" },
    data: { status: verdict.status, finishedAt, summary, error: verdict.error ?? null, detail: json(ctx.detail) },
  });

  if (done.count === 0) {
    const current = await prisma.agentRun.findUnique({ where: { id: ctx.runId }, select: { status: true, detail: true } });
    const kept = readDetail(current?.detail);
    kept.lateResult = {
      status: verdict.status,
      summary,
      error: verdict.error ?? null,
      log: ctx.detail.log,
      handler: ctx.detail.handler,
      changes: ctx.detail.changes,
      at: finishedAt.toISOString(),
    };
    await prisma.agentRun.update({ where: { id: ctx.runId }, data: { detail: json(kept) } });
    return current?.status ?? "failed";
  }

  if (verdict.status !== "success") {
    await notifyRun({ companyId: ctx.companyId, vertical: ctx.vertical, leadId: ctx.leadId, status: verdict.status, summary, agentName: ctx.agentName });
  }
  return verdict.status;
}
