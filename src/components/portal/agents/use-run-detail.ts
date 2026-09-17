"use client";

import * as React from "react";
import { readAgentRunAction } from "@/server/modules/agents/actions";
import type { RunView } from "@/server/modules/agents/queries";

/**
 * Reading ONE run, for a view that shows it in place.
 *
 * A run LIST reads neither `detail` nor `error` (see RUN_LIST_SELECT): both are
 * unbounded columns, and a feed page of 50 rows or a queue of 100 cards would
 * parse and serialise megabytes to draw blobs nobody has opened. So every view
 * that opens a run in place asks for that ONE run — and every such view needs
 * the same four things: somewhere to put the answer, a token saying which read
 * owns the view, a load that always reaches a terminal state, and an effect
 * that decides when to read.
 *
 * WHY THIS IS A HOOK AND NOT A COMPONENT. `RunList` and `NeedsHumanCard` had a
 * copy of all four each, and the copies cost correctness before anything else
 * did: the token fix and the ResolveRun-outside-the-gate fix had to be applied
 * twice, and the terminal re-read effect landed in one file only. What differs
 * between the two is the MARKUP — a row in a divide-y list with a status pill
 * and a facts line, against a card in a two-column grid with a summary
 * paragraph — and a component with a `variant` prop would be worse than the
 * duplication it replaced. So the machinery is shared and the markup is not.
 *
 * `watch` is the one thing the two views genuinely disagree about, and it is a
 * fact about the runs each shows rather than a style:
 *
 *   - A FEED row can show a run that is still going. Pass the run's own
 *     terminal facts — `${status}|${finishedAt ?? ""}` — and the run is re-read
 *     each time they change. Without that, the page's headline workflow ends in
 *     a lie: press Run now, open the queued row to watch it, and when it
 *     finishes the collapsed row's pill, summary and finished time all update
 *     from the list read while the panel below them, fetched once when the run
 *     was still queued, stays empty for ever with no spinner and no error.
 *     Both facts are already on the list row, so noticing the transition costs
 *     no read of its own.
 *
 *   - The NEEDS-A-HUMAN QUEUE shows only runs that are `needs_human` and
 *     unresolved, and a `needs_human` run's terminal facts cannot change:
 *     `finalize` compare-and-sets on `status: "running"`, so such a row is
 *     never re-finalized; the reaper touches only `running` and `queued`; and
 *     resolving sets `resolvedAt` and `resolution` WITHOUT changing `status`.
 *     There is no transition to watch, so that view passes nothing and this
 *     reads once per expand. The one in-place change — someone else resolving
 *     the run — is caught by that fresh read on expand, and by the server
 *     refusing a stale Apply with "This run has already been resolved."
 */

/** What a view that has opened a run knows about it. */
export type Opened = { state: "loading" } | { state: "ready"; run: RunView } | { state: "error"; message: string };

export type RunDetailHandle = {
  opened: Opened | null;
  /** The run itself, or null whenever it is not in hand — loading, failed, or never asked for. */
  full: RunView | null;
  /**
   * Changes this run is holding, or null while they have NOT been read, which
   * is not the same fact as a run holding none. `ResolveRun` reads exactly that
   * distinction: null keeps Apply visible and disabled rather than hiding the
   * one control that answers the run.
   */
  heldCount: number | null;
  reload: () => void;
};

export function useRunDetail(runId: string, opts: { open: boolean; watch?: string | null }): RunDetailHandle {
  const { open, watch = null } = opts;
  const [opened, setOpened] = React.useState<Opened | null>(null);

  /**
   * Which read owns this view. Two can be in the air at once — a run finishing
   * while its panel is open, or a resolve landing on top of a slow read — and
   * without a token the SLOWER one writes last: an error over a good answer, or
   * the pre-resolve run over the resolved one. Only the newest read may set
   * state.
   */
  const token = React.useRef(0);

  const load = React.useCallback(async () => {
    token.current += 1;
    const mine = token.current;
    setOpened({ state: "loading" });
    try {
      const res = await readAgentRunAction(runId);
      if (token.current !== mine) return;
      setOpened(res.ok ? { state: "ready", run: res.run } : { state: "error", message: res.error });
    } catch {
      // Every path out of here reaches a terminal state. A throw that left a
      // view on "loading" for ever would look exactly like a slow server.
      if (token.current !== mine) return;
      setOpened({ state: "error", message: "Could not read this run. Try again." });
    }
  }, [runId]);

  /**
   * Read while the view is open, and read again whenever `watch` changes.
   *
   * The ref is what keeps a settled view settled: without it this would re-read
   * on every render, and the feed re-renders itself every few seconds while
   * anything is in flight. Closing clears the ref, so expanding is always a
   * fresh read — the run may well have been resolved by someone else while the
   * view was shut.
   */
  const key = watch ?? "";
  const readFor = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!open) {
      readFor.current = null;
      return;
    }
    if (readFor.current === key) return;
    readFor.current = key;
    void load();
  }, [open, key, load]);

  const reload = React.useCallback(() => {
    void load();
  }, [load]);

  const full = opened?.state === "ready" ? opened.run : null;

  return {
    opened,
    full,
    heldCount: full ? full.detail.changes.filter((c) => c.outcome === "held").length : null,
    reload,
  };
}
