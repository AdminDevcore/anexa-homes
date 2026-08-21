import * as React from "react";
import { CheckCircle2, Flag, Timer } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDuration, type Timeline } from "@/lib/stage-history";

/**
 * Where a deal's time actually went.
 *
 * One row per stage the job passed through: when it arrived, when it left, and
 * how long that step took — with the whole run measured from the day the deal
 * was created to the day it was installed.
 *
 * Nothing here is entered by hand. Every row is written by the stage move
 * itself, so the answer to "why did this job take four months" is on the deal
 * the moment anyone asks, instead of being reconstructed from memory.
 */
export function DealStageTimeline({ timeline }: { timeline: Timeline }) {
  const { rows, slowest } = timeline;
  const longest = slowest?.days ?? 0;

  return (
    <div className="space-y-5">
      <Header timeline={timeline} />

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No stage history yet. It starts recording the moment this deal moves.
        </p>
      ) : (
        <ol className="space-y-0">
          {rows.map((r, i) => {
            const last = i === rows.length - 1;
            // Share of the slowest stage. Length is the whole point of the row:
            // a glance should land on the step that ate the schedule.
            const width = longest > 0 ? Math.max(2, (r.days / longest) * 100) : 2;
            return (
              <li key={r.id} className="relative flex gap-3 pb-5 last:pb-0">
                {/* Rail */}
                <div className="flex flex-col items-center">
                  <span
                    className={cn(
                      "mt-1 flex size-3.5 shrink-0 items-center justify-center rounded-full ring-4 ring-card",
                      r.completion
                        ? "bg-emerald-500"
                        : r.current
                          ? "bg-primary"
                          : "bg-border"
                    )}
                  />
                  {!last && <span className="mt-1 w-px flex-1 bg-border" aria-hidden />}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span
                      className={cn(
                        "text-sm font-medium",
                        r.current ? "text-foreground" : "text-foreground/80"
                      )}
                    >
                      {r.stageName}
                    </span>
                    <span className="text-sm font-semibold tabular-nums">
                      {formatDuration(r.days)}
                      {r.current && (
                        <span className="ml-1.5 font-normal text-muted-foreground">so far</span>
                      )}
                    </span>
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span className="tabular-nums">
                      {fmtDate(r.enteredAt)} → {r.exitedAt ? fmtDate(r.exitedAt) : "now"}
                    </span>
                    {r.completion && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">
                        <CheckCircle2 className="size-3" />
                        {formatDuration(timeline.totalDays)} from start
                      </span>
                    )}
                    {slowest && r.id === slowest.id && rows.length > 1 && !r.completion && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700">
                        <Timer className="size-3" /> Longest step
                      </span>
                    )}
                  </div>

                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        r.completion ? "bg-emerald-500" : r.current ? "bg-primary" : "bg-primary/55"
                      )}
                      style={{ width: `${width}%` }}
                    />
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function Header({ timeline }: { timeline: Timeline }) {
  const done = timeline.completedAt !== null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Flag className="size-3.5" />
        Created{" "}
        <span className="font-medium text-foreground">{fmtDate(timeline.startedAt)}</span>
        {done && (
          <>
            <span aria-hidden>·</span>
            Completed{" "}
            <span className="font-medium text-foreground">{fmtDate(timeline.completedAt!)}</span>
          </>
        )}
      </div>
      <div className="text-right">
        <div className="text-lg font-semibold tabular-nums leading-none">
          {formatDuration(timeline.totalDays)}
        </div>
        <div className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">
          {done ? "Start → install complete" : "Elapsed so far"}
        </div>
      </div>
    </div>
  );
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
