import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { PageHeader } from "@/components/portal/ui";
import { ReportScopeControls } from "@/components/portal/report-scope-controls";
import { RenderableReportView } from "@/components/portal/renderable-report";
import { resolveScope, getScopeOptions } from "@/server/modules/reports/builders";
import { buildClaimsReport } from "@/server/modules/reports/claims";

export const metadata = { title: "Claims & Supplement Capture" };

export default async function ClaimsReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  if (!can(user, "read", "Report")) redirect("/portal/dashboard");

  const sp = await searchParams;
  const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

  const ru = { companyId: user.companyId, userId: user.userId, role: user.role };
  const [scope, scopeOptions] = await Promise.all([resolveScope(ru, str(sp.scope)), getScopeOptions(ru)]);
  const report = await buildClaimsReport(ru, scope);

  return (
    <div className="space-y-6">
      <Link href="/portal/reports" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> All reports
      </Link>
      <PageHeader title="Claims & Supplement Capture" description="RCV/ACV exposure, recoverable depreciation, and supplement approval rate." />
      <ReportScopeControls scope={scope.value} scopeOptions={scopeOptions} basePath="/portal/reports/claims" blurb="Current insurance claims snapshot." />
      <p className="text-sm text-muted-foreground">{report.periodLabel} · {report.scopeLabel}</p>
      <RenderableReportView report={report} />
    </div>
  );
}
