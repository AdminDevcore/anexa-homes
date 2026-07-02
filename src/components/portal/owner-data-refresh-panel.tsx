"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requeueOwnerEnrichmentAction } from "@/server/modules/canvassing/actions";

function fmt(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Homeowner-data status + a "re-check everything" command (e.g. after a storm). */
export function OwnerDataRefreshPanel({
  stats,
  enabled,
}: {
  stats: { totalWithAddress: number; enriched: number; lastRunAt: string | null };
  enabled: boolean; // a skip-trace provider (BatchData) is configured
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  async function recheck() {
    if (
      !confirm(
        `Re-check homeowner data for all ${stats.totalWithAddress.toLocaleString()} addressed houses?\n\n` +
          "The nightly job will re-pull owner name, phone, and email for every house. " +
          "This bills per lookup with your data provider. Continue?",
      )
    )
      return;
    setBusy(true);
    const res = await requeueOwnerEnrichmentAction();
    setBusy(false);
    if (!res.ok) return toast.error(res.error ?? "Failed");
    toast.success(`Queued ${res.queued?.toLocaleString()} houses — the nightly job will refresh them.`);
    router.refresh();
  }

  return (
    <div className="max-w-xl space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">Homeowner data</h2>
        {enabled ? (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">Provider connected</span>
        ) : (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">No provider key</span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-3 text-sm">
        <Stat label="Houses" value={stats.totalWithAddress.toLocaleString()} />
        <Stat label="With owner data" value={stats.enriched.toLocaleString()} />
        <Stat label="Last refreshed" value={fmt(stats.lastRunAt)} />
      </div>
      {!enabled && (
        <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800">
          Set <code>SKIP_TRACE_PROVIDER</code> + <code>SKIP_TRACE_API_KEY</code> (BatchData) and redeploy to turn this on.
          Until then no owner name/phone/email can be pulled.
        </p>
      )}
      <Button onClick={recheck} disabled={busy} variant="outline" className="gap-1.5">
        {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Re-check all homeowner data
      </Button>
      <p className="text-xs text-muted-foreground">
        Use after a storm to re-verify who lives at each house. It clears the &ldquo;last checked&rdquo; stamp so the nightly
        job re-pulls everyone (bills per lookup). New houses are picked up automatically each night.
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-background p-2.5">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-medium tabular-nums">{value}</div>
    </div>
  );
}
