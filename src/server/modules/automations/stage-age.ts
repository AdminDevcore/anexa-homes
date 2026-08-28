import { prisma } from "@/server/db/client";
import { runAutomations } from "./engine";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Daily pass for `stage_age_exceeded` rules — the one trigger with no user
 * action behind it.
 *
 * Two-phase on purpose. Finding the work reads ACROSS workspaces, so the caller
 * wraps this in `runUnscoped`; doing the work is then handed to
 * `runAutomations`, which re-establishes the rule's own workspace before
 * touching anything. Sweeping unscoped and acting scoped is the only shape that
 * is both complete and isolated.
 *
 * A `once` rule does not re-fire day after day — the AutomationRun row from the
 * first pass stops it. That is exactly why `once` defaults to on.
 *
 * Returns how many deals were acted on, for the cron's response body.
 */
export async function runStageAgeAutomations(now: number = Date.now()): Promise<number> {
  const rules = await prisma.automationRule.findMany({
    where: { trigger: "stage_age_exceeded", active: true },
    select: { id: true, companyId: true, vertical: true, conditions: true },
  });

  let fired = 0;

  for (const rule of rules) {
    const cond =
      rule.conditions && typeof rule.conditions === "object"
        ? (rule.conditions as { stageId?: unknown; days?: unknown })
        : {};
    const stageId = typeof cond.stageId === "string" ? cond.stageId : null;
    const days = typeof cond.days === "number" && cond.days > 0 ? cond.days : null;
    // A rule with no stage or no threshold would sweep every open deal every
    // day. The editor will not save one; a hand-edited row is skipped here.
    if (!stageId || !days) continue;

    const cutoff = new Date(now - days * DAY_MS);

    // Deals sitting in that stage RIGHT NOW (exitedAt null is the open span),
    // which arrived before the cutoff.
    const stuck = await prisma.leadStageEvent.findMany({
      where: {
        exitedAt: null,
        stageId,
        enteredAt: { lte: cutoff },
        lead: { companyId: rule.companyId, vertical: rule.vertical, status: "open" },
      },
      select: { leadId: true, enteredAt: true },
    });

    for (const s of stuck) {
      const waited = Math.floor((now - s.enteredAt.getTime()) / DAY_MS);
      // No runInVertical here: the engine establishes the workspace itself from
      // the vertical passed in.
      await runAutomations({
        companyId: rule.companyId,
        vertical: rule.vertical,
        trigger: "stage_age_exceeded",
        leadId: s.leadId,
        payload: { stageId, days: waited },
        depth: 0,
      });
      fired++;
    }
  }

  return fired;
}
