import { z } from "zod";
import { prisma } from "@/server/db/client";
import { recordStageEntry } from "@/server/modules/pipeline/stage-history";
import type { ActionContext, AutomationActionModule, StepResult } from "../types";

const schema = z.object({ stageId: z.string().min(1) });

/**
 * Move the deal to a stage.
 *
 * Goes through `recordStageEntry` like every other path that moves a deal, so
 * cycle-time history has no hole where the automation did the moving.
 *
 * It deliberately does NOT re-fire the automation engine itself — the engine
 * does that after the action returns, because only the engine knows the current
 * depth and it is the thing that has to stop a loop.
 */
export const moveStageAction: AutomationActionModule = {
  type: "move_stage",

  parseConfig(raw) {
    const parsed = schema.safeParse(raw);
    return parsed.success
      ? { ok: true, config: parsed.data }
      : { ok: false, error: "Pick the stage to move the deal to." };
  },

  async run(ctx: ActionContext): Promise<StepResult> {
    const parsed = schema.safeParse(ctx.config);
    if (!parsed.success) return fail("Misconfigured: no target stage.");

    // Scoped to the company on purpose: a stage id is chosen in a dropdown, but
    // a rule outlives the stage it names, and an id from another tenant must
    // never move a deal.
    const stage = await prisma.pipelineStage.findFirst({
      where: { id: parsed.data.stageId, pipeline: { companyId: ctx.companyId } },
      select: { id: true, name: true, position: true },
    });
    if (!stage) return fail("That stage no longer exists.");

    const lead = await prisma.lead.findFirst({
      where: { id: ctx.leadId, companyId: ctx.companyId },
      select: { id: true, stageId: true },
    });
    if (!lead) return fail("Deal not found.");
    if (lead.stageId === stage.id) {
      return { type: "move_stage", ok: true, detail: `Already in ${stage.name}.` };
    }

    await prisma.lead.update({ where: { id: lead.id }, data: { stageId: stage.id } });
    await recordStageEntry({ leadId: lead.id, stageId: stage.id, stage });

    await prisma.activityLog.create({
      data: {
        companyId: ctx.companyId,
        type: "stage_change",
        message: `Automation moved the deal to ${stage.name}`,
        actorId: null,
        leadId: lead.id,
      },
    });

    return { type: "move_stage", ok: true, detail: `Moved to ${stage.name}.` };
  },
};

function fail(detail: string): StepResult {
  return { type: "move_stage", ok: false, detail };
}
