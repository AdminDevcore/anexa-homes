import { prisma } from "@/server/db/client";
import { snapshotPriceSource, solarContractRevenueCents } from "@/lib/solar-deal-value";
import { REPORTED_PROPOSAL_ORDER } from "@/lib/solar-system-of-record";
import { readProposalSnapshot } from "@/lib/solar-proposal";

/**
 * What each of these solar deals CONTRACTED for, read from the document it is
 * reported at.
 *
 * WHY REPORTS NEED THIS AT ALL, when `Project.contractValue` is now stamped
 * with the same figure: a solar deal is SOLD before it has a job. The Project
 * row is created by "Start production", which happens after the contract is
 * signed and often days later — so between those two moments the deal is past
 * the sale line, counts as won, and has no Project for a revenue query to sum.
 * A rep scorecard showing `won: 1, jobs: 0, revenue: $0` on one row is the
 * visible shape of that gap.
 *
 * So the Project column is the fast path and this is the fallback, and the two
 * agree because both are `solarContractRevenueCents` over the same reported
 * proposal.
 *
 * THE GROSS, NEVER THE NET. See `solarContractRevenueCents` — the federal
 * credit is claimed by the homeowner on their own return and never reduces
 * what the company booked.
 *
 * One query for the whole page rather than one per lead: reports render
 * hundreds of rows and an N+1 here would be felt.
 */
export async function solarContractByLead(
  companyId: string,
  leadIds: string[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (leadIds.length === 0) return out;

  /**
   * Every proposal on these deals, in reported order, and the first one per
   * lead wins.
   *
   * Sorted in SQL by the same ordering the deal page and the value stamp use —
   * approved first (`nulls: "last"` is load-bearing; Postgres sorts NULLs FIRST
   * on a DESC order), then newest version. Taking the first occurrence of each
   * lead as the array is walked is therefore taking the reported version,
   * without a per-lead query or a groupBy Prisma cannot express over JSON.
   */
  const rows = await prisma.solarProposal.findMany({
    where: { companyId, leadId: { in: leadIds } },
    orderBy: [{ leadId: "asc" }, ...REPORTED_PROPOSAL_ORDER],
    select: { leadId: true, snapshot: true },
  });

  for (const row of rows) {
    if (out.has(row.leadId)) continue; // a later version of a lead already answered
    const snapshot = readProposalSnapshot(row.snapshot);
    if (!snapshot?.financing) continue;
    const cents = solarContractRevenueCents(snapshotPriceSource(snapshot.financing));
    // A deal quoted at nothing — a lease, a PPA, an unpriced draft — books
    // nothing, and recording a zero would only mask the Project's own answer.
    if (cents > 0) out.set(row.leadId, cents);
  }
  return out;
}

/**
 * The revenue one deal contributes, whichever of the two sources can answer.
 *
 * Pure, so the precedence can be proved without a database, and shared by every
 * report that needs it so they cannot drift apart.
 *
 * PRECEDENCE. The Project's own figure wins wherever there is a job, because
 * that is the column an admin can correct by hand on the Edit Job dialog and a
 * hand correction has to stick. The proposal answers only where no job exists
 * yet. On roofing there is no second source and the Project is the only answer,
 * which is exactly the behaviour that was there before.
 */
export function dealRevenueCents(input: {
  /** The job's contract, or null when production has not started. */
  projectContractCents: number | null;
  /** What the reported solar proposal says, or null on roofing / unpriced. */
  solarContractCents: number | null;
}): number {
  if (input.projectContractCents != null) return input.projectContractCents;
  return input.solarContractCents ?? 0;
}
