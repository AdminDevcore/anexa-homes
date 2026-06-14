import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { PageHeader } from "@/components/portal/ui";
import { getBookkeepingData, getJobSettlements } from "@/server/modules/bookkeeping/queries";
import { JobProfitabilityTable, type JobProfitRow } from "@/components/portal/job-profitability-table";

export const metadata = { title: "Job Profitability" };

export default async function JobProfitabilityPage() {
  const user = await requireUser();
  // Profit per job includes commission, so it needs both Report and Commission read.
  if (!can(user, "read", "Report")) redirect("/portal/dashboard");
  if (!can(user, "read", "Commission")) redirect("/portal/reports");

  const data = await getBookkeepingData(user.companyId);
  const settlements = await getJobSettlements(
    user.companyId,
    data.jobs.map((j) => ({ projectId: j.projectId, moneyInCents: j.moneyInCents, leadId: j.leadId }))
  );

  const rows: JobProfitRow[] = data.jobs
    .map((j): JobProfitRow | null => {
      const s = settlements[j.projectId];
      if (!s) return null;
      // Company profit = revenue − job cost − PA fee − rep commission. Company
      // overhead is RETAINED by the company (not an external outflow), so it is
      // NOT subtracted — it's part of company profit alongside the company's share
      // of the split. (Estimate uses scope cost + rep estimate; actual uses booked
      // cost + ALL generated payouts.)
      const estProfit = s.collectibleCents - s.estCostCents - s.paFeeCents - s.commissionEstimateCents;
      const actualProfit = s.hasActualCommission
        ? s.collectibleCents - s.jobCostCents - s.paFeeCents - s.commissionActualCents
        : null;
      const overridesActual = s.commissionActualCents - s.repCommissionActualCents;
      return {
        projectId: j.projectId,
        leadId: j.leadId,
        label: j.label,
        repName: s.repName,
        repSplitPct: s.repSplitPct,
        repDeductiblePct: s.repDeductiblePct,
        repWaivesSupplement: s.repWaivesSupplement,
        supplementWaivedKeptCents: s.supplementWaivedKeptCents,
        companyProvidedLead: s.companyProvidedLead,
        contractCents: s.contractCents,
        supplementCents: s.supplementCents,
        deductibleCents: s.deductibleCents,
        collectibleCents: s.collectibleCents,
        collectedCents: s.collectedCents,
        leftToCollectCents: s.leftToCollectCents,
        estCostCents: s.estCostCents,
        actualCostCents: s.jobCostCents,
        overheadCents: s.overheadCents,
        paFeeCents: s.paFeeCents,
        repCommissionEstCents: s.commissionEstimateCents,
        repCommissionActualCents: s.hasActualCommission ? s.repCommissionActualCents : null,
        overridesActualCents: s.hasActualCommission ? overridesActual : null,
        totalCommissionActualCents: s.hasActualCommission ? s.commissionActualCents : null,
        estProfitCents: estProfit,
        actualProfitCents: actualProfit,
        hasActual: s.hasActualCommission,
        commissionLines: s.commissionLines.map((l) => ({ recipient: l.recipient, label: l.label, amountCents: l.amountCents })),
      };
    })
    .filter((r): r is JobProfitRow => !!r)
    .sort((a, b) => b.leftToCollectCents - a.leftToCollectCents);

  return (
    <div className="space-y-6">
      <Link href="/portal/reports" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to reports
      </Link>
      <PageHeader
        title="Job Profitability"
        description="Projected profit per customer — profit, rep commission, cost, and money to collect. Click a job for the full Deal-Financials waterfall."
      />
      <JobProfitabilityTable rows={rows} />
    </div>
  );
}
