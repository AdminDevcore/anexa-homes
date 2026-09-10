import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { PageHeader } from "@/components/portal/ui";
import { ReportsControls } from "@/components/portal/reports-client";
import { RenderableReportView } from "@/components/portal/renderable-report";
import { resolvePeriod, resolveScope, getScopeOptions } from "@/server/modules/reports/builders";
import { buildContractorPayReport } from "@/server/modules/reports/contractor-pay";

export const metadata = { title: "Contractor Payouts" };

/**
 * Moved here from `/portal/reports/contractor-pay`, unchanged.
 *
 * It answers "what do we owe the crews" by PERIOD, which is the same money the
 * Contractor Pay tab lists invoice by invoice. That makes it a report rather
 * than a third half of the page, so it hangs off the tab it belongs to — a
 * button up in the header, and a way back at the top of this one — instead of
 * competing with Commissions for a tab.
 *
 * The old Reports-hub URL still resolves (it redirects), so bookmarks and the
 * PDFs already mailed out keep working.
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
      <Link
        href="/portal/contractor-pay"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Contractor Pay
      </Link>

      <PageHeader
        title="Contractor Pay"
        description="Money paid and still owed to installer-crews and 1099 contractors, by period."
      />

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
