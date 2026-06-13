"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Download, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type ScopeOption = { value: string; label: string };

const PERIOD_PRESETS = [
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "quarter", label: "This quarter" },
  { value: "ytd", label: "Year to date" },
] as const;

export function ReportsControls({
  preset,
  from,
  to,
  scope,
  scopeOptions,
}: {
  preset: string;
  from: string;
  to: string;
  scope: string;
  scopeOptions: ScopeOption[];
}) {
  const router = useRouter();
  const [customFrom, setCustomFrom] = React.useState(from);
  const [customTo, setCustomTo] = React.useState(to);

  function go(next: Partial<{ period: string; scope: string; from: string; to: string }>) {
    const params = new URLSearchParams();
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">One combined report — operations, financials &amp; payroll.</p>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <a href={`/portal/reports/pdf?${query(preset, scope, customFrom, customTo)}`} target="_blank" rel="noreferrer">
              <FileText className="size-4" /> Download PDF
            </a>
          </Button>
          <Button asChild size="sm" variant="outline">
            <a href={`/portal/reports/export?${query(preset, scope, customFrom, customTo)}`}>
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
                preset === p.value ? "border-gold/50 bg-gold/10 text-gold-muted" : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {p.label}
            </button>
          ))}
          <span
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium",
              preset === "custom" ? "border-gold/50 bg-gold/10 text-gold-muted" : "border-border text-muted-foreground",
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

function query(period: string, scope: string, from: string, to: string): string {
  const p = new URLSearchParams({ period, scope });
  if (period === "custom" && from && to) {
    p.set("from", from);
    p.set("to", to);
  }
  return p.toString();
}
