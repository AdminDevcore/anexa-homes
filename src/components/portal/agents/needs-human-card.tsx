"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { PRODUCT_LABEL, productOf } from "@/lib/agent-labels";
import { readAgentRunAction } from "@/server/modules/agents/actions";
import type { RunListView, RunView } from "@/server/modules/agents/queries";
import { ChangeList } from "./change-list";
import { LocalTime } from "./local-time";
import { ResolveRun } from "./resolve-run";

/**
 * One run waiting on a person: which agent, which deal, what it wants to do in
 * words, and — a click away — the changes it is holding and the two ways to
 * answer it.
 *
 * WHY THE CHANGES ARE A CLICK AWAY. This card is drawn from a LIST read, which
 * carries neither `detail` nor `error` (see RUN_LIST_SELECT): both are
 * unbounded columns, and the queue reads up to 100 rows, so drawing every
 * card's held changes up front would parse and serialise megabytes to fill a
 * queue of which a person works one item. So the card shows what the list read
 * already knows — the agent, the workspace, when, the summary, the deal — and
 * asks for that ONE run's changes when someone opens it. It is the same bargain
 * `RunList` makes for an expanded row, and the same one `readAgentRunAction`
 * exists to serve.
 *
 * `summary` is what makes the collapsed card worth reading: it is bounded
 * (`truncateSummary`, 280) and the runner writes what the run wants into it, so
 * the queue says what each item is about without opening anything.
 *
 * Anyone who can read agents may open a card; only `canResolve` gets the
 * buttons. Reading why a run is stuck is not the same as answering it.
 */

/** What one opened card knows about its own run. Mirrors RunList's. */
type Opened = { state: "loading" } | { state: "ready"; run: RunView } | { state: "error"; message: string };

export function NeedsHumanCard({ run, canResolve }: { run: RunListView; canResolve: boolean }) {
  const [open, setOpen] = React.useState(false);
  const [opened, setOpened] = React.useState<Opened | null>(null);
  const detailId = `needs-human-detail-${run.id}`;

  const load = React.useCallback(async () => {
    setOpened({ state: "loading" });
    try {
      const res = await readAgentRunAction(run.id);
      setOpened(res.ok ? { state: "ready", run: res.run } : { state: "error", message: res.error });
    } catch {
      // Every path out of here reaches a terminal state. A throw that left the
      // card on "loading" for ever would look exactly like a slow server.
      setOpened({ state: "error", message: "Could not read this run. Try again." });
    }
  }, [run.id]);

  function toggle() {
    const next = !open;
    setOpen(next);
    // Read a card that is being opened and is not already in hand. One that
    // failed last time is retried, so the error state recovers without a reload.
    if (next && opened?.state !== "ready") void load();
  }

  const full = opened?.state === "ready" ? opened.run : null;
  const held = full ? full.detail.changes.filter((c) => c.outcome === "held") : [];

  return (
    <article data-testid="needs-human-card" className="space-y-3 rounded-xl border border-border bg-card p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link href={`/portal/agents/${run.agentId}`} className="font-semibold hover:underline">
            {run.agentName}
          </Link>
          <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {PRODUCT_LABEL[productOf(run.vertical)]}
          </span>
        </div>
        <span className="text-xs text-muted-foreground">
          <LocalTime iso={run.createdAt} />
        </span>
      </header>

      <p className="text-sm">{run.summary || "This run stopped for a person without saying why."}</p>

      {run.leadId && run.leadLabel && (
        <Link href={`/portal/leads/${run.leadId}`} className="block text-sm underline-offset-2 hover:underline">
          {run.leadLabel}
        </Link>
      )}

      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={detailId}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        {open ? "Hide what it is holding" : canResolve ? "Review and resolve" : "See what it is holding"}
      </button>

      {open && (
        <div id={detailId} className="space-y-3 border-t border-border pt-3">
          {opened?.state === "loading" && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Reading this run…
            </p>
          )}
          {opened?.state === "error" && (
            <p className="text-xs text-destructive">{`${opened.message} Close and open this run to try again.`}</p>
          )}

          {full && (
            <>
              {full.detail.changes.length > 0 ? (
                <ChangeList changes={full.detail.changes} />
              ) : (
                <p className="text-xs text-muted-foreground">This run is holding no changes — it stopped to be looked at.</p>
              )}
              {full.error && <p className="text-xs text-muted-foreground">{full.error}</p>}
              {canResolve ? (
                <ResolveRun runId={run.id} heldCount={held.length} onResolved={() => void load()} />
              ) : (
                <p className="text-xs text-muted-foreground">An owner, an admin or someone with Agents access resolves this run.</p>
              )}
            </>
          )}
        </div>
      )}
    </article>
  );
}
