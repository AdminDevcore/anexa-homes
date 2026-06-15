import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { PageHeader } from "@/components/portal/ui";
import { DelinquencyControls } from "@/components/portal/delinquency-controls";
import { resolveScope, getScopeOptions } from "@/server/modules/reports/builders";
import { buildDelinquencyReport, type DelinquencyRow } from "@/server/modules/reports/delinquency";
import { cn } from "@/lib/utils";

export const metadata = { title: "Delinquency / Follow-up" };

export default async function DelinquencyReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  if (!can(user, "read", "Report")) redirect("/portal/dashboard");

  const sp = await searchParams;
  const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const includeDueSoon = str(sp.due) === "1";

  const ru = { companyId: user.companyId, userId: user.userId, role: user.role };
  const [scope, scopeOptions] = await Promise.all([resolveScope(ru, str(sp.scope)), getScopeOptions(ru)]);
  const report = await buildDelinquencyReport(scope, { includeDueSoon });

  const m = report.metrics;

  return (
    <div className="space-y-6">
      <Link href="/portal/reports" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> All reports
      </Link>

      <PageHeader
        title="Delinquency / Follow-up"
        description="Deals sitting in a pipeline stage past its day limit. Set each stage's limit in Settings → Pipeline."
      />

      <DelinquencyControls scope={scope.value} scopeOptions={scopeOptions} includeDueSoon={includeDueSoon} />

      <p className="text-sm text-muted-foreground">As of {report.generatedLabel} · {report.scopeLabel}</p>

      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Overdue deals" value={String(m.overdue)} tone="neg" />
        <SummaryCard label="Deals tracked" value={String(m.tracked)} hint="in SLA stages" />
        <SummaryCard label="Avg days over" value={String(m.avgOver)} hint="overdue deals" />
        <SummaryCard label="Worst offender" value={`${m.worst}d`} hint="days over" />
      </div>

      {report.groups.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center text-muted-foreground">
          🎉 Nothing past its stage limit{includeDueSoon ? "" : " — try “Include due soon”"}.
        </div>
      ) : (
        report.groups.map((g) => (
          <section key={g.stageName} className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="flex items-center gap-2 border-b border-border px-5 py-3">
              <span className="size-2.5 rounded-full" style={{ backgroundColor: g.stageColor }} />
              <h3 className="font-display text-base font-semibold tracking-tight">{g.stageName}</h3>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">limit {g.targetDays}d</span>
              <span className="ml-auto text-xs text-muted-foreground">{g.rows.length} deal{g.rows.length === 1 ? "" : "s"}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-5 py-2 text-left font-medium">Job / Customer</th>
                    <th className="px-4 py-2 text-left font-medium">Status</th>
                    <th className="px-4 py-2 text-right font-medium">Days in stage</th>
                    <th className="px-4 py-2 text-right font-medium">Days over</th>
                    <th className="px-4 py-2 text-left font-medium">Rep</th>
                    <th className="px-4 py-2 text-left font-medium">In stage since</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {g.rows.map((r) => (
                    <DelinquencyRowView key={r.leadId} row={r} />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function DelinquencyRowView({ row }: { row: DelinquencyRow }) {
  const overdue = row.status === "overdue";
  return (
    <tr className="hover:bg-muted/40">
      <td className="px-5 py-2.5 font-medium">
        <Link href={`/portal/leads/${row.leadId}`} className="hover:underline">{row.customer}</Link>
      </td>
      <td className="px-4 py-2.5">
        <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium", overdue ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700")}>
          {overdue ? "🔴 Overdue" : "🟡 Due soon"}
        </span>
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums">{row.daysInStage}</td>
      <td className={cn("px-4 py-2.5 text-right tabular-nums font-medium", overdue && "text-red-600")}>{overdue ? `+${row.daysOver}` : "—"}</td>
      <td className="px-4 py-2.5 text-muted-foreground">{row.rep}</td>
      <td className="px-4 py-2.5 text-muted-foreground">{row.inStageSince}</td>
    </tr>
  );
}

function SummaryCard({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "neg" }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        {hint && <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">{hint}</span>}
      </div>
      <div className={cn("mt-2 font-display text-2xl font-semibold tracking-tight", tone === "neg" && "text-red-600")}>{value}</div>
    </div>
  );
}
