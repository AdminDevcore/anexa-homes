import { prisma } from "@/server/db/client";

// Commissions (and therefore payroll, which is built from approved commissions)
// can only be generated once a deal reaches the "Depreciation Requested" stage.
export const COMMISSION_GATE_STAGE_KEY = "depreciation_requested";
export const COMMISSION_GATE_LABEL = "Depreciation Requested";

/**
 * Pipeline-stage IDs that are at or past the "Depreciation Requested" gate, for
 * every pipeline in the company. A deal is commission/payroll-eligible only when
 * its stage is in this set. If a (custom) pipeline has no depreciation stage,
 * we fall back to its won stages so commissions are still possible there.
 */
export async function getCommissionEligibleStageIds(companyId: string): Promise<Set<string>> {
  const pipelines = await prisma.pipeline.findMany({
    where: { companyId },
    select: {
      stages: {
        select: { id: true, key: true, name: true, position: true, isWon: true },
        orderBy: { position: "asc" },
      },
    },
  });

  const eligible = new Set<string>();
  for (const p of pipelines) {
    const gate = p.stages.find((s) => s.key === COMMISSION_GATE_STAGE_KEY || /depreciation/i.test(s.name));
    if (gate) {
      for (const s of p.stages) if (s.position >= gate.position) eligible.add(s.id);
    } else {
      for (const s of p.stages) if (s.isWon) eligible.add(s.id);
    }
  }
  return eligible;
}

/** Is a single deal (by its current stage) eligible for commission/payroll generation? */
export async function isStageCommissionEligible(companyId: string, stageId: string | null): Promise<boolean> {
  if (!stageId) return false;
  const eligible = await getCommissionEligibleStageIds(companyId);
  return eligible.has(stageId);
}
