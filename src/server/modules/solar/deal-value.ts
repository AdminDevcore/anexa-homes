import { prisma } from "@/server/db/client";
import {
  snapshotPriceSource,
  solarContractRevenueCents,
  solarLeadValueCents,
} from "@/lib/solar-deal-value";
import { REPORTED_PROPOSAL_ORDER } from "@/lib/solar-system-of-record";
import type { SolarProposalSnapshot } from "@/lib/solar-proposal";

/**
 * Put the deal's two denormalised totals back in step with the document it is
 * reported at.
 *
 * TWO COLUMNS, TWO DIFFERENT FIGURES, and the distinction is the whole point:
 *
 *   `Lead.value`             the household's NET after the federal credits
 *                            their document quotes. What the pipeline board and
 *                            the funnel add up, and a deliberate product
 *                            decision — see `solarLeadValueCents`.
 *
 *   `Project.contractValue`  what the CONTRACT is written for, before any
 *                            credit. What every revenue surface adds up.
 *
 * Both are DENORMALISED COPIES of the reported proposal. The deal page derives
 * its own figures from the snapshot and reads neither; every list reads one of
 * them, and a deal reading one number on its own page and another in the
 * pipeline is the defect this exists to stop.
 *
 * WHY THE PROJECT COLUMN IS HERE. It was written once, at Project creation,
 * from `lead.claimPrice ?? lead.value` — which on solar is the after-credit net
 * — and never touched again. So a $56,000 contract was booked as $39,200 of
 * revenue on the rep scorecard, the dashboard, the financial summary and every
 * other Project-based report: exactly the contract less a 30% credit the
 * homeowner claims on their own return months later and which never reduces
 * what the company is owed. Stamping it here, from the same document and at the
 * same three moments as `Lead.value`, makes the column mean what its name says
 * on both verticals.
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

  const price = snapshotPriceSource(snapshot.financing);
  await prisma.lead.update({
    where: { id: leadId },
    data: { value: solarLeadValueCents(price) },
  });

  /**
   * And the contract, onto the job — where there is one.
   *
   * `updateMany` rather than `update`: a deal that has not started production
   * has no Project yet, and a missing job is the ordinary case rather than an
   * error. When one is created later it stamps itself from `Lead.claimPrice ??
   * Lead.value`, which is the NET — so `ensureProjectForLeadAction` re-stamps
   * through this same function immediately afterwards. See that action.
   *
   * Scoped on the lead's own vertical, not on the caller's: this runs from a
   * customer's signature, which has no workspace of its own.
   */
  const contractCents = solarContractRevenueCents(price);
  if (contractCents > 0) {
    await prisma.project.updateMany({
      where: { companyId, leadId, vertical: "solar" },
      data: { contractValue: contractCents },
    });
  }
}
