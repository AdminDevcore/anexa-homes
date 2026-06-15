"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ScopeOption = { value: string; label: string };

/**
 * Scope picker + overdue/due-soon toggle + export links for the delinquency
 * report. "Now"-based (no period), so it's simpler than the company controls.
 */
export function DelinquencyControls({
  scope,
  scopeOptions,
  includeDueSoon,
}: {
  scope: string;
  scopeOptions: ScopeOption[];
  includeDueSoon: boolean;
}) {
  const router = useRouter();

  function go(next: Partial<{ scope: string; due: boolean }>) {
    const params = new URLSearchParams();
    params.set("scope", next.scope ?? scope);
    if (next.due ?? includeDueSoon) params.set("due", "1");
    router.push(`/portal/reports/delinquency?${params.toString()}`);
  }

  const query = (() => {
    const p = new URLSearchParams({ scope });
    if (includeDueSoon) p.set("due", "1");
    return p.toString();
  })();

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => go({ due: false })}
          className={cn(
            "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
            !includeDueSoon ? "border-gold/50 bg-gold/10 text-gold-muted" : "border-border text-muted-foreground hover:bg-muted",
          )}
        >
          Overdue only
        </button>
        <button
          onClick={() => go({ due: true })}
          className={cn(
            "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
            includeDueSoon ? "border-gold/50 bg-gold/10 text-gold-muted" : "border-border text-muted-foreground hover:bg-muted",
          )}
        >
          Include due soon
        </button>
        {scopeOptions.length > 1 && (
          <select
            value={scope}
            onChange={(e) => go({ scope: e.target.value })}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs"
          >
            {scopeOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button asChild size="sm" variant="outline">
          <a href={`/portal/reports/delinquency/pdf?${query}`} target="_blank" rel="noreferrer">
            <FileText className="size-4" /> Download PDF
          </a>
        </Button>
        <Button asChild size="sm" variant="outline">
          <a href={`/portal/reports/delinquency/export?${query}`}>
            <Download className="size-4" /> CSV
          </a>
        </Button>
      </div>
    </div>
  );
}
