import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db/client";
import type { StageMoveVia } from "@/lib/stage-history";

/**
 * Records how long a deal spends in each pipeline stage.
 *
 * One row per visit to a stage, closed when the deal leaves it. Every path that
 * puts a lead into a stage calls `recordStageEntry` — creation, the pipeline
 * drag, the deal-page dropdown, canvassing, a customer signing online — because
 * a cycle-time history with holes in it is a cycle-time history nobody trusts.
 *
 * Deliberately NON-THROWING. This is measurement, not a business record: a rep
 * dragging a card across the board must never see an error because the audit
 * write failed. A gap in the history is recoverable from the activity log; a
 * stage move that appears to fail (and gets retried) is not.
 */

/**
 * Typed off the BASE client, not the extended one the app exports, so a test can
 * hand this a plain PrismaClient pointed at its own schema. Both models here are
 * outside vertical isolation — LeadStageEvent is a child of Lead and
 * PipelineStage a child of Pipeline — so the extension is a no-op for them and
 * the two client flavours behave identically.
 */
type Db = Pick<PrismaClient, "leadStageEvent" | "pipelineStage">;

export type StageEntryInput = {
  leadId: string;
  stageId: string | null;
  /** Saves a lookup when the caller already has the stage in hand. */
  stage?: { id: string; name: string; position?: number } | null;
  at?: Date;
  /** The signed-in user who moved it. Leave it off only when no person did. */
  movedById?: string | null;
  /** Say why no person is named: a rule moved it, or a signature did. */
  via?: StageMoveVia | null;
};

export async function recordStageEntry(input: StageEntryInput, db?: Db): Promise<void> {
  try {
    await writeStageEntry(input, db ?? (prisma as unknown as Db));
  } catch (err) {
    console.error("[stage-history] failed to record stage entry", { leadId: input.leadId, err });
  }
}

async function writeStageEntry(input: StageEntryInput, db: Db): Promise<void> {
  const { leadId, stageId } = input;
  if (!stageId) return; // A lead with no stage has nothing to time.

  const open = await db.leadStageEvent.findFirst({
    where: { leadId, exitedAt: null },
    orderBy: { enteredAt: "desc" },
    select: { id: true, stageId: true, enteredAt: true },
  });

  // Already sitting in this stage: a save that didn't move it, or a double
  // submit. Re-opening would split one span into two and halve both numbers.
  if (open && open.stageId === stageId) return;

  const stage =
    input.stage && input.stage.id === stageId
      ? { name: input.stage.name, position: input.stage.position ?? 0 }
      : await db.pipelineStage.findUnique({
          where: { id: stageId },
          select: { name: true, position: true },
        });
  if (!stage) return;

  // Never let a stage close before it opened — a clock skew or a backdated
  // write would otherwise produce a negative duration.
  const now = input.at ?? new Date();
  const at = open && open.enteredAt > now ? open.enteredAt : now;

  if (open) {
    // updateMany, not update: if a past bug ever left two rows open, this
    // closes both rather than leaving one to poison every later reading.
    await db.leadStageEvent.updateMany({ where: { leadId, exitedAt: null }, data: { exitedAt: at } });
  }

  await db.leadStageEvent.create({
    data: {
      leadId,
      stageId,
      stageName: stage.name,
      position: stage.position,
      enteredAt: at,
      movedById: input.movedById ?? null,
      via: input.via ?? null,
    },
  });
}
