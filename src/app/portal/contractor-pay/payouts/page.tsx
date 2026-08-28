import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { PageHeader } from "@/components/portal/ui";
import { ReportsControls } from "@/components/portal/reports-client";
import { RenderableReportView } from "@/components/portal/renderable-report";
import { ContractorPayTabs } from "@/components/portal/contractor-pay-tabs";
import { resolvePeriod, resolveScope, getScopeOptions } from "@/server/modules/reports/builders";
import { buildContractorPayReport } from "@/server/modules/reports/contractor-pay";

export const metadata = { title: "Contractor Payouts" };

/**
 * Moved here from `/portal/reports/contractor-pay`, unchanged.
 *
 * It answers "what do we owe the crews", which is the other half of the
 * question the Invoices tab asks. Leaving it in the Reports hub put two things
 * called Contractor Pay in two places, and neither one linked to the other.
 * The old URL still resolves — it redirects — so bookmarks and the PDFs already
 * mailed out keep working.
 */
export default async function ContractorPayoutsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  if (!can(user, "read", "ContractorInvoice")) redirect("/portal/dashboard");
  // The payout figures are commission and ledger money, so they keep the
  // Commission gate they were built with rather than inheriting this page's.
  if (!can(user, "read", "Commission")) redirect("/portal/contractor-pay");

  const sp = await searchParams;
  const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

  const preset = str(sp.period) || "month";
  const from = str(sp.from);
  const to = str(sp.to);
  const period = resolvePeriod(preset, from, to);

  const ru = { companyId: user.companyId, userId: user.userId, role: user.role };
  const [scope, scopeOptions] = await Promise.all([resolveScope(ru, str(sp.scope)), getScopeOptions(ru)]);
  const report = await buildContractorPayReport(ru, period, scope);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contractor Pay"
        description="Money paid and still owed to installer-crews and 1099 contractors."
      />

      <ContractorPayTabs active="payouts" showPayouts />

      <ReportsControls
        preset={period.preset}
        from={from}
        to={to}
        scope={scope.value}
        scopeOptions={scopeOptions}
        basePath="/portal/contractor-pay/payouts"
        blurb="Money paid and still owed to installer-crews and 1099 contractors."
      />

      <p className="text-sm text-muted-foreground">{report.periodLabel} · {report.scopeLabel}</p>

      <RenderableReportView report={report} />
    </div>
  );
}
