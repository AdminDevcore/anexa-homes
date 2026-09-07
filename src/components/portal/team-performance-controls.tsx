"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * The window the Team Performance screen reports on.
 *
 * Presets carry no dates in the URL — `?period=month` re-resolves against today
 * every time it is opened, so a link a manager bookmarks or pastes into chat
 * still means "this month" next month. Only a custom range pins actual dates.
 */
const PRESETS = [
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "quarter", label: "This quarter" },
  { value: "ytd", label: "Year to date" },
  { value: "all", label: "All time" },
] as const;

export function TeamPerformanceControls({
  preset,
  from,
  to,
  basePath = "/portal/team/performance",
}: {
  preset: string;
  from: string;
  to: string;
  basePath?: string;
}) {
  const router = useRouter();
  const [customFrom, setCustomFrom] = React.useState(from);
  const [customTo, setCustomTo] = React.useState(to);

  function go(next: { period: string; from?: string; to?: string }) {
    const params = new URLSearchParams({ period: next.period });
    if (next.period === "custom" && next.from && next.to) {
      params.set("from", next.from);
      params.set("to", next.to);
    }
    router.push(`${basePath}?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap gap-1">
        {PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => go({ period: p.value })}
            aria-pressed={preset === p.value}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              preset === p.value
                ? "border-gold/50 bg-gold/10 text-gold-muted"
                : "border-border text-muted-foreground hover:bg-muted",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1.5 sm:ml-auto">
        <input
          type="date"
          aria-label="From"
          value={customFrom}
          onChange={(e) => setCustomFrom(e.target.value)}
          className={cn(
            "h-8 rounded-md border bg-background px-2 text-xs",
            preset === "custom" ? "border-gold/50" : "border-border",
          )}
        />
        <span className="text-xs text-muted-foreground">→</span>
        <input
          type="date"
          aria-label="To"
          value={customTo}
          onChange={(e) => setCustomTo(e.target.value)}
          className={cn(
            "h-8 rounded-md border bg-background px-2 text-xs",
            preset === "custom" ? "border-gold/50" : "border-border",
          )}
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
    </div>
  );
}
