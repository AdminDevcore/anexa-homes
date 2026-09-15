import { z } from "zod";
import { prisma } from "@/server/db/client";
import { recordStageEntry } from "@/server/modules/pipeline/stage-history";
import { solarStageRequirementError } from "@/server/modules/pipeline/solar-stage-requirements";
import { stageEntryData } from "@/server/modules/pipeline/stage-entry-data";
import type { ActionContext, AutomationActionModule, StepResult } from "../types";

const schema = z.object({ stageId: z.string().min(1) });

/**
 * Move the deal to a stage.
 *
 * Goes through `recordStageEntry` like every other path that moves a deal, so
 * cycle-time history has no hole where the automation did the moving.
 *
 * It deliberately does NOT re-fire the engine itself. It reports the follow-up
 * on its StepResult and the engine re-enters, because only the engine knows the
 * current depth — and an action importing the engine would be an import cycle,
 * since the engine imports the action registry.
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
      select: { id: true, key: true, name: true, position: true, defaultBlocker: true, stageType: true },
    });
    if (!stage) return fail("That stage no longer exists.");

    const lead = await prisma.lead.findFirst({
      where: { id: ctx.leadId, companyId: ctx.companyId },
      select: { id: true, stageId: true, vertical: true },
    });
    if (!lead) return fail("Deal not found.");
    if (lead.stageId === stage.id) {
      return { type: "move_stage", ok: true, detail: `Already in ${stage.name}.` };
    }

    const requirementError = await solarStageRequirementError({
      companyId: ctx.companyId,
      leadId: lead.id,
      vertical: lead.vertical,
      stage,
    });
    if (requirementError) return fail(requirementError);

    await prisma.lead.update({ where: { id: lead.id }, data: stageEntryData(stage) });
    await recordStageEntry({ leadId: lead.id, stageId: stage.id, stage, via: "automation" });

    await prisma.activityLog.create({
      data: {
        companyId: ctx.companyId,
        type: "stage_change",
        message: `Automation moved the deal to ${stage.name}`,
        actorId: null,
        leadId: lead.id,
      },
    });

    // Landing in a stage IS the stage_entered trigger, so a rule waiting there
    // must get its turn. Reported rather than fired here — see StepResult.follow.
    return {
      type: "move_stage",
      ok: true,
      detail: `Moved to ${stage.name}.`,
      follow: { trigger: "stage_entered", payload: { stageId: stage.id } },
    };
  },
};

function fail(detail: string): StepResult {
  return { type: "move_stage", ok: false, detail };
}
