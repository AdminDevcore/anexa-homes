import { redirect } from "next/navigation";
import Link from "next/link";
import { Briefcase } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { PageHeader } from "@/components/portal/ui";
import { ReportsControls } from "@/components/portal/reports-client";
import {
  resolvePeriod,
  resolveScope,
  getScopeOptions,
  buildMasterReport,
  type ReportResult,
} from "@/server/modules/reports/builders";
import { cn } from "@/lib/utils";

export const metadata = { title: "Reports" };

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  if (!can(user, "read", "Report")) redirect("/portal/dashboard");

  const sp = await searchParams;
  const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

  const preset = str(sp.period) || "week";
  const from = str(sp.from);
  const to = str(sp.to);
  const period = resolvePeriod(preset, from, to);

  const ru = { companyId: user.companyId, userId: user.userId, role: user.role };
  const [scope, scopeOptions] = await Promise.all([resolveScope(ru, str(sp.scope)), getScopeOptions(ru)]);
  const master = await buildMasterReport(ru, period, scope);

  const canSeeJobProfit = can(user, "read", "Commission");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title="Company Report" description="One report — operations, financials, and payroll by period and team." />
        {canSeeJobProfit && (
          <Link
            href="/portal/reports/jobs"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-muted"
          >
            <Briefcase className="size-4" /> Job profitability
          </Link>
        )}
      </div>

      <ReportsControls preset={period.preset} from={from} to={to} scope={scope.value} scopeOptions={scopeOptions} />

      <p className="text-sm text-muted-foreground">{master.periodLabel} · {master.scopeLabel}</p>

      {master.sections.map((section) => (
        <ReportSection key={section.type} section={section} />
      ))}
    </div>
  );
}

function ReportSection({ section }: { section: ReportResult }) {
  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card/40 p-5">
      <h3 className="font-display text-lg font-semibold tracking-tight">{section.title}</h3>

      {/* Metrics */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {section.metrics.map((m) => (
          <div key={m.label} className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{m.label}</span>
              {m.hint && <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">{m.hint}</span>}
            </div>
            <div className="mt-2 flex items-end justify-between gap-3">
              <div className="min-w-0">
                <div
                  className={cn(
                    "font-display text-2xl font-semibold tracking-tight",
                    m.tone === "pos" && "text-emerald-600",
                    m.tone === "neg" && "text-red-600",
                  )}
                >
                  {m.value}
                </div>
                {m.deltaPct !== undefined && <DeltaBadge pct={m.deltaPct} lowerIsBetter={m.lowerIsBetter} />}
              </div>
              {m.series && m.series.length > 1 && <Sparkline values={m.series} />}
            </div>
          </div>
        ))}
      </div>

      {/* Tables */}
      {section.tables.length > 0 && (
        <div className="grid gap-5 lg:grid-cols-2">
          {section.tables.map((t) => (
            <div key={t.title} className="overflow-x-auto rounded-xl border border-border bg-card">
              <div className="border-b border-border px-4 py-3 text-sm font-semibold">{t.title}</div>
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    {t.columns.map((c, i) => (
                      <th key={c} className={cn("px-4 py-2 font-medium", i === 0 ? "text-left" : "text-right")}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {t.rows.length === 0 && (
                    <tr><td colSpan={t.columns.length} className="px-4 py-6 text-center text-muted-foreground">No data for this period.</td></tr>
                  )}
                  {t.rows.map((row, ri) => (
                    <tr key={ri}>
                      {row.map((cell, ci) => (
                        <td key={ci} className={cn("px-4 py-2", ci === 0 ? "text-left font-medium" : "text-right tabular-nums")}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function DeltaBadge({ pct, lowerIsBetter }: { pct: number; lowerIsBetter?: boolean }) {
  const flat = Math.abs(pct) < 0.5;
  const good = lowerIsBetter ? pct < 0 : pct > 0;
  return (
    <span
      className={cn(
        "mt-1 inline-flex items-center gap-1 text-xs font-medium",
        flat ? "text-muted-foreground" : good ? "text-emerald-600" : "text-red-600",
      )}
    >
      <span>{flat ? "→" : pct > 0 ? "↑" : "↓"}</span>
      {Math.abs(pct) >= 999 ? ">999" : Math.abs(pct).toFixed(0)}%
      <span className="font-normal text-muted-foreground">vs prev</span>
    </span>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const w = 76, h = 30, pad = 3;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => pad + (i / (values.length - 1)) * (w - pad * 2);
  const y = (v: number) => h - pad - ((v - min) / span) * (h - pad * 2);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const up = values[values.length - 1] >= values[0];
  const stroke = up ? "#059669" : "#dc2626";
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0" aria-hidden>
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r="1.8" fill={stroke} />
    </svg>
  );
}
