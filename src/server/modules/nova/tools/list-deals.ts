import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { listScope } from "@/server/rbac/policies";
import { daysInStage, stageTiming } from "@/lib/stage-status";
import { NOT_CANCELLED } from "@/server/modules/leads/cancelled";
import { NOT_SET } from "../format";
import { defineTool, z } from "./define";
import { resolvePeople } from "./people";

const OVERDUE_RULE =
  "Past the stage's day limit, on stages the company owns. Stages waiting on a utility, AHJ, lender or customer are never counted as overdue.";

export const listDeals = defineTool({
  name: "list_deals",
  kind: "read",
  description:
    "List open Solar deals, optionally filtered by stage, by assigned rep, or to those overdue past their stage's day limit. Returns up to 25 with the total.",
  input: z.object({
    stage: z.string().trim().min(2).max(60).optional().describe("Part of a stage name, e.g. \"permitting\"."),
    rep: z.string().trim().min(2).max(60).optional().describe("\"me\", or part of the assigned rep's name."),
    overdue: z.boolean().optional().describe("Only deals past their stage's day limit."),
  }),
  async run(ctx, { stage, rep, overdue }) {
    const pipeline = await prisma.pipeline.findFirst({
      where: { companyId: ctx.user.companyId, vertical: "solar" },
      orderBy: { isDefault: "desc" },
      include: { stages: { orderBy: { position: "asc" } } },
    });
    if (!pipeline) return { ok: true, data: { deals: [], total: 0, note: "There is no Solar pipeline yet." } };

    let stageIds: string[] | null = null;
    if (stage) {
      const q = stage.toLowerCase();
      const matched = pipeline.stages.filter((s) => s.name.toLowerCase().includes(q));
      if (matched.length === 0) {
        return {
          ok: false,
          reason: "invalid",
          message: `No Solar stage matches "${stage}". The stages are: ${pipeline.stages.map((s) => s.name).join(", ")}.`,
        };
      }
      stageIds = matched.map((s) => s.id);
    }

    let repIds: string[] | null = null;
    if (rep) {
      const people = await resolvePeople(ctx, rep);
      if (people.length === 0) return { ok: false, reason: "invalid", message: `I don't know anyone called "${rep}".` };
      repIds = people.map((p) => p.id);
    }

    const scope = listScope(ctx.user, "Lead") as Prisma.LeadWhereInput;
    const leads = await prisma.lead.findMany({
      where: {
        AND: [
          scope,
          { vertical: "solar", pipelineId: pipeline.id },
          NOT_CANCELLED,
          stageIds ? { stageId: { in: stageIds } } : {},
          repIds ? { assignedRepId: { in: repIds } } : {},
        ],
      },
      take: 1000,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        createdAt: true,
        stageChangedAt: true,
        stage: { select: { name: true, targetDays: true, stageType: true } },
        assignedRep: { select: { firstName: true, lastName: true } },
      },
    });

    const now = ctx.now.getTime();
    const rows = leads.map((l) => {
      // Same rule as the stage alerts: only stages we own can be overdue.
      const timing =
        l.stage?.stageType === "internally_owned"
          ? stageTiming(l.stageChangedAt, l.createdAt, l.stage.targetDays, now)
          : null;
      return {
        deal_id: l.id,
        customer: `${l.firstName} ${l.lastName}`.trim(),
        stage: l.stage?.name ?? NOT_SET,
        assigned_rep: l.assignedRep ? `${l.assignedRep.firstName} ${l.assignedRep.lastName}`.trim() : NOT_SET,
        days_in_stage: daysInStage(l.stageChangedAt, l.createdAt, now),
        overdue_by_days: timing?.status === "overdue" ? timing.overdueBy : null,
      };
    });

    const kept = overdue ? rows.filter((r) => r.overdue_by_days != null) : rows;
    kept.sort((a, b) =>
      overdue ? (b.overdue_by_days ?? 0) - (a.overdue_by_days ?? 0) : b.days_in_stage - a.days_in_stage
    );

    return {
      ok: true,
      data: {
        deals: kept.slice(0, 25),
        total: kept.length,
        ...(overdue ? { overdue_rule: OVERDUE_RULE } : {}),
      },
    };
  },
});
