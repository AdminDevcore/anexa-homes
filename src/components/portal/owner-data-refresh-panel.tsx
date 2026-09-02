"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Caution, Figure, Hint, Panel, Pill } from "@/components/portal/settings-kit";
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
    <Panel
      title="Homeowner data"
      description="Who lives at each house on the Field Map — pulled from a skip-trace provider, billed per lookup."
      action={
        enabled ? <Pill tone="gold">Provider connected</Pill> : <Pill tone="warn">No provider key</Pill>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Figure label="Houses" value={stats.totalWithAddress.toLocaleString()} />
        <Figure
          label="With owner data"
          value={stats.enriched.toLocaleString()}
          tone={stats.enriched === 0 ? "warn" : "plain"}
        />
        <Figure label="Last refreshed" value={fmt(stats.lastRunAt)} />
      </div>

      {!enabled && (
        <Caution>
          Set <code>SKIP_TRACE_PROVIDER</code> and <code>SKIP_TRACE_API_KEY</code> (BatchData) and
          redeploy to turn this on. Until then no owner name, phone or email can be pulled — and
          nothing on this screen says so anywhere a canvasser would see it.
        </Caution>
      )}

      <Button onClick={recheck} disabled={busy} variant="outline">
        {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
        Re-check all homeowner data
      </Button>

      <Hint>
        Use it after a storm to re-verify who lives at each house. It clears the &ldquo;last
        checked&rdquo; stamp so the nightly job re-pulls everyone, which bills per lookup. New houses
        are picked up automatically each night either way.
      </Hint>
    </Panel>
  );
}
