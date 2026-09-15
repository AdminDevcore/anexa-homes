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

/** How a deal got into a stage when no person moved it. */
export type StageMoveVia = "automation" | "signature" | "document";

export type StageEventRow = {
  id: string;
  stageId: string | null;
  stageName: string;
  position: number;
  enteredAt: string;
  exitedAt: string | null;
  /** Who moved the deal into this stage, by name. Null when nobody is on record. */
  movedBy?: string | null;
  /** Set instead of a name when the move was not a person's. */
  via?: StageMoveVia | null;
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
  /**
   * When the homeowner first signed, if this pipeline records such a stage.
   *
   * The FIRST signature. A deal put back on hold and re-signed did not take
   * until the second time to get a contract.
   */
  signedAt: string | null;
  /**
   * Signature → completion, or signature → now while still running. Null on a
   * deal that has not signed, which is not the same as zero.
   *
   * The second clock the office runs on. Creation → install answers "how long
   * does a lead take"; this one answers "how long do we make a customer wait
   * after they have signed", and it is the only half of the run the operations
   * team can actually shorten — the weeks before a signature belong to sales.
   */
  signedDays: number | null;
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

/**
 * Is this the stage that means "the customer signed"?
 *
 * Read off the name, for the same reason the completion test is: it has to
 * fill in with no configuration, across pipelines that name the moment
 * differently. Every pipeline this company runs marks it with the words
 * themselves — "Contract Signed", "Contract Signed / Hold" — and the bare
 * "Signed" and "Sold" are the two other ways a board usually writes it.
 *
 * A hold or an action-required stage that FOLLOWS the signature is not it: the
 * test is the phrase, not any stage that mentions a contract.
 */
export function isSaleStage(stage: { name: string }): boolean {
  const n = stage.name.trim().toLowerCase();
  return n.includes("contract signed") || n === "signed" || n === "sold";
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

  // Off the STORED events, not off `rows`: row zero's enteredAt is pulled back
  // to the day the deal was created so no time evaporates from the total, and
  // on a backfilled deal whose first logged move is the signature that would
  // date the contract to the day the lead came in.
  const signedAt = sorted.find((e) => isSaleStage({ name: e.stageName }))?.enteredAt ?? null;
  const endsAt = completedAt ?? now.toISOString();

  return {
    rows,
    startedAt,
    completedAt,
    totalDays: daysBetween(startedAt, endsAt),
    signedAt,
    signedDays: signedAt ? daysBetween(signedAt, endsAt) : null,
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
