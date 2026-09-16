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
import { MAX_ERROR_CHARS, parseAgentResult, truncateSummary } from "./result";
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

const RUN_SELECT = {
  id: true,
  companyId: true,
  vertical: true,
  trigger: true,
  leadId: true,
  startedAt: true,
  detail: true,
  status: true,
  agent: { select: AGENT_SELECT },
} satisfies Prisma.AgentRunSelect;

type ClaimedRun = Prisma.AgentRunGetPayload<{ select: typeof RUN_SELECT }>;

type NewRun = {
  agent: RunnableAgent;
  vertical: ActiveVertical;
  trigger: AgentRunTrigger;
  triggeredById?: string | null;
  now?: Date;
};

const json = (value: unknown) => value as Prisma.InputJsonValue;
const firstLine = (err: unknown) => (err instanceof Error ? err.message : String(err)).split("\n")[0];

/** Postgres `text` and `jsonb` reject a NUL byte outright; handler-controlled text must never carry one into a write. */
function clean(s: string): string {
  return s.replace(/\u0000/g, "");
}

/** `clean`, recursively, for anything headed into a jsonb column. */
function cleanDeep<T>(value: T): T {
  if (typeof value === "string") return clean(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => cleanDeep(v)) as unknown as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = cleanDeep(v);
    return out as T;
  }
  return value;
}

/** The handler `log` callback keeps at most this many lines, so an unbounded loop cannot grow `detail` without limit. */
export const MAX_LOG_LINES = 500;
/** Each stored log line is cut to this many characters. */
export const MAX_LOG_LINE_CHARS = 2_000;

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
    if ((err as { code?: unknown } | null)?.code === "P2002") return null;
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

  const run = await prisma.agentRun.findUnique({ where: { id: runId }, select: RUN_SELECT });
  if (!run) return null;
  // A caller claiming ownership (the tick) created this run itself as
  // `running`; it never races the queued → running claim above. If the row
  // is not `running` regardless — the reaper already closed it, or it is
  // still `queued` because the claim never happened — this run is not ours
  // to execute.
  if (opts.owned && run.status !== "running") return null;

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
  // The agent's gate and config can change between queuing and running; the
  // record should describe what actually ran, not what was true when the row
  // was created.
  ctx.detail.gated = agent.requiresHumanGate;
  ctx.detail.configSnapshot = agent.config ?? {};

  try {
    return await runClaimed(ctx, run, opts, anchorMs);
  } catch (err) {
    // Nothing between here and `finalize` may throw without this catching it:
    // an uncaught throw would leave the run `running` until the reaper closes
    // it minutes later, with no alert sent in between. `handler.parseConfig`
    // throwing (rather than returning `{ ok: false }`) lands here too.
    console.error("[agents] runner crashed", runId, err);
    const finishedAt = new Date();
    ctx.detail.durationMs = finishedAt.getTime() - ctx.startedMs;
    const summary = truncateSummary(clean(`The runner crashed: ${firstLine(err)}`));
    const error = clean(errorText(err)).slice(0, MAX_ERROR_CHARS);
    // A minimal detail, not the half-built one this run was accumulating —
    // except the changes, so the record still shows which deals moved before
    // the crash.
    const detail = cleanDeep({ ...emptyDetail(agent), changes: ctx.detail.changes });

    const done = await prisma.agentRun.updateMany({
      where: { id: runId, status: "running" },
      data: { status: "failed", finishedAt, summary, error, detail: json(detail) },
    });
    if (done.count === 1) {
      await notifyRun({ companyId: ctx.companyId, vertical: ctx.vertical, leadId: ctx.leadId, status: "failed", summary, agentName: ctx.agentName });
      return "failed";
    }
    // Someone else (the reaper) already closed this run out from under us —
    // its verdict stands, and this crash is not ours to record over it.
    throw err;
  }
}

/**
 * Everything after the run is claimed and its context built: resolve the
 * handler, run it against its deadline, gate and apply its changes, and
 * write the verdict. Split out of `executeRun` so a throw anywhere in here
 * is caught by executeRun's crash handler above.
 */
