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
  const [open, setOpen] = React.useState<Set<string>>(() => new Set());
  const [opened, setOpened] = React.useState<Record<string, Opened>>({});

  const load = React.useCallback(async (id: string) => {
    setOpened((m) => ({ ...m, [id]: { state: "loading" } }));
    try {
      const res = await readAgentRunAction(id);
      setOpened((m) => ({ ...m, [id]: res.ok ? { state: "ready", run: res.run } : { state: "error", message: res.error } }));
    } catch {
      // Every path out of here reaches a terminal state. A throw that left a
      // row on "loading" for ever would look exactly like a slow server.
      setOpened((m) => ({ ...m, [id]: { state: "error", message: "Could not read this run. Try again." } }));
    }
  }, []);

  function toggle(id: string) {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    // Re-read a row that is being opened and is not already in hand. A row that
    // failed last time is retried, which makes the error state recoverable
    // without a reload.
    if (!open.has(id) && opened[id]?.state !== "ready") void load(id);
  }

  if (runs.length === 0) {
    return <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
      {runs.map((run) => {
        const expanded = open.has(run.id);
        const detailId = `agent-run-detail-${run.id}`;
        const here = opened[run.id];
        const full = here?.state === "ready" ? here.run : null;
        const held = full ? full.detail.changes.filter((c) => c.outcome === "held").length : 0;
        const facts = [
          showAgent ? run.agentName : null,
          PRODUCT_LABEL[productOf(run.vertical)],
          TRIGGER_LABEL[run.trigger],
          run.resolution ? (run.resolution.how === "applied" ? "Applied" : "Closed") : null,
        ].filter(Boolean);

        return (
          <li key={run.id} data-testid="agent-run" data-status={run.status}>
            <button
              type="button"
              onClick={() => toggle(run.id)}
              aria-expanded={expanded}
              aria-controls={detailId}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
            >
              {expanded ? (
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

            {expanded && (
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

                {here?.state === "loading" && (
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" /> Reading this run…
                  </p>
                )}
                {here?.state === "error" && (
                  <p className="text-xs text-destructive">{`${here.message} Close and open this run to try again.`}</p>
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

                    {run.resolution ? (
                      <Section title="Resolution">
                        <p>
                          {`${run.resolution.how === "applied" ? "Applied" : "Closed without applying"} by ${run.resolution.by ?? "a former user"}, `}
                          <LocalTime iso={run.resolution.at} mode="absolute" />
                        </p>
                        {run.resolution.note && <p className="mt-1 text-muted-foreground">{run.resolution.note}</p>}
                        {full.detail.resolution && full.detail.resolution.changes.length > 0 && (
                          <div className="mt-2">
                            <ChangeList changes={full.detail.resolution.changes} />
                          </div>
                        )}
                      </Section>
                    ) : run.status === "needs_human" && canResolve ? (
                      <ResolveRun runId={run.id} heldCount={held} onResolved={() => void load(run.id)} />
                    ) : null}
                  </>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
