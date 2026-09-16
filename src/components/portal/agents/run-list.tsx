"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { formatRunDuration, PRODUCT_LABEL, productOf, TRIGGER_LABEL } from "@/lib/agent-labels";
import { readAgentRunAction } from "@/server/modules/agents/actions";
import type { RunListView, RunView } from "@/server/modules/agents/queries";
import { ChangeList } from "./change-list";
import { LocalTime } from "./local-time";
import { ResolveRun } from "./resolve-run";
import { RunStatusPill } from "./run-status-pill";

/**
 * Run history. Each row opens in place to everything the runner recorded — the
 * spec's success test ends with a person reading exactly this.
 *
 * The rows come from a LIST read, which carries neither `detail` nor `error`
 * (see RUN_LIST_SELECT): both are unbounded, and a page of 50 rows would parse
 * and serialise megabytes to draw summaries nobody has expanded. So opening a
 * row fetches that ONE run. Everything the collapsed row shows — status,
 * summary, who triggered it, how long it took — is already in the list read, so
 * nothing about the list waits on a fetch.
 *
 * Each row is its own component because each row owns a fetch, and a fetch
 * needs hooks: its own state, a request token, and the effect that re-reads a
 * run which finishes while someone is watching it. The same shape as
 * NeedsHumanCard, for the same reason.
 */

/** Start to finish. The handler's own figure lives in `detail`, which a list does not read. */
function listDuration(run: RunListView): number | null {
  if (run.startedAt && run.finishedAt) return Date.parse(run.finishedAt) - Date.parse(run.startedAt);
  return null;
}

/** Opened, the handler's own figure is available and is the truer one. */
function openDuration(run: RunView): number | null {
  return run.detail.durationMs ?? listDuration(run);
}

function headline(run: RunListView): string {
  if (run.summary) return run.summary;
  if (run.status === "queued") return "Waiting to start";
  if (run.status === "running") return "Running…";
  return "No summary";
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
      {children}
    </section>
  );
}

const PRE = "max-h-72 overflow-auto rounded-lg border border-border bg-background p-3 font-mono text-xs";

/** What one expanded row knows about its own run. */
type Opened = { state: "loading" } | { state: "ready"; run: RunView } | { state: "error"; message: string };