async function runClaimed(ctx: RunCtx, run: ClaimedRun, opts: ExecuteOptions, anchorMs: number): Promise<AgentRunStatus> {
  const { agent } = run;

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
            const l = ctx.detail.log;
            if (l.length < MAX_LOG_LINES) l.push(clean(String(line)).slice(0, MAX_LOG_LINE_CHARS));
            else if (l.length === MAX_LOG_LINES) l.push("… further lines dropped");
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
      summary: `Failed: the run passed its apply deadline after applying ${applied.appliedCount} of ${applied.toApplyCount} changes.`,
      error: "Apply deadline passed before every change could be applied.",
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

/**
 * Plan every change through the gate, then apply the ones it allows, in
 * order. Call inside the run's workspace.
 *
 * The apply deadline is checked at the top of EVERY iteration, not once
 * before the loop starts: applying changes one at a time can itself eat the
 * time budget, and a run that was fine to start applying may not still be
 * fine three moves in. Once the deadline is reached, every remaining
 * `applied` or `held` record becomes `discarded` — a held change can never
 * be approved once its run has failed (gate.ts's own precedence, matched
 * here) — and `tooLate` tells the caller to fail the run.
 */
async function applyChanges(
  ctx: RunCtx,
  agent: RunnableAgent,
  changes: RequestedChange[],
  anchorMs: number
): Promise<{ records: ChangeRecord[]; moves: StageMove[]; tooLate: boolean; error: unknown; appliedCount: number; toApplyCount: number }> {
  const planned = planChanges(await resolveChanges(ctx.companyId, changes), agent.requiresHumanGate);
  const moves: StageMove[] = [];
  const toApplyCount = planned.filter((c) => c.outcome === "applied").length;

  const records: ChangeRecord[] = [];
  let error: unknown = null;
  let tooLate = false;
  let appliedCount = 0;

  for (const c of planned) {
    if (!tooLate && pastApplyDeadline(anchorMs, Date.now())) tooLate = true;

    if (tooLate) {
      records.push(
        c.outcome === "applied" || c.outcome === "held"
          ? { ...c, outcome: "discarded", note: "Not applied: the run reached its apply deadline." }
          : c
      );
      continue;
    }
    if (error !== null) {
      records.push(
        c.outcome === "applied" || c.outcome === "held"
          ? { ...c, outcome: "discarded", note: "Not applied: an earlier change in this run failed." }
          : c
      );
      continue;
    }
    if (c.outcome !== "applied" || !c.toStage) {
      records.push(c);
      continue;
    }
    try {
      await moveDeal(ctx.companyId, c.leadId, c.fromStage?.id ?? null, c.toStage, { kind: "agent", agentName: agent.name });
      moves.push({ leadId: c.leadId, stageId: c.toStage.id });
      records.push(c);
      appliedCount++;
    } catch (err) {
      error = err;
      records.push({ ...c, outcome: "discarded", note: `Not applied: ${firstLine(err)}` });
    }
  }
  return { records, moves, tooLate, error, appliedCount, toApplyCount };
}

/**
 * Write the verdict, if the run is still ours. The compare-and-set on
 * `running` is what makes the reaper's word final: when it closed the run
 * first, this run stays failed and what came back is kept as lateResult.
 *
 * `summary` and `error` are stripped of NUL bytes and `detail` is walked the
 * same way — Postgres `text` and `jsonb` reject 0x00 outright, and
 * handler-controlled text reaches all three (the log, a handler's own
 * `detail`, and `result.error`). `error` is also cut to `MAX_ERROR_CHARS`
 * here, so a thrown stack or a handler's own `config.error` is bounded
 * regardless of which path produced it.
 */
async function finalize(ctx: RunCtx, verdict: Verdict): Promise<AgentRunStatus> {
  const finishedAt = new Date();
  ctx.detail.durationMs = finishedAt.getTime() - ctx.startedMs;
  const summary = clean(truncateSummary(verdict.summary));
  const error = verdict.error != null ? clean(verdict.error).slice(0, MAX_ERROR_CHARS) : null;
  const detail = cleanDeep(ctx.detail);

  const done = await prisma.agentRun.updateMany({
    where: { id: ctx.runId, status: "running" },
    data: { status: verdict.status, finishedAt, summary, error, detail: json(detail) },
  });

  if (done.count === 0) {
    const current = await prisma.agentRun.findUnique({ where: { id: ctx.runId }, select: { status: true, detail: true } });
    const kept = readDetail(current?.detail);
    kept.lateResult = {
      status: verdict.status,
      summary,
      error,
      log: detail.log,
      handler: detail.handler,
      changes: detail.changes,
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
