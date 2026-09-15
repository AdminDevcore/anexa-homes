import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { DEAL_LABEL_SELECT, dealLabel } from "./deal-label";
import { resolveSecretRef } from "./secrets";
import type { AgentDeps, DealSnapshot } from "./types";

const DEAL_SELECT = {
  id: true,
  ...DEAL_LABEL_SELECT,
  stageChangedAt: true,
  stage: { select: { key: true, name: true } },
} satisfies Prisma.LeadSelect;

type DealRow = Prisma.LeadGetPayload<{ select: typeof DEAL_SELECT }>;

const DEFAULT_DEALS = 100;
const MAX_DEALS = 500;

function toSnapshot(lead: DealRow): DealSnapshot {
  return {
    id: lead.id,
    label: dealLabel(lead),
    stageKey: lead.stage?.key ?? null,
    stageName: lead.stage?.name ?? null,
    stageChangedAt: lead.stageChangedAt,
  };
}

/**
 * The real world, for one run. Every query here is a READ, and the runner calls
 * the handler inside runInVertical, so a roofing run cannot see a solar deal.
 */
export function buildDeps(companyId: string): AgentDeps {
  return {
    now: () => new Date(),
    secrets: { get: (ref) => resolveSecretRef(companyId, ref) },
    deals: {
      async get(leadId) {
        const lead = await prisma.lead.findFirst({ where: { id: leadId, companyId }, select: DEAL_SELECT });
        return lead ? toSnapshot(lead) : null;
      },
      async inStages(stageKeys, opts) {
        if (stageKeys.length === 0) return [];
        const leads = await prisma.lead.findMany({
          where: { companyId, stage: { key: { in: stageKeys } } },
          orderBy: { stageChangedAt: "asc" },
          take: Math.min(Math.max(opts?.limit ?? DEFAULT_DEALS, 1), MAX_DEALS),
          select: DEAL_SELECT,
        });
        return leads.map(toSnapshot);
      },
    },
  };
}
