/**
 * Reconstructs stage history for deals that predate the LeadStageEvent table.
 *
 * The activity log already recorded every stage move ("X moved lead to Y") with
 * a timestamp, so the timeline for existing deals is recoverable rather than
 * lost — a cycle-time report that only starts counting from the day it shipped
 * is not worth reading for another six months.
 *
 * Idempotent: a lead that already has events is skipped, so this is safe to
 * re-run. Pass --dry to print what it would write and change nothing.
 *
 *   npx tsx scripts/backfill-stage-history.ts [--dry]
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DRY = process.argv.includes("--dry");

/** "Mustafa Joulani moved lead to Contract Signed" → "Contract Signed" */
function stageNameFrom(message: string): string | null {
  const m = message.match(/ moved lead to (.+)$/);
  return m ? m[1].trim() : null;
}

async function main() {
  const leads = await prisma.lead.findMany({
    select: {
      id: true,
      createdAt: true,
      stageId: true,
      stageChangedAt: true,
      pipelineId: true,
      stage: { select: { id: true, name: true, position: true } },
      _count: { select: { stageEvents: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  let touched = 0;
  let written = 0;

  for (const lead of leads) {
    if (lead._count.stageEvents > 0) continue; // already has history
    if (!lead.stageId || !lead.stage) continue; // nothing to time

    const stages = lead.pipelineId
      ? await prisma.pipelineStage.findMany({
          where: { pipelineId: lead.pipelineId },
          select: { id: true, name: true, position: true },
          orderBy: { position: "asc" },
        })
      : [];
    const byName = new Map(stages.map((s) => [s.name.trim().toLowerCase(), s]));

    const logs = await prisma.activityLog.findMany({
      where: { leadId: lead.id, type: "stage_change" },
      select: { message: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });

    // Every deal starts in its pipeline's first stage on the day it was created.
    const first = stages[0];
    const steps: { stage: { id: string; name: string; position: number } | null; name: string; at: Date }[] = [];
    if (first) steps.push({ stage: first, name: first.name, at: lead.createdAt });

    for (const log of logs) {
      const name = stageNameFrom(log.message);
      if (!name) continue; // "cancelled the deal — ..." and friends: no target stage in the text
      const stage = byName.get(name.toLowerCase()) ?? null;
      const prev = steps[steps.length - 1];
      if (prev && prev.name.toLowerCase() === name.toLowerCase()) continue;
      steps.push({ stage, name, at: log.createdAt });
    }

    // Not every path wrote an activity row (an inline edit that changed the
    // stage, a customer signing). If the deal is somewhere the log never
    // mentions, close the reconstruction with where it actually is.
    const last = steps[steps.length - 1];
    if (!last || last.stage?.id !== lead.stageId) {
      const at = lead.stageChangedAt ?? lead.createdAt;
      steps.push({
        stage: lead.stage,
        name: lead.stage.name,
        at: last && at < last.at ? last.at : at,
      });
    }

    if (!steps.length) continue;

    const rows = steps.map((s, i) => ({
      leadId: lead.id,
      stageId: s.stage?.id ?? null,
      stageName: s.name,
      position: s.stage?.position ?? 0,
      enteredAt: s.at,
      exitedAt: i < steps.length - 1 ? steps[i + 1].at : null,
    }));

    touched++;
    written += rows.length;
    if (DRY) {
      console.log(
        `${lead.id}: ` +
          rows.map((r) => `${r.stageName} @ ${r.enteredAt.toISOString().slice(0, 10)}`).join(" → ")
      );
    } else {
      await prisma.leadStageEvent.createMany({ data: rows });
    }
  }

  console.log(
    `${DRY ? "[dry] would backfill" : "backfilled"} ${written} stage events across ${touched} deals ` +
      `(${leads.length} scanned)`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
