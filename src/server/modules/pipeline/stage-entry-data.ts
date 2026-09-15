import type { Prisma } from "@prisma/client";

type StageEntry = Pick<
  Prisma.PipelineStageGetPayload<{ select: { id: true; defaultBlocker: true; stageType: true } }>,
  "id" | "defaultBlocker" | "stageType"
>;

/**
 * What lands on the lead when it enters a stage.
 *
 * Entering a stage means a fresh SLA clock and a fresh follow-up clock: the
 * alerts that fired against the previous stage are cleared, and the chase
 * history is wiped so the cadence counts from this entry.
 */
export function stageEntryData(stage: StageEntry): Prisma.LeadUpdateInput {
  return {
    stage: { connect: { id: stage.id } },
    stageChangedAt: new Date(),
    stageAlertLevel: 0,
    stageOverdue: false,
    blockedBy: stage.defaultBlocker,
    lastTouchAt: null,
    lastChaseAlertAt: null,
    ...(stage.stageType === "internally_owned" ? { blockerNote: null } : {}),
  };
}
