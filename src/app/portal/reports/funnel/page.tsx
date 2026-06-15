import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { PageHeader } from "@/components/portal/ui";
import { ReportsControls } from "@/components/portal/reports-client";
import { RenderableReportView } from "@/components/portal/renderable-report";
import { resolvePeriod, resolveScope, getScopeOptions } from "@/server/modules/reports/builders";
import { buildFunnelReport } from "@/server/modules/reports/funnel";

export const metadata = { title: "Sales Funnel & Velocity" };

export default async function FunnelReportPage({
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
  const report = await buildFunnelReport(ru, period, scope);

  return (
    <div className="space-y-6">
      <Link href="/portal/reports" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> All reports
      </Link>
      <PageHeader title="Sales Funnel & Velocity" description="Stage-by-stage pipeline waterfall, time-in-stage, and where deals stall." />
      <ReportsControls preset={period.preset} from={from} to={to} scope={scope.value} scopeOptions={scopeOptions} basePath="/portal/reports/funnel" blurb="Sales funnel & pipeline velocity." />
      <p className="text-sm text-muted-foreground">{report.periodLabel} · {report.scopeLabel}</p>
      <RenderableReportView report={report} />
    </div>
  );
}
