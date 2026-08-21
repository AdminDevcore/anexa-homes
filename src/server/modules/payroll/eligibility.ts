import { prisma } from "@/server/db/client";

// Commissions (and therefore payroll, which is built from approved commissions)
// can only be generated once a deal reaches its vertical's gate stage.
//
// The gate is PER VERTICAL because the two pipelines are not the same shape.
// Roofing waits for the depreciation request. Solar has no such stage, and its
// only won stage is System Activated — the fallback would have held every solar
// commission until the utility granted PTO, months after the sale and past both
// of the rep's milestone payouts. Solar gates at Contract Signed instead: the
// line appears when the deal is sold, recomputes as the price moves, and sits
// `pending` until somebody approves it, so nothing pays early.
export const COMMISSION_GATE_STAGE_KEY = "depreciation_requested";
export const COMMISSION_GATE_LABEL = "Depreciation Requested";

/** The gate stage for each vertical: key to match on, and a name pattern for custom pipelines. */
const GATE_BY_VERTICAL: Record<string, { key: string; namePattern: RegExp; label: string }> = {
  roofing: { key: COMMISSION_GATE_STAGE_KEY, namePattern: /depreciation/i, label: COMMISSION_GATE_LABEL },
  solar: { key: "contract_signed", namePattern: /contract signed/i, label: "Contract Signed" },
};

/** What the UI tells a user no deal has reached yet, for the vertical they're in. */
export function commissionGateLabel(vertical: string): string {
  return GATE_BY_VERTICAL[vertical]?.label ?? COMMISSION_GATE_LABEL;
}

/**
 * Pipeline-stage IDs at or past their pipeline's gate, for every pipeline in the
 * company. A deal is commission/payroll-eligible only when its stage is in this
 * set. The gate depends on the pipeline's vertical (see GATE_BY_VERTICAL); a
 * custom pipeline carrying neither key nor a matching stage name falls back to
 * its won stages, so commissions are still possible there.
 */
export async function getCommissionEligibleStageIds(companyId: string): Promise<Set<string>> {
  const pipelines = await prisma.pipeline.findMany({
    where: { companyId },
    select: {
      vertical: true,
      stages: {
        select: { id: true, key: true, name: true, position: true, isWon: true },
        orderBy: { position: "asc" },
      },
    },
  });

  const eligible = new Set<string>();
  for (const p of pipelines) {
    const gateFor = GATE_BY_VERTICAL[p.vertical] ?? GATE_BY_VERTICAL.roofing;
    const gate = p.stages.find((s) => s.key === gateFor.key || gateFor.namePattern.test(s.name));
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