function RunRow({ run, canResolve, showAgent }: { run: RunListView; canResolve: boolean; showAgent: boolean }) {
  const [open, setOpen] = React.useState(false);
  const [opened, setOpened] = React.useState<Opened | null>(null);
  const detailId = `agent-run-detail-${run.id}`;

  /**
   * Which read owns this row. Two can be in the air at once — a run finishing
   * while its panel is open, or a resolve landing on top of a slow read — and
   * without a token the SLOWER one writes last: an error over a good answer, or
   * a stale panel over a fresh one. Only the newest read may set state.
   */
  const token = React.useRef(0);

  const load = React.useCallback(async () => {
    token.current += 1;
    const mine = token.current;
    setOpened({ state: "loading" });
    try {
      const res = await readAgentRunAction(run.id);
      if (token.current !== mine) return;
      setOpened(res.ok ? { state: "ready", run: res.run } : { state: "error", message: res.error });
    } catch {
      // Every path out of here reaches a terminal state. A throw that left a
      // row on "loading" for ever would look exactly like a slow server.
      if (token.current !== mine) return;
      setOpened({ state: "error", message: "Could not read this run. Try again." });
    }
  }, [run.id]);

  /**
   * Read while the row is open, and read AGAIN whenever the run's own terminal
   * facts change. Without the second half, the page's headline workflow ends in
   * a lie: press Run now, open the queued row to watch it, and when it finishes
   * AutoRefresh re-renders the server tree so the collapsed row's pill, summary
   * and finished time all update from the list read — while the panel below
   * them, fetched once when the run was still queued, stays empty for ever with
   * no spinner and no error. `status` and `finishedAt` are already on the list
   * row, so noticing the transition costs no read of its own, and a running row
   * re-reads once per transition rather than on every three-second poll.
   *
   * The ref is what keeps that true: a settled row is left alone, and closing
   * it clears the ref so reopening is a fresh read.
   */
  const terminal = `${run.status}|${run.finishedAt ?? ""}`;
  const readFor = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!open) {
      readFor.current = null;
      return;
    }
    if (readFor.current === terminal) return;
    readFor.current = terminal;
    void load();
  }, [open, terminal, load]);

  const full = opened?.state === "ready" ? opened.run : null;
  const held = full ? full.detail.changes.filter((c) => c.outcome === "held").length : 0;
  const facts = [
    showAgent ? run.agentName : null,
    PRODUCT_LABEL[productOf(run.vertical)],
    TRIGGER_LABEL[run.trigger],
    run.resolution ? (run.resolution.how === "applied" ? "Applied" : "Closed") : null,
  ].filter(Boolean);

  return (
    <li data-testid="agent-run" data-status={run.status}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={detailId}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
      >
        {open ? (
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        )}
        <RunStatusPill status={run.status} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{headline(run)}</span>
          <span className="block truncate text-xs text-muted-foreground">{facts.join(" · ")}</span>
        </span>
        <span className="shrink-0 text-right text-xs text-muted-foreground">
          <LocalTime iso={run.createdAt} />
          <span className="block tabular-nums">{formatRunDuration(listDuration(run))}</span>
        </span>
      </button>

      {open && (
        <div id={detailId} data-testid="agent-run-detail" className="space-y-4 border-t border-border bg-muted/20 px-4 py-4 text-sm">
          {/* Everything here is off the LIST row, so it is on screen the
              instant the row opens rather than after a round trip. */}
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
            <Fact label="Agent">
              <Link href={`/portal/agents/${run.agentId}`} className="hover:underline">
                {run.agentName}
              </Link>
            </Fact>
            <Fact label="Trigger">
              {run.triggeredBy ? `${TRIGGER_LABEL[run.trigger]} by ${run.triggeredBy}` : TRIGGER_LABEL[run.trigger]}
            </Fact>
            <Fact label="Started">{run.startedAt ? <LocalTime iso={run.startedAt} mode="absolute" /> : "Not started"}</Fact>
            <Fact label="Finished">{run.finishedAt ? <LocalTime iso={run.finishedAt} mode="absolute" /> : "—"}</Fact>
            <Fact label="Duration">{formatRunDuration(full ? openDuration(full) : listDuration(run))}</Fact>
            <Fact label="Workspace">{PRODUCT_LABEL[productOf(run.vertical)]}</Fact>
            {full && <Fact label="Human gate">{full.detail.gated ? "On" : "Off"}</Fact>}
            {run.leadId && run.leadLabel && (
              <Fact label="Deal">
                <Link href={`/portal/leads/${run.leadId}`} className="hover:underline">
                  {run.leadLabel}
                </Link>
              </Fact>
            )}
          </dl>

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
              {full.detail.changes.length > 0 && (
                <Section title="Requested changes">
                  <ChangeList changes={full.detail.changes} />
                </Section>
              )}
              {full.error && (
                <Section title="Error">
                  <pre className={`${PRE} whitespace-pre-wrap text-destructive`}>{full.error}</pre>
                </Section>
              )}
              {full.detail.log.length > 0 && (
                <Section title="Log">
                  <pre className={PRE}>{full.detail.log.join("\n")}</pre>
                </Section>
              )}
              {full.detail.handler && (
                <Section title="Handler detail">
                  <pre className={PRE}>{JSON.stringify(full.detail.handler, null, 2)}</pre>
                </Section>
              )}
              {full.detail.lateResult != null && (
                <Section title="Late result">
                  <p className="mb-1.5 text-xs text-muted-foreground">
                    The handler answered after this run had been closed. Nothing in it was applied.
                  </p>
                  <pre className={PRE}>{JSON.stringify(full.detail.lateResult, null, 2)}</pre>
                </Section>
              )}
            </>
          )}

          {/* Who resolved it and when are on the LIST row, so a failed read must
              not hide them. Only the changes the resolve applied need `full`. */}
          {run.resolution && (
            <Section title="Resolution">
              <p>
                {`${run.resolution.how === "applied" ? "Applied" : "Closed without applying"} by ${run.resolution.by ?? "a former user"}, `}
                <LocalTime iso={run.resolution.at} mode="absolute" />
              </p>
              {run.resolution.note && <p className="mt-1 text-muted-foreground">{run.resolution.note}</p>}
              {full?.detail.resolution && full.detail.resolution.changes.length > 0 && (
                <div className="mt-2">
                  <ChangeList changes={full.detail.resolution.changes} />
                </div>
              )}
            </Section>
          )}

          {/* Outside the `full` gate on purpose. This is the one control that
              moves a real deal, and a transient read failure used to leave the
              row offering no way to answer the run at all. Close is safe with
              nothing read — the server re-reads the run itself — so it works
              now; Apply waits for the changes, because nobody should apply
              changes they have not been shown, and says so by staying visible
              and disabled rather than by vanishing. */}
          {!run.resolution && run.status === "needs_human" && canResolve && (
            <ResolveRun runId={run.id} heldCount={full ? held : null} onResolved={() => void load()} />
          )}
        </div>
      )}
    </li>
  );
}

export function RunList({
  runs,
  canResolve,
  showAgent = false,
  emptyText,
}: {
  runs: RunListView[];
  canResolve: boolean;
  showAgent?: boolean;
  emptyText: string;
}) {
  if (runs.length === 0) {
    return <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
      {runs.map((run) => (
        <RunRow key={run.id} run={run} canResolve={canResolve} showAgent={showAgent} />
      ))}
    </ul>
  );
}
