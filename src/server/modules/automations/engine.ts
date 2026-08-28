import type { AutomationTrigger, Vertical } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { asActiveVertical, runInVertical } from "@/server/vertical/context";
import { matchesConditions } from "./match";
import { actionFor } from "./registry";
import { MAX_DEPTH, type StepResult, type TriggerPayload } from "./types";

export type RunArgs = {
  companyId: string;
  vertical: Vertical;
  trigger: AutomationTrigger;
  leadId: string;
  payload: TriggerPayload;
  /**
   * How many rules deep this firing already is. An action whose effect is
   * itself a trigger causes a re-entry at depth + 1.
   *
   * An argument, NOT an AsyncLocalStorage counter: `next dev` loads a module
   * twice (it is why runInVertical no-ops there), and a depth store that
   * silently resets to zero is a loop guard that does not guard.
   */
  depth: number;
};

/**
 * Run every automation rule that wanted this event.
 *
 * Best-effort, exactly like `fireEvent`, and for the same reason: a rep
 * dragging a card across the pipeline must never see an error because an
 * automation failed. The rep's move is the business record; the automation is a
 * consequence of it. Failures are recorded in AutomationRun and reported
 * through the notification bus, never thrown at whoever triggered them.
 */
export async function runAutomations(args: RunArgs): Promise<void> {
  try {
    // The workspace is established HERE, once, rather than by each caller.
    //
    // AutomationRule, Lead and Project are all vertical-scoped, so every query
    // below and inside every action needs an active vertical. Doing it in the
    // engine means the same code serves a server action (which already has
    // one), the daily cron (which has none), and a test — and no action has to
    // remember. Re-entering with the vertical already set is a harmless no-op.
    await runInVertical(asActiveVertical(args.vertical), () => run(args));
  } catch (err) {
    console.error("[automations] runAutomations failed", args.trigger, err);
  }
}

async function run(args: RunArgs): Promise<void> {
  const rules = await prisma.automationRule.findMany({
    where: { companyId: args.companyId, trigger: args.trigger, active: true },
    orderBy: { createdAt: "asc" },
  });
  // No vertical in the where clause: AutomationRule is a scoped model, so the
  // isolation extension has already narrowed this to one workspace.
  if (rules.length === 0) return;

  for (const rule of rules) {
    if (!matchesConditions(args.trigger, rule.conditions, args.payload)) continue;

    if (args.depth >= MAX_DEPTH) {
      await record(rule.id, args, "skipped", [], "loop guard");
      continue;
    }

    if (rule.once) {
      const already = await prisma.automationRun.findFirst({
        where: { ruleId: rule.id, leadId: args.leadId, status: "succeeded" },
        select: { id: true },
      });
      if (already) continue;
    }

    await execute(rule, args);
  }
}

async function execute(
  rule: { id: string; name: string; actions: unknown },
  args: RunArgs
): Promise<void> {
  const list = Array.isArray(rule.actions) ? rule.actions : [];
  const steps: StepResult[] = [];
  const followUps: NonNullable<StepResult["follow"]>[] = [];
  let error: string | null = null;

  for (const raw of list) {
    const config = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const mod = actionFor(config.type);

    if (!mod) {
      error = `Unknown action "${String(config.type)}".`;
      steps.push({ type: String(config.type ?? "unknown"), ok: false, detail: error });
      break;
    }

    let step: StepResult;
    try {
      step = await mod.run({
        companyId: args.companyId,
        vertical: args.vertical,
        leadId: args.leadId,
        config,
        depth: args.depth,
      });
    } catch (err) {
      // An action that throws is a failed action, not a failed engine.
      step = { type: mod.type, ok: false, detail: err instanceof Error ? err.message : "Action threw." };
    }

    steps.push(step);
    if (step.ok && step.follow) followUps.push(step.follow);

    // Stop at the first failure. Half-applying a rule is the one outcome worse
    // than not applying it: a deal at Inspection whose paperwork was never made.
    if (!step.ok) {
      error = step.detail;
      break;
    }
  }

  await record(rule.id, args, error ? "failed" : "succeeded", steps, error);

  if (error) {
    await notifyFailure(args, rule.name, error);
    // A rule that failed does not get to set off the next one. Its follow-ups
    // are dropped along with the actions that never ran.
    return;
  }

  // Chaining: an action whose effect is itself a trigger gets its turn now,
  // one level deeper. Recorded first (above) so the run log reads in the order
  // things actually happened.
  for (const f of followUps) {
    await run({ ...args, trigger: f.trigger, payload: f.payload, depth: args.depth + 1 });
  }
}

/**
 * Tell somebody an automation failed.
 *
 * Imported lazily and wrapped, deliberately. The notification engine reaches
 * branding, which reaches the session helpers, which reach next-auth — a graph
 * the daily cron has no use for and a test cannot even resolve. Telling
 * somebody is best-effort; the AutomationRun row written just above is the
 * business record, and it must survive the notifier being unavailable.
 */
async function notifyFailure(args: RunArgs, ruleName: string, error: string): Promise<void> {
  try {
    const { fireEvent } = await import("@/server/modules/notifications/engine");
    await fireEvent({
      companyId: args.companyId,
      event: "automation_failed",
      leadId: args.leadId,
      status: `${ruleName}: ${error}`,
    });
  } catch (err) {
    console.error("[automations] could not report a failure", ruleName, err);
  }
}

async function record(
  ruleId: string,
  args: RunArgs,
  status: "succeeded" | "failed" | "skipped",
  steps: StepResult[],
  error: string | null
): Promise<void> {
  await prisma.automationRun.create({
    data: {
      companyId: args.companyId,
      ruleId,
      leadId: args.leadId,
      status,
      // `follow` is engine plumbing, not something a human reading the run log
      // needs to see. Stripped rather than stored.
      steps: steps.map(({ type, ok, detail }) => ({ type, ok, detail })),
      error,
      finishedAt: new Date(),
    },
  });
}
