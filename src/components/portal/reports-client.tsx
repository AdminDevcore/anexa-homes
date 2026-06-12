"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Download, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type ReportType = "operations" | "financial" | "payroll";
type ScopeOption = { value: string; label: string };

const PERIOD_PRESETS = [
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "quarter", label: "This quarter" },
  { value: "ytd", label: "Year to date" },
] as const;

const TYPE_LABELS: Record<ReportType, string> = {
  operations: "Operations",
  financial: "Financial",
  payroll: "Payroll",
};

export function ReportsControls({
  type,
  preset,
  from,
  to,
  scope,
  allowedTypes,
  scopeOptions,
}: {
  type: ReportType;
  preset: string;
  from: string;
  to: string;
  scope: string;
  allowedTypes: ReportType[];
  scopeOptions: ScopeOption[];
}) {
  const router = useRouter();
  const [customFrom, setCustomFrom] = React.useState(from);
  const [customTo, setCustomTo] = React.useState(to);

  function go(next: Partial<{ type: string; period: string; scope: string; from: string; to: string }>) {
    const params = new URLSearchParams();
    params.set("type", next.type ?? type);
    params.set("period", next.period ?? preset);
    params.set("scope", next.scope ?? scope);
    const f = next.from ?? customFrom;
    const t = next.to ?? customTo;
    if ((next.period ?? preset) === "custom" && f && t) {
      params.set("from", f);
      params.set("to", t);
    }
    router.push(`/portal/reports?${params.toString()}`);
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      {/* Report type */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg border border-border bg-background p-1">
          {allowedTypes.map((t) => (
            <button
              key={t}
              onClick={() => go({ type: t })}
              className={cn(
                "rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors",
                type === t ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"
              )}
            >
              {TYPE_LABELS[t]}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <a href={`/portal/reports/pdf?${query(type, preset, scope, customFrom, customTo)}`} target="_blank" rel="noreferrer">
              <FileText className="size-4" /> Download PDF
            </a>
          </Button>
          <Button asChild size="sm" variant="outline">
            <a href={`/portal/reports/export?${query(type, preset, scope, customFrom, customTo)}`}>
              <Download className="size-4" /> CSV
            </a>
          </Button>
        </div>
      </div>

      {/* Period + scope */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1">
          {PERIOD_PRESETS.map((p) => (
            <button
              key={p.value}
              onClick={() => go({ period: p.value })}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                preset === p.value ? "border-gold/50 bg-gold/10 text-gold-muted" : "border-border text-muted-foreground hover:bg-muted"
              )}
            >
              {p.label}
            </button>
          ))}
          <span
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium",
              preset === "custom" ? "border-gold/50 bg-gold/10 text-gold-muted" : "border-border text-muted-foreground"
            )}
          >
            Custom
          </span>
        </div>

        {/* Custom range */}
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs"
          />
          <span className="text-xs text-muted-foreground">→</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!customFrom || !customTo}
            onClick={() => go({ period: "custom", from: customFrom, to: customTo })}
          >
            Apply
          </Button>
        </div>

        {scopeOptions.length > 1 && (
          <select
            value={scope}
            onChange={(e) => go({ scope: e.target.value })}
            className="ml-auto h-8 rounded-md border border-border bg-background px-2 text-xs"
          >
            {scopeOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}

function query(type: string, period: string, scope: string, from: string, to: string): string {
  const p = new URLSearchParams({ type, period, scope });
  if (period === "custom" && from && to) {
    p.set("from", from);
    p.set("to", to);
  }
  return p.toString();
}
