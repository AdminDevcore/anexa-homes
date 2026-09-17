"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { companyVerticals, userVerticals } from "@/server/auth/vertical";
import { leadAccessible } from "@/server/rbac/lead-access";
import { stageMoveError } from "@/server/modules/pipeline/stage-guard";
import { asActiveVertical, runInVertical } from "@/server/vertical/context";
import { VERTICAL_LABEL, type ActiveVertical } from "@/lib/vertical";
import type { AgentFormValues } from "@/lib/agent-labels";
import { agentCan, canEditAgentConfig } from "./access";
import { moveDeal, runStageEnteredAutomations, TARGET_STAGE_SELECT, type StageMove } from "./apply-changes";
import { missingHandlerMessage, readDetail } from "./detail";
import { getRun, MAX_AGENTS } from "./queries";
import { handlerFor } from "./registry";
import { AGENT_SELECT, clean, cleanDeep, createRun, executeRun, hasRunInFlight, writeMissingHandlerRun } from "./runner";
import { nextRunAtFor } from "./schedule";
import type { ChangeRecord, TargetStage } from "./types";
import { validateAgentInput } from "./validate-agent";
import { agentVisibleTo, viewerRunVerticals } from "./verticals";

/**
 * Every write the Agents pages make, and the one READ that no page can do for
 * itself — `readAgentRunAction`, which fills in a run expanded in place, since
 * a run list deliberately reads neither `detail` nor `error` (queries.ts).
 *
 * Each export is a public endpoint, so each asks access.ts first, re-reads what
 * it acts on inside the caller's company and workspaces, and trusts nothing it
 * is sent.
 */

function fail(error: string) {
  return { ok: false as const, error };
}

function revalidateAgents(agentId?: string) {
  revalidatePath("/portal/agents");
  revalidatePath("/portal/agents/runs");
  if (agentId) revalidatePath(`/portal/agents/${agentId}`);
}

const idSchema = z.string().uuid();

/** A failed move's note goes into a jsonb column and is rendered to a person: one line, and no longer than this. */
const MAX_NOTE_CHARS = 500;

