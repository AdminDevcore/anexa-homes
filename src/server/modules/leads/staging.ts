import { prisma } from "@/server/db/client";
import { APPOINTMENT_SET_KEY, entryStage } from "@/lib/pipeline-entry";

/**
 * Appointments and the pipeline are the same records viewed two ways. The FRONT
 * of every pipeline is driven by the appointment date so no lead is ever lost:
 *
 *   • no appointment date  → first stage ("New Lead / New Appointment")
 *   • has appointment date → "Appointment Set" stage (if the pipeline defines one)
 *
 * A deal that has already progressed PAST those two front stages is left exactly
 * where it is — editing/clearing a date never drags a working job backwards.
 *
 * Pass the candidate stage the caller wants (form selection, or the lead's
 * current stage); we return the stage the lead should actually be in. The rule
 * itself lives in `@/lib/pipeline-entry` so the intake form can show the rep
 * the answer before they submit.
 */
export async function resolveStageForAppointment(opts: {
  pipelineId: string | null;
  candidateStageId: string | null;
  hasAppointment: boolean;
}): Promise<string | null> {
  const { pipelineId, candidateStageId, hasAppointment } = opts;
  if (!pipelineId) return candidateStageId;

  const stages = await prisma.pipelineStage.findMany({
    where: { pipelineId },
    orderBy: { position: "asc" },
    select: { id: true, key: true },
  });
  if (stages.length === 0) return candidateStageId;

  const first = stages[0];
  const apptSet = stages.find((s) => s.key === APPOINTMENT_SET_KEY) ?? null;
  const frontIds = new Set<string>([first.id, ...(apptSet ? [apptSet.id] : [])]);

  // Only auto-stage the front of the pipeline (unstaged, or in New Lead / Appt Set).
  const atFront = candidateStageId == null || frontIds.has(candidateStageId);
  if (!atFront) return candidateStageId;

  return entryStage(stages, hasAppointment)?.id ?? candidateStageId;
}
