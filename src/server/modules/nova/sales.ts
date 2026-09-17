import type { FinanceProduct, Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import type { AccessUser } from "@/server/rbac/guards";
import { listScope } from "@/server/rbac/policies";
import { REPORTED_PROPOSAL_ORDER } from "@/lib/solar-system-of-record";
import { readProposalSnapshot } from "@/lib/solar-proposal";
import { getSaleLine } from "@/server/modules/pipeline/sale-line";

/**
 * SALES AND DEAL VALUE, COMPUTED FROM SOURCE.
 *
 * Nothing in this file reads the dashboard's aggregates, and that is
 * deliberate. As of September 2026 those numbers are wrong in two ways that
 * look like a slow month rather than a bug:
 *
 *   - Dashboard revenue and the leaderboard's SOLD column add up
 *     `Project.contractValue` — they count PROJECTS (a job created for
 *     production), not deals that signed. On solar that column is usually 0.
 *   - `Lead.value` on a solar deal is the household's price AFTER tax credits,
 *     stamped for the pipeline board. It is not the contract.
 *
 * So Nova defines both from the records themselves:
 *
 *   A CONTRACT SIGNED is a Solar deal whose stage is at or past the company's
 *   sale line (the "Counts as sold" stage — Contract Signed — via getSaleLine,
 *   which also excludes lost stages), dated by when it FIRST entered that line
 *   (LeadStageEvent.enteredAt), within the caller's own row scope.
 *
 *   ITS VALUE is `snapshot.financing.finalPriceCents` on the proposal the
 *   deal reports — the approved version, else the newest — using the same
 *   REPORTED_PROPOSAL_ORDER the deal page uses. A deal with no priced proposal
 *   is counted and named, never added as $0.
 *
 * boundaries.test.ts fails the build if this module ever reaches for the
 * dashboard aggregates or selects `Lead.value`.
 */

export type ReportedPrice = {
  /** Null when the proposal carries no price (a lease, a PPA, or a zero). */
  contractPriceCents: number | null;
  product: FinanceProduct | null;
  version: number;
  approved: boolean;
};

export const CONTRACT_VALUE_RULE =
  "the contract price on each deal's approved proposal, or its newest proposal when none is approved — not the after-credit deal value, and not project totals";

/** The reported proposal's price for each deal that has a proposal at all. */
export async function reportedPrices(
  companyId: string,
  leadIds: string[]
): Promise<Map<string, ReportedPrice>> {
  const out = new Map<string, ReportedPrice>();
  // One query per deal so each one asks the deal page's exact question —
  // REPORTED_PROPOSAL_ORDER is a query, not a function, and re-implementing the
  // ordering in memory is how two surfaces end up disagreeing.
  await Promise.all(
    leadIds.map(async (leadId) => {
      const p = await prisma.solarProposal.findFirst({
        where: { companyId, leadId },
        orderBy: REPORTED_PROPOSAL_ORDER,
        select: { version: true, approvedAt: true, snapshot: true },
      });
      if (!p) return;
      const financing = readProposalSnapshot(p.snapshot)?.financing;
      const cents = financing?.finalPriceCents ?? null;
      out.set(leadId, {
        // Zero means unpriced here, never a price — the solar-deal-value rule.
        contractPriceCents: cents != null && cents > 0 ? cents : null,
        product: financing?.product ?? null,
        version: p.version,
        approved: p.approvedAt != null,
      });
    })
  );
  return out;
}

export type SignedDeal = {
  leadId: string;
  customer: string;
  rep: string | null;
  signedAt: Date;
  price: ReportedPrice | null;
};

/** True when the caller's Lead scope is narrower than the whole company. */
export function scopeIsNarrowed(user: AccessUser): boolean {
  return Object.keys(listScope(user, "Lead")).some((k) => k !== "companyId");
}

export async function contractsSigned(
  user: AccessUser,
  range: { start: Date; endExclusive: Date }
): Promise<{ saleLineLabel: string | null; deals: SignedDeal[]; undated: number }> {
  const saleLine = await getSaleLine(user.companyId, "solar");
  const stageIds = [...saleLine.stageIds];
  if (stageIds.length === 0) return { saleLineLabel: null, deals: [], undated: 0 };

  const scope = listScope(user, "Lead") as Prisma.LeadWhereInput;
  const leads = await prisma.lead.findMany({
    where: { AND: [scope, { vertical: "solar" }, { stageId: { in: stageIds } }] },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      assignedRep: { select: { firstName: true, lastName: true } },
    },
  });
  if (leads.length === 0) return { saleLineLabel: saleLine.label, deals: [], undated: 0 };

  const events = await prisma.leadStageEvent.findMany({
    where: { leadId: { in: leads.map((l) => l.id) }, stageId: { in: stageIds } },
    orderBy: { enteredAt: "asc" },
    select: { leadId: true, enteredAt: true },
  });
  const firstSigned = new Map<string, Date>();
  for (const e of events) if (!firstSigned.has(e.leadId)) firstSigned.set(e.leadId, e.enteredAt);

  const inPeriod = leads.filter((l) => {
    const at = firstSigned.get(l.id);
    return at != null && at >= range.start && at < range.endExclusive;
  });
  const prices = await reportedPrices(user.companyId, inPeriod.map((l) => l.id));

  return {
    saleLineLabel: saleLine.label,
    undated: leads.filter((l) => !firstSigned.has(l.id)).length,
    deals: inPeriod
      .map((l) => ({
        leadId: l.id,
        customer: `${l.firstName} ${l.lastName}`.trim(),
        rep: l.assignedRep ? `${l.assignedRep.firstName} ${l.assignedRep.lastName}`.trim() : null,
        signedAt: firstSigned.get(l.id)!,
        price: prices.get(l.id) ?? null,
      }))
      .sort((a, b) => a.signedAt.getTime() - b.signedAt.getTime()),
  };
}
