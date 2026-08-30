import * as React from "react";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDuration, type Timeline, type TimelineRow } from "@/lib/stage-history";

/**
 * Where a deal's time actually went.
 *
 * Nothing here is entered by hand. Every row is written by the stage move
 * itself, so the answer to "why did this job take four months" is on the deal
 * the moment anyone asks, instead of being reconstructed from memory.
 *
 * TWO READINGS, SIDE BY SIDE — the same shape the System & financing slide
 * took. This was one chronological column: a bordered header box, then a row
 * per stage VISIT, each carrying a title, a date range and a full-width bar.
 * Twelve visits ran a thousand pixels and the answer was not in any of them,
 * because a job that bounces (Contract Signed / Hold twice, NTP Submitted
 * twice) spends its time in a STAGE, not in a visit — and the visits were
 * listed apart, each with its own stub of a bar.
 *
 * So the strip states the run in four numbers, the left column adds the
 * repeats back together and ranks them, and the log keeps the sequence without
 * re-drawing a bar beside every line of it.
 */
export function DealStageTimeline({ timeline }: { timeline: Timeline }) {
  const { rows } = timeline;

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No stage history yet. It starts recording the moment this deal moves.
      </p>
    );
  }

  const done = timeline.completedAt !== null;
  // WHERE THE LINE WAS CROSSED, once. A deal sent back for a correction
  // re-enters the completion stage, and the old list ticked every one of those
  // — three green checks on a job that got installed one time. `buildTimeline`
  // already treats the first as the completion; the marks now follow it.
  const finish = rows.findIndex((r) => r.completion);
  const buckets = byStage(rows, finish >= 0 ? rows[finish].stageName : null);
  // Share of the biggest bucket. Length is the whole point of the row: a glance
  // should land on the step that ate the schedule.
  const biggest = buckets[0]?.days ?? 0;
  // Where it is right now, for the tile that has no completion date to show.
  const live = rows.find((r) => r.current) ?? rows[rows.length - 1];

  return (
    <div className="space-y-5">
      {/* Hairline grid rather than four floating tiles, matching the money
          slide: gap-px over a border-coloured backdrop draws one strip on any
          number of rows, so the wrapped 2×2 on a phone reads as the same object
          as the 1×4. */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
        <Metric
          label={done ? "Start → install complete" : "Elapsed so far"}
          value={formatDuration(timeline.totalDays)}
          accent
        />
        <Metric label="Created" value={fmtDate(timeline.startedAt)} />
        {done ? (
          <Metric label="Completed" value={fmtDate(timeline.completedAt!)} />
        ) : (
          <Metric label={`In ${live.stageName}`} value={formatDuration(live.days)} />
        )}
        <Metric
          label={buckets.length ? `Longest · ${buckets[0].stageName}` : "Longest step"}
          value={formatDuration(biggest)}
        />
      </div>

      <div className="grid gap-x-8 gap-y-6 lg:grid-cols-2">
        <Block label="Where the time went">
          <ol className="space-y-2.5">
            {buckets.map((b) => (
              <li key={b.stageName}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-sm">
                    {b.stageName}
                    {b.visits > 1 && (
                      <span className="ml-1.5 text-[11px] text-muted-foreground">×{b.visits}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">
                    {formatDuration(b.days)}
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      b.completion ? "bg-emerald-500" : b.current ? "bg-primary" : "bg-primary/55"
                    )}
                    style={{
                      width: `${biggest > 0 ? Math.max(2, (b.days / biggest) * 100) : 2}%`,
                    }}
                  />
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
            Shares of the slowest stage. A stage the deal came back to is counted once, with its
            visits added together.
          </p>
        </Block>

        <Block
          label="Stage history"
          aside={`${rows.length} ${rows.length === 1 ? "move" : "moves"}`}
        >
          {/* Capped rather than endless: a bounced job logs twenty visits, and
              the sequence is a reference you consult, not the read. */}
          <ol className={cn("space-y-0", rows.length > 9 && "max-h-[26rem] overflow-y-auto pr-2")}>
            {rows.map((r, i) => {
              const last = i === rows.length - 1;
              const finished = i === finish;
              return (
                <li key={r.id} className="relative flex gap-3 pb-3 last:pb-0">
                  {/* Rail */}
                  <div className="flex flex-col items-center">
                    <span
                      className={cn(
                        "mt-1 flex size-2.5 shrink-0 rounded-full ring-4 ring-card",
                        finished ? "bg-emerald-500" : r.current ? "bg-primary" : "bg-border"
                      )}
                    />
                    {!last && <span className="mt-1 w-px flex-1 bg-border" aria-hidden />}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-1.5">
                        {finished && <CheckCircle2 className="size-3 shrink-0 text-emerald-600" />}
                        <span
                          className={cn(
                            "truncate text-sm font-medium",
                            r.current ? "text-foreground" : "text-foreground/80"
                          )}
                        >
                          {r.stageName}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs font-semibold tabular-nums">
                        {formatDuration(r.days)}
                        {r.current && (
                          <span className="ml-1 font-normal text-muted-foreground">so far</span>
                        )}
                      </span>
                    </div>
                    <div className="text-[11px] tabular-nums text-muted-foreground">
                      {fmtDate(r.enteredAt)} → {r.exitedAt ? fmtDate(r.exitedAt) : "now"}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </Block>
      </div>
    </div>
  );
}

/** A titled run of rows. Small caps, no rule — the rows carry the structure. */
function Block({
  label,
  aside,
  children,
}: {
  label: string;
  /** A count, set against the title. The list below it may be scroll-capped,
      and macOS hides its scrollbar until you touch it. */
  aside?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </h3>
        {aside && <span className="text-[11px] tabular-nums text-muted-foreground">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="min-w-0 bg-card px-3 py-2.5">
      <div
        className={cn("font-display text-base font-semibold tabular-nums", accent && "text-solar")}
      >
        {value}
      </div>
      <div
        title={label}
        className="truncate text-[10px] uppercase tracking-wider text-muted-foreground"
      >
        {label}
      </div>
    </div>
  );
}

type Bucket = {
  stageName: string;
  /** Every visit to this stage, added together. */
  days: number;
  visits: number;
  current: boolean;
  completion: boolean;
};

/**
 * The same stage, however many times the deal passed through it, as one row —
 * ranked by the time it took.
 *
 * A deal that goes back for a correction re-enters stages it has already been
 * in. Listed as separate visits, three days in Contract Signed / Hold reads as
 * a two-hour step and a one-hour step and a three-day step, none of which is
 * the number anyone is looking for.
 */
function byStage(rows: TimelineRow[], finishName: string | null): Bucket[] {
  const byName = new Map<string, Bucket>();
  for (const r of rows) {
    const b = byName.get(r.stageName);
    if (b) {
      b.days += r.days;
      b.visits += 1;
      b.current ||= r.current;
    } else {
      byName.set(r.stageName, {
        stageName: r.stageName,
        days: r.days,
        visits: 1,
        current: r.current,
        completion: r.stageName === finishName,
      });
    }
  }
  // Ties keep the order they happened in — Map preserves insertion order and
  // sort is stable, so a run of same-length stages still reads chronologically.
  return [...byName.values()].sort((a, b) => b.days - a.days);
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
