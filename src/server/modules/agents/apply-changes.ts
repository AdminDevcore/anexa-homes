import type { Prisma } from "@prisma/client";
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
 * THE WRITE IS CONDITIONAL ON THE STAGE THE CALLER SAW. `fromStageId` is the
 * stage `resolveChanges` found the deal in; the update only takes effect if
 * the deal is STILL there. A rep can cancel a deal — or approve, or run,
 * another change — between the moment a run resolves its changes and the
 * moment this applies one, and writing the agent's target unconditionally
 * would silently carry a cancelled (or otherwise since-moved) deal back onto
 * the board. `pipeline/contract-signed.ts`'s own unattended mover,
 * `advanceToContractSignedIfReady`, guards its write the same way and for the
 * same reason. When the deal has moved since, NOTHING is written: this throws
 * rather than applying a stale move, and the caller decides what that means
 * for its run.
 *
 * Does NOT re-check either stage rule: the caller runs them first —
 * resolveChanges for a run, stageMoveError at Apply for a person approving one.
 *
 * THE LEAD WRITE, THE TIMELINE ROW AND THE ACTIVITY LINE COMMIT TOGETHER, in
 * one transaction: a half-finished move — the lead moved but the activity
 * line failed to write — must never be recorded by a caller as "not applied"
 * when the deal in fact did move. `stage_changed` fires AFTER the transaction
 * commits, still wrapped exactly as before, so a notification failure can
 * never roll back a move that already happened.
 *
 * Automations are NOT fired here: the engine establishes its own workspace, so
 * the caller runs runStageEnteredAutomations after leaving runInVertical.
 */
export async function moveDeal(
  companyId: string,
  leadId: string,
  fromStageId: string | null,
  stage: TargetStage,
  by: MovedBy
): Promise<void> {
  // stageEntryData() connects the relation (`stage: { connect }`), which
  // updateMany's scalar-only input can't take — swap it for the plain
  // `stageId` column updateMany does accept, and leave every other field as
  // stage-entry-data.ts computed it.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropping the relation field only
  const { stage: _connect, ...entryFields } = stageEntryData(stage);
  const data: Prisma.LeadUncheckedUpdateManyInput = { ...entryFields, stageId: stage.id };

  await prisma.$transaction(async (tx) => {
    const moved = await tx.lead.updateMany({ where: { id: leadId, companyId, stageId: fromStageId }, data });
    if (moved.count !== 1) {
      throw new Error("This deal has moved since the agent looked at it; nothing was changed.");
    }
    await recordStageEntry(
      {
        leadId,
        stageId: stage.id,
        stage,
        ...(by.kind === "agent" ? { via: "agent" as const } : { movedById: by.userId }),
      },
      // recordStageEntry is typed off the BASE PrismaClient on purpose (see
      // its own doc comment) so a plain client can stand in for it; the
      // extended client's transaction handle is structurally the same client
      // for these two pass-through models (stage-history.ts says so: neither
      // is vertical-scoped), but its generated type carries the extension's
      // own generics, which the base type doesn't know about. Cast to exactly
      // the parameter recordStageEntry declares, not the whole client, so
      // this claims no more than it needs.
      //
      // A SIDE EFFECT OF PASSING tx: recordStageEntry never throws on its own
      // (its own doc comment says so), but inside a Postgres transaction a
      // failed statement aborts the WHOLE transaction, not just itself — the
      // next statement fails with "current transaction is aborted" even
      // though recordStageEntry swallowed its own error. That next statement
      // is tx.activityLog.create below, which is NOT wrapped, so its failure
      // propagates and rolls the move back. Before this change, a timeline
      // write on its own connection could never fail a move this way. For an
      // agent that is the right outcome: the run records the move as not
      // applied, which is now true.
      tx as unknown as Parameters<typeof recordStageEntry>[1]
    );
    await tx.activityLog.create({
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
  });

  // Lazily loaded and wrapped: the move already committed, so a notification
  // failure here is a consequence, never a reason to undo it.
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
