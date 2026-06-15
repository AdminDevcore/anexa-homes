import type { RenderableReport } from "@/server/modules/reports/builders";
import { cn } from "@/lib/utils";

/** Generic renderer for a report's metric cards + tables (PDF/CSV use the same data). */
export function RenderableReportView({ report }: { report: RenderableReport }) {
  return (
    <div className="space-y-6">
      {report.metrics.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {report.metrics.map((m) => (
            <div key={m.label} className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{m.label}</span>
                {m.hint && <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">{m.hint}</span>}
              </div>
              <div
                className={cn(
                  "mt-2 font-display text-2xl font-semibold tracking-tight",
                  m.tone === "pos" && "text-emerald-600",
                  m.tone === "neg" && "text-red-600",
                )}
              >
                {m.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {report.tables.map((t) => (
        <div key={t.title} className="overflow-x-auto rounded-2xl border border-border bg-card">
          <div className="border-b border-border px-5 py-3 text-sm font-semibold">{t.title}</div>
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
  );
}
