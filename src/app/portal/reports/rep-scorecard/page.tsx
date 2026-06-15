import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { PageHeader } from "@/components/portal/ui";
import { ReportsControls } from "@/components/portal/reports-client";
import { RenderableReportView } from "@/components/portal/renderable-report";
import { resolvePeriod, resolveScope, getScopeOptions } from "@/server/modules/reports/builders";
import { buildRepScorecardReport } from "@/server/modules/reports/rep-scorecard";

export const metadata = { title: "Rep Scorecard" };

export default async function RepScorecardReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  if (!can(user, "read", "Report")) redirect("/portal/dashboard");

  const sp = await searchParams;
  const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const preset = str(sp.period) || "month";
  const from = str(sp.from);
  const to = str(sp.to);
  const period = resolvePeriod(preset, from, to);

  const ru = { companyId: user.companyId, userId: user.userId, role: user.role };
  const [scope, scopeOptions] = await Promise.all([resolveScope(ru, str(sp.scope)), getScopeOptions(ru)]);
  const report = await buildRepScorecardReport(ru, period, scope);

  return (
    <div className="space-y-6">
      <Link href="/portal/reports" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> All reports
      </Link>
      <PageHeader title="Rep Scorecard" description="Per-rep appointments, close rate, jobs, revenue, commission, and open tasks." />
      <ReportsControls preset={period.preset} from={from} to={to} scope={scope.value} scopeOptions={scopeOptions} basePath="/portal/reports/rep-scorecard" blurb="Per-rep performance leaderboard." />
      <p className="text-sm text-muted-foreground">{report.periodLabel} · {report.scopeLabel}</p>
      <RenderableReportView report={report} />
    </div>
  );
}
