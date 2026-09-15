import { prisma } from "@/server/db/client";
import type { ActiveVertical } from "@/lib/vertical";
import { runAutomations } from "@/server/modules/automations/engine";
import { contractSignedMoveError } from "@/server/modules/pipeline/contract-signed";
import { stageEntryData } from "@/server/modules/pipeline/stage-entry-data";
import { recordStageEntry } from "@/server/modules/pipeline/stage-history";
import { fundingGateError } from "@/server/modules/payroll/funding-authority";
import { DEAL_LABEL_SELECT, dealLabel } from "./deal-label";
import type { RequestedChange, ResolvedChange, TargetStage } from "./types";

export const TARGET_STAGE_SELECT = {
  id: true,
  key: true,
  name: true,
  position: true,
  isActionRequired: true,
  defaultBlocker: true,
  stageType: true,
} as const;

export type StageMove = { leadId: string; stageId: string };

export type MovedBy =
  | { kind: "agent"; agentName: string }
  | { kind: "person"; userId: string; fullName: string; agentName: string };

/**
 * Everything the gate needs about each change. Call inside runInVertical: Lead
 * is scoped, so a deal in another workspace is simply not found, which the
 * gate records as invalid. The target key resolves in the deal's OWN pipeline.
 *
 * Agents obey main's two solar stage rules exactly as a person's move does —
 * Contract Signed (pipeline/contract-signed.ts) and M1 Funding
 * (payroll/funding-authority.ts) — except an agent carries no one's authority,
 * so funding is checked with `actor: null`, same as an automation rule. Both
 * rules are asked separately, not through stageMoveError, because the gate
 * (gate.ts) treats a Contract Signed refusal and a funding refusal
 * differently: the first always invalidates the change, the second only
 * invalidates a change that would otherwise apply — a held change stays held
 * for the approving person's own authority to decide at Apply.
 *
 * Both refusals are left null for a change whose deal or target stage was not
 * found, or that is already sitting in its target stage: there is nothing to
 * cross.
 */
export async function resolveChanges(companyId: string, changes: RequestedChange[]): Promise<ResolvedChange[]> {
  const resolved: ResolvedChange[] = [];
  for (const change of changes) {
    const lead = await prisma.lead.findFirst({
      where: { id: change.leadId, companyId },
      select: {
        id: true,
        pipelineId: true,
        vertical: true,
        stageId: true,
        ...DEAL_LABEL_SELECT,
        stage: { select: { id: true, key: true, name: true } },
      },
    });
    const toStage: TargetStage | null = lead?.pipelineId
      ? await prisma.pipelineStage.findFirst({
          where: { pipelineId: lead.pipelineId, key: change.toStageKey },
          select: TARGET_STAGE_SELECT,
        })
      : null;

    let contractRefusal: string | null = null;
    let fundingRefusal: string | null = null;
    if (lead && toStage && lead.stageId !== toStage.id) {
      contractRefusal = await contractSignedMoveError({
        companyId,
        lead: { id: lead.id, vertical: lead.vertical, stageId: lead.stageId },
        targetStageId: toStage.id,
      });
      fundingRefusal = await fundingGateError({
        companyId,
        actor: null,
        lead: { id: lead.id, vertical: lead.vertical },
        targetStageId: toStage.id,
      });
    }

    resolved.push({
      change,
      lead: lead ? { id: lead.id, label: dealLabel(lead) } : null,
      fromStage: lead?.stage ?? null,
      toStage,
      contractRefusal,
      fundingRefusal,
    });
  }
  return resolved;
}

/**
 * Move one deal the way a person's move does (leads/actions.ts moveLeadStage):
 * the stage-entry fields, the timeline row, the activity line, and the
 * stage_changed notification. Call inside the run's workspace.
 *
 * Does NOT re-check either stage rule: the caller runs them first —
 * resolveChanges for a run, stageMoveError at Apply for a person approving one.
 *
 * Automations are NOT fired here: the engine establishes its own workspace, so
 * the caller runs runStageEnteredAutomations after leaving runInVertical.
 */
export async function moveDeal(companyId: string, leadId: string, stage: TargetStage, by: MovedBy): Promise<void> {
  await prisma.lead.update({ where: { id: leadId }, data: stageEntryData(stage) });
  await recordStageEntry({
    leadId,
    stageId: stage.id,
    stage,
    ...(by.kind === "agent" ? { via: "agent" as const } : { movedById: by.userId }),
  });
  await prisma.activityLog.create({
    data: {
      companyId,
      type: "stage_change",
      message:
        by.kind === "agent"
          ? `Agent "${by.agentName}" moved the deal to ${stage.name}`
          : `${by.fullName} moved the deal to ${stage.name}, approving agent "${by.agentName}"`,
      actorId: by.kind === "person" ? by.userId : null,
      leadId,
    },
  });
  // Lazily loaded and wrapped: the move is the record, the alert a consequence.
  try {
    const { fireEvent } = await import("@/server/modules/notifications/engine");
    await fireEvent({
      companyId,
      event: "stage_changed",
      actorId: by.kind === "person" ? by.userId : null,
      leadId,
      stageId: stage.id,
    });
  } catch (err) {
    console.error("[agents] stage_changed notification did not load", err);
  }
}

/** Rules waiting at a stage get their turn. Agents are never triggered by automations, so this cannot loop. */
export async function runStageEnteredAutomations(
  companyId: string,
  vertical: ActiveVertical,
  moves: StageMove[]
): Promise<void> {
  for (const move of moves) {
    await runAutomations({
      companyId,
      vertical,
      trigger: "stage_entered",
      leadId: move.leadId,
      payload: { stageId: move.stageId },
      depth: 0,
    });
  }
}
