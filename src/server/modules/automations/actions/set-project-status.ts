import { z } from "zod";
import { prisma } from "@/server/db/client";
import type { ActionContext, AutomationActionModule, StepResult } from "../types";

const STATUSES = [
  "not_started",
  "in_production",
  "on_hold",
  "qc",
  "completed",
  "closed",
  "cancelled",
] as const;

const schema = z.object({ status: z.enum(STATUSES) });

/**
 * Set the project status.
 *
 * A separate action from move_stage even though both "advance the job": they
 * are different tables with different enums, and one action whose config means
 * two unrelated things is one nobody can read in the rule list.
 */
export const setProjectStatusAction: AutomationActionModule = {
  type: "set_project_status",

  parseConfig(raw) {
    const parsed = schema.safeParse(raw);
    return parsed.success
      ? { ok: true, config: parsed.data }
      : { ok: false, error: "Pick a project status." };
  },

  async run(ctx: ActionContext): Promise<StepResult> {
    const parsed = schema.safeParse(ctx.config);
    if (!parsed.success) return fail("Misconfigured: no status.");

    const project = await prisma.project.findFirst({
      where: { leadId: ctx.leadId, companyId: ctx.companyId },
      select: { id: true, status: true },
    });
    // Loud, not silent: a rule that sets a status on a deal with no project is
    // a rule somebody wrote wrong, and the run log is where they find that out.
    if (!project) return fail("This deal has no project to set a status on.");

    if (project.status === parsed.data.status) {
      return { type: "set_project_status", ok: true, detail: `Already ${parsed.data.status}.` };
    }

    await prisma.project.update({
      where: { id: project.id },
      data: { status: parsed.data.status },
    });

    await prisma.activityLog.create({
      data: {
        companyId: ctx.companyId,
        type: "status_change",
        message: `Automation set the project status to ${parsed.data.status}`,
        actorId: null,
        leadId: ctx.leadId,
        projectId: project.id,
      },
    });

    return { type: "set_project_status", ok: true, detail: `Set to ${parsed.data.status}.` };
  },
};

function fail(detail: string): StepResult {
  return { type: "set_project_status", ok: false, detail };
}
