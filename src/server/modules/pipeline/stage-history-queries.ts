import { prisma } from "@/server/db/client";
import { buildTimeline, type StageEventRow, type Timeline } from "@/lib/stage-history";

/**
 * The cycle-time timeline for one deal, ready to render.
 *
 * Reached through the lead, which the caller has already scoped — LeadStageEvent
 * is a child table with no companyId of its own (see server/vertical/models.ts).
 */
export async function leadStageTimeline(lead: {
  id: string;
  createdAt: Date;
  pipelineId: string | null;
  stageId: string | null;
  stageName: string | null;
  stageChangedAt: Date | null;
}): Promise<Timeline> {
  const [events, wonStages] = await Promise.all([
    prisma.leadStageEvent.findMany({
      where: { leadId: lead.id },
      orderBy: { enteredAt: "asc" },
      select: {
        id: true,
        stageId: true,
        stageName: true,
        position: true,
        enteredAt: true,
        exitedAt: true,
        via: true,
        movedBy: { select: { firstName: true, lastName: true } },
      },
    }),
    lead.pipelineId
      ? prisma.pipelineStage.findMany({
          where: { pipelineId: lead.pipelineId, isWon: true },
          select: { id: true },
        })
      : Promise.resolve([]),
  ]);

  // A deal that has not moved since before history existed has no rows yet.
  // Show the stage it IS in, timed from the best clock we have, rather than an
  // empty card that reads as "nothing ever happened here".
  if (!events.length && lead.stageId && lead.stageName) {
    return buildTimeline(
      [
        {
          id: `current-${lead.stageId}`,
          stageId: lead.stageId,
          stageName: lead.stageName,
          position: 0,
          enteredAt: (lead.stageChangedAt ?? lead.createdAt).toISOString(),
          exitedAt: null,
        },
      ],
      { createdAt: lead.createdAt.toISOString(), wonStageIds: new Set(wonStages.map((s) => s.id)) }
    );
  }

  const rows: StageEventRow[] = events.map((e) => ({
    id: e.id,
    stageId: e.stageId,
    stageName: e.stageName,
    position: e.position,
    enteredAt: e.enteredAt.toISOString(),
    exitedAt: e.exitedAt ? e.exitedAt.toISOString() : null,
    movedBy: e.movedBy ? `${e.movedBy.firstName} ${e.movedBy.lastName}`.trim() : null,
    via: e.via === "automation" || e.via === "signature" || e.via === "document" ? e.via : null,
  }));

  return buildTimeline(rows, {
    createdAt: lead.createdAt.toISOString(),
    wonStageIds: new Set(wonStages.map((s) => s.id)),
  });
}
