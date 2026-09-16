"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { PRODUCT_LABEL, productOf } from "@/lib/agent-labels";
import type { RunListView } from "@/server/modules/agents/queries";
import { ChangeList } from "./change-list";
import { LocalTime } from "./local-time";
import { ResolveRun } from "./resolve-run";
import { useRunDetail } from "./use-run-detail";

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
 * asks for that ONE run's changes when someone opens it. `useRunDetail` owns
 * that read; this file owns only how the answer looks.
 *
 * `summary` is what makes the collapsed card worth reading: it is bounded
 * (`truncateSummary`, 280) and the runner writes what the run wants into it, so
 * the queue says what each item is about without opening anything.
 *
 * Anyone who can read agents may open a card; only `canResolve` gets the
 * buttons. Reading why a run is stuck is not the same as answering it.
 */

export function NeedsHumanCard({ run, canResolve }: { run: RunListView; canResolve: boolean }) {
  const [open, setOpen] = React.useState(false);
  const detailId = `needs-human-detail-${run.id}`;

  /**
   * NOTHING TO WATCH, said explicitly rather than left out. Every run in this
   * queue is `needs_human` and unresolved, and such a run's terminal facts
   * cannot change: `finalize` compare-and-sets on `status: "running"`, the
   * reaper touches only `running` and `queued`, and resolving sets `resolvedAt`
   * without touching `status`. A feed row watches `status|finishedAt` because a
   * feed row can show a run that is still going; there is no equivalent
   * transition here, so this reads once per expand and no more.
   */
  const { opened, full, heldCount, reload } = useRunDetail(run.id, { open, watch: null });

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

      {/* Labelled, the way RunList labels the same link. A bare address under a
          summary reads as an unexplained link; "Deal" is the whole difference
          between a link someone follows and one they wonder about. */}
      {run.leadId && run.leadLabel && (
        <div>
          <p className="text-xs text-muted-foreground">Deal</p>
          <Link href={`/portal/leads/${run.leadId}`} className="text-sm font-medium underline-offset-2 hover:underline">
            {run.leadLabel}
          </Link>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
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
              {/* Labelled, bounded and in the destructive colour, as RunList
                  shows the same column. `error` is capped at MAX_ERROR_CHARS
                  (4000) and no stack can reach it on a needs_human verdict, but
                  4000 characters of unlabelled muted prose would still push
                  every card below it off the screen and would not read as an
                  error. The clamp is tighter than the feed's on purpose: this
                  sits in a two-column grid of cards, not a full-width panel,
                  and anyone who needs the whole thing opens the run in the
                  feed. */}
              {full.error && (
                <div>
                  <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Error</h4>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-background p-3 font-mono text-xs text-destructive">{full.error}</pre>
                </div>
              )}
            </>
          )}

          {/* Outside the `full` gate on purpose, and it matters more here than
              anywhere: this queue exists to answer runs, so a read that fails
              must not leave the card with nothing to press. Close is safe with
              nothing read — the server re-reads the run itself — while Apply
              stays visible and disabled until the changes it would apply are on
              screen. The disclosure above it stays: drawing every card's
              changes up front is the hundred-round-trip page this split
              removed.

              The resolution line comes FIRST, and it reads off the re-read
              rather than off the list row. A resolve re-reads the run, and
              `resolveAgentRunAction` writes the real outcomes into
              `detail.resolution` while leaving `detail.changes` untouched — so
              without this the card came back showing held chips and a live
              "Apply N changes" button for changes applied a moment earlier, and
              for one beat it looked as though nothing had happened. Guarding on
              `run.resolution` instead would be a no-op: the queue query filters
              `resolvedAt: null`, so the list row's resolution is always null
              here. Nothing could ever have been applied twice — the claim is an
              `updateMany … where resolvedAt: null` behind a status re-check —
              so what this buys is confidence, not data. */}
          {full?.resolution ? (
            <p className="text-xs text-muted-foreground">
              {`${full.resolution.how === "applied" ? "Applied" : "Closed without applying"} by ${full.resolution.by ?? "a former user"}`}
            </p>
          ) : canResolve ? (
            <ResolveRun runId={run.id} heldCount={heldCount} onResolved={reload} />
          ) : (
            <p className="text-xs text-muted-foreground">An owner, an admin or someone with Agents access resolves this run.</p>
          )}
        </div>
      )}
    </article>
  );
}