/** Prisma names itself in its own first line: "Invalid `prisma.lead.updateMany()` invocation:". */
const PRISMA_WORDING = /^Invalid `prisma\./;

/** What a person is told when the driver, and not one of our own guards, refused the move. */
const DRIVER_REFUSED = "the deal could not be updated. Try again, or open the deal.";

/**
 * The note a change carries when the move it asked for threw.
 *
 * OUR OWN thrown sentences pass through word for word. `moveDeal`'s "This deal
 * has moved since the agent looked at it; nothing was changed." is the
 * commonest failure on this path and the one sentence here that explains
 * itself — it was written for whoever reads the run.
 *
 * PRISMA'S OWN WORDING DOES NOT. `ChangeList` renders this note verbatim on a
 * portal page, and "Invalid `prisma.lead.updateMany()` invocation:" names one
 * of our tables and a client method while telling the reader nothing they can
 * act on. Substituted, never forwarded.
 *
 * Read from the first line that SAYS something rather than from `split("\n")[0]`:
 * a PrismaClientKnownRequestError opens with a blank line, so reading the
 * literal first line both missed the wording to substitute AND left a person
 * a note reading "Not applied:" and then nothing at all.
 *
 * NUL-stripped and capped, as before and for the same reason — a Prisma
 * failure is a multi-line block carrying a file path and an argument dump, and
 * a NUL byte anywhere in it makes the jsonb write that records this throw
 * AFTER these deals have already moved.
 */
function notAppliedNote(err: unknown): string {
  const said = (err instanceof Error ? err.message : String(err))
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  return clean(`Not applied: ${!said || PRISMA_WORDING.test(said) ? DRIVER_REFUSED : said}`).slice(0, MAX_NOTE_CHARS);
}

/** One missing-handler run — and one alert to every switch holder — per agent, per workspace, per this long. */
const MISSING_HANDLER_QUIET_MS = 10 * 60 * 1000;

/** What the claim records against each change it is about to attempt: nothing has happened to the deal yet. */
const APPLYING_NOTE = "Applying: a person approved this, and what happened is not recorded yet.";

export async function createAgentAction(input: AgentFormValues) {
  const user = await requireUser();
  if (!canEditAgentConfig(user)) return fail("Only an owner or admin can create agents.");
  const v = validateAgentInput(input);
  if (!v.ok) return fail(v.error);
  if (!agentVisibleTo(v.value.vertical, userVerticals(user))) return fail("You don't have access to that product.");

  const taken = await prisma.agent.findFirst({ where: { companyId: user.companyId, name: v.value.name }, select: { id: true } });
  if (taken) return fail("An agent with that name already exists.");

  // Nothing else bounds how many agents a company can hold — `@@unique([companyId, name])`
  // only stops a repeat of one. The Agents list fires one last-run query PER
  // AGENT at once, so this cap is what keeps a single page load from saturating
  // the connection pool. See MAX_AGENTS.
  const held = await prisma.agent.count({ where: { companyId: user.companyId } });
  if (held >= MAX_AGENTS) return fail(`This company has reached the limit of ${MAX_AGENTS} agents.`);

  const row = await prisma.agent.create({
    data: {
      companyId: user.companyId,
      ...v.value,
      config: v.value.config as Prisma.InputJsonValue,
      nextRunAt: nextRunAtFor(v.value, new Date()),
      updatedById: user.userId,
    },
    select: { id: true },
  });
  revalidateAgents(row.id);
  return { ok: true as const, id: row.id };
}

export async function updateAgentAction(agentId: string, input: AgentFormValues) {
  const user = await requireUser();
  if (!canEditAgentConfig(user)) return fail("Only an owner or admin can edit agents.");
  if (!idSchema.safeParse(agentId).success) return fail("Agent not found.");

  const existing = await prisma.agent.findFirst({
    where: { id: agentId, companyId: user.companyId },
    select: { id: true, vertical: true, handlerKey: true, enabled: true, schedule: true, nextRunAt: true },
  });
  if (!existing || !agentVisibleTo(existing.vertical, userVerticals(user))) return fail("Agent not found.");

  // `enabled` belongs to the switch in the page header, not to this form.
  const v = validateAgentInput({ ...input, enabled: existing.enabled }, { keepHandlerKey: existing.handlerKey });
  if (!v.ok) return fail(v.error);
  if (!agentVisibleTo(v.value.vertical, userVerticals(user))) return fail("You don't have access to that product.");

  const taken = await prisma.agent.findFirst({
    where: { companyId: user.companyId, name: v.value.name, id: { not: agentId } },
    select: { id: true },
  });
  if (taken) return fail("An agent with that name already exists.");

  // A save that leaves the schedule alone must not skip a run that is already due.
  const nextRunAt = v.value.schedule === existing.schedule ? existing.nextRunAt : nextRunAtFor(v.value, new Date());
  await prisma.agent.update({
    where: { id: agentId },
    data: { ...v.value, config: v.value.config as Prisma.InputJsonValue, nextRunAt, updatedById: user.userId },
  });
  revalidateAgents(agentId);
  return { ok: true as const };
}

export async function setAgentEnabledAction(agentId: string, enabled: boolean) {
  const user = await requireUser();
  if (!canEditAgentConfig(user)) return fail("Only an owner or admin can turn agents on or off.");
  if (!idSchema.safeParse(agentId).success || typeof enabled !== "boolean") return fail("Agent not found.");

  const agent = await prisma.agent.findFirst({
    where: { id: agentId, companyId: user.companyId },
    select: { id: true, vertical: true, handlerKey: true, schedule: true },
  });
  if (!agent || !agentVisibleTo(agent.vertical, userVerticals(user))) return fail("Agent not found.");
  if (enabled && !handlerFor(agent.handlerKey)) return fail(missingHandlerMessage(agent.handlerKey));

  await prisma.agent.update({
    where: { id: agentId },
    data: { enabled, nextRunAt: nextRunAtFor({ enabled, schedule: agent.schedule }, new Date()), updatedById: user.userId },
  });
  revalidateAgents(agentId);
  return { ok: true as const };
}

export async function runAgentNowAction(agentId: string, opts: { confirmDisabled?: boolean } = {}) {
  const user = await requireUser();
  if (!agentCan(user, "run")) return fail("You don't have permission to run agents.");
  if (!idSchema.safeParse(agentId).success) return fail("Agent not found.");

  const held = userVerticals(user);
  const agent = await prisma.agent.findFirst({
    where: { id: agentId, companyId: user.companyId },
    select: { ...AGENT_SELECT, vertical: true, enabled: true },
  });
  if (!agent || !agentVisibleTo(agent.vertical, held)) return fail("Agent not found.");

  // The page asks first. This is what stops a stale page or a direct call from skipping the question.
  if (!agent.enabled && opts.confirmDisabled !== true) {
    return { ok: false as const, needsConfirm: true as const, error: "This agent is turned off. Confirm to run it anyway." };
  }

  const targets = viewerRunVerticals(agent.vertical, companyVerticals(), held);
  if (targets.length === 0) return fail("This agent does not run in any workspace you have access to.");

  const alreadyRunningMessage = (vertical: ActiveVertical) =>
    targets.length > 1
      ? `This agent already has a run in progress in ${VERTICAL_LABEL[vertical]}. Wait for it to finish.`
      : "This agent already has a run in progress. Wait for it to finish.";

  // The in-flight check comes BEFORE the missing-handler write below, the way
  // the tick orders the same two (tick.ts): that write costs a run row and an
  // alert to every switch holder, and an agent that is already running needs
  // neither.
  for (const vertical of targets) {
    if (await hasRunInFlight(agent.id, vertical)) {
      return fail(alreadyRunningMessage(vertical));
    }
  }

  if (!handlerFor(agent.handlerKey)) {
    const message = missingHandlerMessage(agent.handlerKey);
    // Whoever pressed the button always gets the sentence; what is throttled
    // is the ROW and the ALERT behind it. Nothing else here stops a repeat —
    // the tick has its own per-tick cap, this path has none — so twenty
    // clicks on a broken agent would otherwise be forty notifications to
    // every switch holder.
    const since = new Date(Date.now() - MISSING_HANDLER_QUIET_MS);
    for (const vertical of targets) {
      const announced = await prisma.agentRun.findFirst({
        where: { agentId: agent.id, vertical, status: "failed", error: message, createdAt: { gte: since } },
        select: { id: true },
      });
      if (!announced) await writeMissingHandlerRun({ agent, vertical, trigger: "manual", triggeredById: user.userId });
    }
    revalidateAgents(agent.id);
    return fail(message);
  }

  // The time budget starts at the click. after() runs within the page's
  // maxDuration (300); anything it does not start, the tick starts.
  const anchorMs = Date.now();
  const runIds: string[] = [];
  let racedVertical: ActiveVertical | null = null;
  for (const vertical of targets) {
    // createRun returns null when a tick started a run for this agent in this
    // workspace between the hasRunInFlight check above and this insert — the
    // partial unique index refused the row rather than racing it. Run now
    // starts only the runs it actually created, and fails only if it created
    // none: one workspace racing must not stop the other from starting.
    const created = await createRun({ agent, vertical, trigger: "manual", status: "queued", triggeredById: user.userId });
    if (created) runIds.push(created.id);
    else racedVertical ??= vertical;
  }
  if (runIds.length === 0) {
    return fail(alreadyRunningMessage(racedVertical ?? targets[0]));
  }
  after(async () => {
    const settled = await Promise.allSettled(runIds.map((id) => executeRun(id, { anchorMs })));
    settled.forEach((outcome, i) => {
      // executeRun rethrows when the reaper closed the run out from under it
      // (runner.ts). Unlogged, that throw vanishes into after()'s floating
      // promise — tick.ts logs the same rejection, for the same reason.
      if (outcome.status === "rejected") {
        console.error("[agents] a run crashed before it could finish; the reaper will close it", runIds[i], outcome.reason);
      }
    });
  });
  revalidateAgents(agent.id);
  // `skipped` is the workspace whose run could NOT be started, because one was
  // already in flight there. For a "both workspaces" agent that is the whole
  // difference between "started 2" and "started 1, the other was already
  // running": the caller's intent is satisfied either way, which is why this
  // is still `ok`, but the button is the one place a person sees which
  // happened. Computed above and, until now, thrown away.
  return { ok: true as const, runIds, skipped: racedVertical };
}

/**
 * One run, opened — a read among the writes.
 *
 * A run list reads neither `detail` nor `error` (see RUN_LIST_SELECT), so a row
 * expanded in place asks for that one run's changes, log and stack here.
 * Opening a run costs one run, rather than every row on the page paying for a
 * blob nobody opened.
 */
export async function readAgentRunAction(runId: string) {
  const user = await requireUser();
  if (!agentCan(user, "read")) return fail("You don't have permission to read agent runs.");
  if (!idSchema.safeParse(runId).success) return fail("Run not found.");
  const run = await getRun(user, runId);
  if (!run) return fail("Run not found.");
  return { ok: true as const, run };
}

const resolveSchema = z.object({
  runId: z.string().uuid(),
  resolution: z.enum(["applied", "closed"]),
  note: z.string().trim().max(2000).optional().default(""),
}).strict();

type ReadyChange = { change: ChangeRecord; stage: TargetStage };

export async function resolveAgentRunAction(input: z.input<typeof resolveSchema>) {
  const user = await requireUser();
  if (!agentCan(user, "approve")) return fail("You don't have permission to resolve agent runs.");
  const parsed = resolveSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid request.");
  const { runId, resolution, note } = parsed.data;

  const run = await prisma.agentRun.findFirst({
    where: { id: runId, companyId: user.companyId },
    select: { id: true, agentId: true, vertical: true, status: true, resolvedAt: true, detail: true, agent: { select: { name: true } } },
  });
  if (!run || !(userVerticals(user) as string[]).includes(run.vertical)) return fail("Run not found.");
  if (run.status !== "needs_human") return fail("Only a run that needs a human can be resolved.");
  if (run.resolvedAt) return fail("This run has already been resolved.");

  const detail = readDetail(run.detail);
  const held = detail.changes.filter((c) => c.outcome === "held");

  if (resolution === "closed") {
    if (!note) return fail("Add a note saying why it is closed without applying.");
    const closed = await prisma.agentRun.updateMany({
      where: { id: run.id, resolvedAt: null },
      data: { resolution: "closed", resolvedById: user.userId, resolvedAt: new Date(), resolutionNote: note },
    });
    if (closed.count === 0) return fail("This run has already been resolved.");
    revalidateAgents(run.agentId);
    return { ok: true as const, failed: 0 };
  }

  if (held.length === 0) return fail("Nothing was held on this run, so there is nothing to apply. Close it instead.");

  const vertical = asActiveVertical(run.vertical);

  // Re-check every change before applying any: the viewer can open the deal,
  // the deal is still where the agent saw it, the target stage still exists,
  // and — main's stage rules — neither M1 Funding nor Contract Signed refuses
  // the move. Funding is asked with the APPROVING person's own authority, not
  // the agent's: an admin may certify it themselves; a manager holding
  // Agents access may not, whatever the run itself was allowed to hold.
  const checked = await runInVertical(vertical, async (): Promise<{ error: string } | { ready: ReadyChange[] }> => {
    const ready: ReadyChange[] = [];
    for (const change of held) {
      const lead = await leadAccessible(user, change.leadId);
      if (!lead) {
        return { error: `You can't open ${change.dealLabel ?? "this deal"}, so you can't apply this change. Close the run instead, or ask an admin.` };
      }
      const now = await prisma.lead.findFirst({
        where: { id: lead.id },
        select: { stageId: true, pipelineId: true, stage: { select: { name: true } } },
      });
      if ((now?.stageId ?? null) !== (change.fromStage?.id ?? null)) {
        return { error: `${change.dealLabel ?? "This deal"} has moved since the agent looked (now in ${now?.stage?.name ?? "no stage"}). Close this run instead.` };
      }
      const stage =
        change.toStage && now?.pipelineId
          ? await prisma.pipelineStage.findFirst({ where: { id: change.toStage.id, pipelineId: now.pipelineId }, select: TARGET_STAGE_SELECT })
          : null;
      if (!stage) return { error: `The stage ${change.toStage?.name ?? change.toStageKey} no longer exists. Close this run instead.` };

      const refusal = await stageMoveError({
        companyId: user.companyId,
        actor: user,
        lead: { id: lead.id, vertical: lead.vertical, stageId: now?.stageId ?? null },
        targetStageId: stage.id,
      });
      if (refusal) {
        return { error: `${change.dealLabel ?? "This deal"}: ${refusal}` };
      }

      ready.push({ change, stage });
    }
    return { ready };
  });
  if ("error" in checked) return fail(checked.error);

  // Claim the resolution before touching a deal, so two people pressing Apply cannot both move it.
  //
  // The claim carries a PROVISIONAL record of what it is about to do. Without
  // one, a failure between this write and the final write below — N moves and
  // the automations in between — leaves a row reading "applied, by this
  // person" whose own detail still says every change is waiting for a human,
  // when some of those deals have really moved; nothing left behind could then
  // tell anyone which. Each change is recorded `held` here because that is
  // still true at this instant — the note is what says a person has taken it
  // on. The final write replaces this with what actually happened.
  const pending = cleanDeep({
    ...detail,
    resolution: {
      byUserId: user.userId,
      at: new Date().toISOString(),
      changes: checked.ready.map(({ change, stage }) => ({ ...change, toStage: stage, outcome: "held" as const, note: APPLYING_NOTE })),
    },
  });
  const claimed = await prisma.agentRun.updateMany({
    where: { id: run.id, resolvedAt: null },
    data: {
      resolution: "applied",
      resolvedById: user.userId,
      resolvedAt: new Date(),
      resolutionNote: note || null,
      detail: pending as unknown as Prisma.InputJsonValue,
    },
  });
  if (claimed.count === 0) return fail("This run has already been resolved.");

  const records = await runInVertical(vertical, async () => {
    const out: ChangeRecord[] = [];
    for (const { change, stage } of checked.ready) {
      try {
        // Conditional on the stage the caller just saw above: a person can
        // still move (or cancel) the deal in the gap between that check and
        // this write. moveDeal writes only while the deal is still there, and
        // throws otherwise — nothing is overwritten, and the change below is
        // recorded discarded rather than applied.
        await moveDeal(user.companyId, change.leadId, change.fromStage?.id ?? null, stage, {
          kind: "person",
          userId: user.userId,
          fullName: user.fullName,
          agentName: run.agent.name,
        });
        out.push({ ...change, toStage: stage, outcome: "applied", note: null });
      } catch (err) {
        // One line, readable, and never the driver's own wording — see notAppliedNote.
        out.push({ ...change, outcome: "discarded", note: notAppliedNote(err) });
      }
    }
    return out;
  });

  const moves: StageMove[] = records.flatMap((c) => (c.outcome === "applied" && c.toStage ? [{ leadId: c.leadId, stageId: c.toStage.id }] : []));
  await runStageEnteredAutomations(user.companyId, vertical, moves);

  const failed = records.filter((c) => c.outcome !== "applied").length;
  // The list shows the resolution and its note, never the changes, so a run
  // that applied nothing would still read "Applied" there. Say so in the note.
  const finalNote =
    failed > 0
      ? `${note ? `${note} — ` : ""}Applied ${records.length - failed} of ${records.length} change${records.length === 1 ? "" : "s"}.`
      : note || null;

  detail.resolution = { byUserId: user.userId, at: new Date().toISOString(), changes: records };
  // Read-modify-write of `detail` without a version check: only one caller can
  // win the claim above, and `finalize` cannot re-run on a needs_human row, so
  // nothing else writes this column between the read at the top and here.
  await prisma.agentRun.update({
    where: { id: run.id },
    data: { detail: cleanDeep(detail) as unknown as Prisma.InputJsonValue, resolutionNote: finalNote },
  });

  revalidateAgents(run.agentId);
  for (const move of moves) revalidatePath(`/portal/leads/${move.leadId}`);
  return { ok: true as const, failed };
}
