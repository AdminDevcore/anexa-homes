"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";

type Option = { value: string; label: string };

/**
 * The controls above a financial statement.
 *
 * Every control writes to the URL rather than to component state, for one
 * reason that matters: the CSV and PDF links are built from the same query
 * string the page was rendered with, so what downloads is what is on screen.
 * A basis toggle held in React state would let someone switch to cash, export,
 * and receive the accrual figures.
 *
 * Controls that do not apply to a statement are not rendered — a trial balance
 * has no cash basis and a balance sheet has no comparison, and showing a
 * disabled control invites the question of what it would have done.
 */
export function StatementControls({
  basePath,
  preset,
  from,
  to,
  basis,
  comparison,
  vertical,
  account,
  accountOptions,
  verticalOptions,
  showBasis,
  showComparison,
  showPeriod,
  showAccount,
  query,
  blurb,
}: {
  basePath: string;
  preset: string;
  from: string;
  to: string;
  basis: string;
  comparison: string;
  vertical: string;
  account: string;
  accountOptions: Option[];
  verticalOptions: Option[];
  showBasis: boolean;
  showComparison: boolean;
  showPeriod: boolean;
  showAccount: boolean;
  /** The exact query string this page was rendered with. */
  query: string;
  blurb?: string;
}) {
  const router = useRouter();
  const [customFrom, setCustomFrom] = React.useState(from);
  const [customTo, setCustomTo] = React.useState(to);

  function go(next: Record<string, string>) {
    const params = new URLSearchParams(query);
    for (const [k, v] of Object.entries(next)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    router.push(`${basePath}?${params.toString()}`);
  }

  const select = (
    label: string,
    value: string,
    options: Option[],
    onPick: (v: string) => void
  ) => (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      {label}
      <select
        value={value}
        onChange={(e) => onPick(e.target.value)}
        className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{blurb}</p>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <a href={`${basePath}/pdf?${query}`} target="_blank" rel="noreferrer">
              <FileText className="size-4" /> Download PDF
            </a>
          </Button>
          <Button asChild size="sm" variant="outline">
            <a href={`${basePath}/export?${query}`}>
              <Download className="size-4" /> CSV
            </a>
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {showPeriod &&
          select(
            "Period",
            preset,
            [
              { value: "this_month", label: "This month" },
              { value: "this_quarter", label: "This quarter" },
              { value: "ytd", label: "Year to date" },
              { value: "last_year", label: "Last year" },
              { value: "all", label: "All time" },
              { value: "custom", label: "Custom…" },
            ],
            (v) => go({ period: v })
          )}

        {showPeriod && preset === "custom" && (
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
            />
            to
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => go({ period: "custom", from: customFrom, to: customTo })}
              disabled={!customFrom || !customTo}
            >
              Apply
            </Button>
          </span>
        )}

        {showBasis &&
          select(
            "Basis",
            basis,
            [
              { value: "accrual", label: "Accrual" },
              { value: "cash", label: "Cash" },
            ],
            (v) => go({ basis: v })
          )}

        {showComparison &&
          select(
            "Compare",
            comparison,
            [
              { value: "none", label: "No comparison" },
              { value: "prior_period", label: "Previous period" },
              { value: "prior_year", label: "Same period last year" },
            ],
            (v) => go({ compare: v })
          )}

        {verticalOptions.length > 1 &&
          select("Department", vertical, verticalOptions, (v) => go({ vertical: v }))}

        {showAccount &&
          select(
            "Account",
            account,
            [{ value: "", label: "Pick an account…" }, ...accountOptions],
            (v) => go({ account: v })
          )}
      </div>
    </div>
  );
}
