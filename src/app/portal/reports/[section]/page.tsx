import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { PageHeader } from "@/components/portal/ui";
import { ReportsControls } from "@/components/portal/reports-client";
import { ReportSectionView } from "@/components/portal/report-section-view";
import { SECTION_META } from "@/server/modules/reports/catalog";
import {
  resolvePeriod,
  resolveScope,
  getScopeOptions,
  buildReportSection,
  allowedSections,
  type ReportType,
} from "@/server/modules/reports/builders";

function isSection(s: string): s is ReportType {
  return s === "executive" || s === "operations" || s === "financial" || s === "payroll";
}

export async function generateMetadata({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  return { title: isSection(section) ? SECTION_META[section].title : "Report" };
}

export default async function ReportSectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ section: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { section } = await params;
  if (!isSection(section)) notFound();

  const user = await requireUser();
  if (!can(user, "read", "Report")) redirect("/portal/dashboard");
  if (!allowedSections(user.role).includes(section)) redirect("/portal/reports");

  const sp = await searchParams;
  const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

  const preset = str(sp.period) || "week";
  const from = str(sp.from);
  const to = str(sp.to);
  const period = resolvePeriod(preset, from, to);

  const ru = { companyId: user.companyId, userId: user.userId, role: user.role };
  const [scope, scopeOptions] = await Promise.all([resolveScope(ru, str(sp.scope)), getScopeOptions(ru)]);
  const report = await buildReportSection(ru, section, period, scope);

  const meta = SECTION_META[section];

  return (
    <div className="space-y-6">
      <Link href="/portal/reports" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> All reports
      </Link>

      <PageHeader title={meta.title} description={meta.description} />

      <ReportsControls preset={period.preset} from={from} to={to} scope={scope.value} scopeOptions={scopeOptions} basePath={`/portal/reports/${section}`} />

      <p className="text-sm text-muted-foreground">{report.periodLabel} · {report.scopeLabel}</p>

      <ReportSectionView report={report} />
    </div>
  );
}
