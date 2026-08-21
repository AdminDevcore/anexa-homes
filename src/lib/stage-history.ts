/**
 * Cycle time: how long a deal actually sat in each pipeline stage, and how long
 * the whole job took from the day it was created to the day it was installed.
 *
 * Everything here is pure. The stored events (see LeadStageEvent) are the only
 * input; nothing is inferred from the lead's current state, because "days in
 * stage" reconstructed from a single stageChangedAt can only ever describe the
 * stage a deal is in right now — which is precisely the number that stops being
 * interesting the moment the deal moves on.
 */

export type StageEventRow = {
  id: string;
  stageId: string | null;
  stageName: string;
  position: number;
  enteredAt: string;
  exitedAt: string | null;
};

export type TimelineRow = StageEventRow & {
  /** Days spent in this stage. Fractional; round only at the edge. */
  days: number;
  /** Still here — exitedAt is null and days counts up to `now`. */
  current: boolean;
  /** This row is where the job crossed the finish line. */
  completion: boolean;
  /** Days from the deal's creation to the moment it ENTERED this stage. */
  daysFromStart: number;
};

export type Timeline = {
  rows: TimelineRow[];
  /** Deal creation, the clock's zero. */
  startedAt: string;
  /** When it hit the completion milestone, if it has. */
  completedAt: string | null;
  /** Creation → completion, or creation → now while still running. */
  totalDays: number;
  /** The longest single stage, for the "where does time go" callout. */
  slowest: TimelineRow | null;
};

const MS_PER_DAY = 86_400_000;

export function daysBetween(from: string | Date, to: string | Date): number {
  const a = typeof from === "string" ? Date.parse(from) : from.getTime();
  const b = typeof to === "string" ? Date.parse(to) : to.getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, (b - a) / MS_PER_DAY);
}

/**
 * Is this the stage that means "the job is done"?
 *
 * Read off the stage itself rather than a per-company setting, because the
 * whole point is that this fills in with no configuration. A won stage always
 * counts; so does an install-completion stage, which in a solar pipeline lands
 * well BEFORE the won stage (funding) and is the milestone crews are judged on.
 *
 * "Install Scheduled" and "Install Ready" deliberately do not match: the test is
 * the completed form of the word, not the prefix.
 */
export function isCompletionStage(stage: { name: string; isWon?: boolean }): boolean {
  if (stage.isWon) return true;
  const n = stage.name.trim().toLowerCase();
  return /^install(ed|ation)?(\s*(complete|completed|done))?$/.test(n) && n !== "install";
}

/** Same test, from a stored event row (which carries no isWon flag). */
function eventIsCompletion(row: StageEventRow, wonStageIds: ReadonlySet<string>): boolean {
  if (row.stageId && wonStageIds.has(row.stageId)) return true;
  return isCompletionStage({ name: row.stageName });
}

export function buildTimeline(
  events: StageEventRow[],
  opts: { createdAt: string; now?: Date; wonStageIds?: ReadonlySet<string> }
): Timeline {
  const now = opts.now ?? new Date();
  const won = opts.wonStageIds ?? new Set<string>();
  const sorted = [...events].sort((a, b) => Date.parse(a.enteredAt) - Date.parse(b.enteredAt));

  // The first stage started when the DEAL did, not when someone got around to
  // logging it — otherwise the gap between "lead created" and "first recorded
  // stage" vanishes from the total and every job looks faster than it was.
  const startedAt = sorted.length
    ? (Date.parse(sorted[0].enteredAt) < Date.parse(opts.createdAt) ? sorted[0].enteredAt : opts.createdAt)
    : opts.createdAt;

  const rows: TimelineRow[] = sorted.map((e, i) => {
    const enteredAt = i === 0 ? startedAt : e.enteredAt;
    const end = e.exitedAt ?? now.toISOString();
    const completion = eventIsCompletion(e, won);
    return {
      ...e,
      enteredAt,
      days: daysBetween(enteredAt, end),
      current: e.exitedAt === null,
      completion,
      daysFromStart: daysBetween(startedAt, enteredAt),
    };
  });

  // The FIRST time it crossed the line. A deal bounced back for a correction
  // and re-completed did not take until the second time to get installed.
  const completedAt = rows.find((r) => r.completion)?.enteredAt ?? null;

  const slowest = rows.length
    ? rows.reduce((max, r) => (r.days > max.days ? r : max), rows[0])
    : null;

  return {
    rows,
    startedAt,
    completedAt,
    totalDays: daysBetween(startedAt, completedAt ?? now.toISOString()),
    slowest,
  };
}

/** "3 days", "1 day", "4 hours" — a duration a human reads without arithmetic. */
export function formatDuration(days: number): string {
  if (days < 1 / 24) return "< 1 hour";
  if (days < 1) {
    const h = Math.round(days * 24);
    return `${h} hour${h === 1 ? "" : "s"}`;
  }
  const d = Math.round(days);
  return `${d} day${d === 1 ? "" : "s"}`;
}
