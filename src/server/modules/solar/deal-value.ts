import { prisma } from "@/server/db/client";
import { snapshotPriceSource, solarLeadValueCents } from "@/lib/solar-deal-value";
import { REPORTED_PROPOSAL_ORDER } from "@/lib/solar-system-of-record";
import type { SolarProposalSnapshot } from "@/lib/solar-proposal";

/**
 * Put `Lead.value` back in step with the document the deal is reported at.
 *
 * `Lead.value` is roofing's typed-in field, and on a solar deal it is a
 * DENORMALISED COPY of the reported proposal's price — what the pipeline board,
 * the dashboard, the funnel report and lead-source revenue add up. The deal
 * page derives its own figure from the snapshot and never reads this column;
 * every list does, and a deal reading one number on its own page and another in
 * the pipeline is the defect this exists to stop.
 *
 * Called wherever the ANSWER can move, which is three moments, not one:
 * generating a version, approving one, and un-approving one. Generation alone
 * was enough while the newest version always won; it stopped being enough the
 * moment approval could hand the report back to an older document.
 *
 * Deliberately NOT inside the caller's transaction. Those exist to keep a
 * customer's live link and the versions in step, and a denormalised total is
 * not worth widening their blast radius: a failure here leaves the proposal
 * standing and one number stale, which the next call corrects.
 */
export async function restampLeadValue(companyId: string, leadId: string): Promise<void> {
  const reported = await prisma.solarProposal.findFirst({
    where: { companyId, leadId },
    orderBy: REPORTED_PROPOSAL_ORDER,
    select: { snapshot: true },
  });
  // No proposal left at all: nobody has been quoted anything, and writing a
  // working figure into the column every revenue report sums would book a sale
  // that has not happened.
  if (!reported) return;
  const snapshot = reported.snapshot as unknown as SolarProposalSnapshot | null;
  if (!snapshot?.financing) return;
  await prisma.lead.update({
    where: { id: leadId },
    data: { value: solarLeadValueCents(snapshotPriceSource(snapshot.financing)) },
  });
}
