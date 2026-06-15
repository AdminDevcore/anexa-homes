"use client";

import { useRouter } from "next/navigation";
import { Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";

type ScopeOption = { value: string; label: string };

/** Scope selector + PDF/CSV export, for snapshot reports that have no period. */
export function ReportScopeControls({
  scope,
  scopeOptions,
  basePath,
  blurb,
}: {
  scope: string;
  scopeOptions: ScopeOption[];
  /** Where the scope nav and PDF/CSV links point, e.g. "/portal/reports/claims". */
  basePath: string;
  blurb?: string;
}) {
  const router = useRouter();
  const q = new URLSearchParams({ scope }).toString();
  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{blurb ?? "Current snapshot."}</p>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <a href={`${basePath}/pdf?${q}`} target="_blank" rel="noreferrer">
              <FileText className="size-4" /> Download PDF
            </a>
          </Button>
          <Button asChild size="sm" variant="outline">
            <a href={`${basePath}/export?${q}`}>
              <Download className="size-4" /> CSV
            </a>
          </Button>
        </div>
      </div>

      {scopeOptions.length > 1 && (
        <select
          value={scope}
          onChange={(e) => router.push(`${basePath}?scope=${encodeURIComponent(e.target.value)}`)}
          className="h-8 rounded-md border border-border bg-background px-2 text-xs"
        >
          {scopeOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      )}
    </div>
  );
}
