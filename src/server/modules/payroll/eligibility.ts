import { prisma } from "@/server/db/client";
import { eligibleStageIds } from "./gate";

export {
  COMMISSION_GATE_STAGE_KEY,
  COMMISSION_GATE_LABEL,
  commissionGateLabel,
  findGateStage,
} from "./gate";

/**
 * Pipeline-stage IDs at or past their pipeline's gate, for every pipeline in the
 * company. A deal is commission/payroll-eligible only when its stage is in this
 * set. See ./gate.ts for where each vertical's gate sits, why, and what the
 * position/lost rules are.
 */
export async function getCommissionEligibleStageIds(companyId: string): Promise<Set<string>> {
  const pipelines = await prisma.pipeline.findMany({
    where: { companyId },
    select: {
      vertical: true,
      stages: {
        select: { id: true, key: true, name: true, position: true, isWon: true, isLost: true },
        orderBy: { position: "asc" },
      },
    },
  });
  return eligibleStageIds(pipelines);
}

/** Is a single deal (by its current stage) eligible for commission/payroll generation? */
export async function isStageCommissionEligible(companyId: string, stageId: string | null): Promise<boolean> {
  if (!stageId) return false;
  const eligible = await getCommissionEligibleStageIds(companyId);
  return eligible.has(stageId);
}
