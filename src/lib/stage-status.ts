// SLA / stage-duration status. Shared by the pipeline board, lead detail card,
// dashboard widgets, and the alert job so they all agree.

export type StageStatus = "none" | "on_track" | "due_soon" | "overdue";

export type StageTiming = {
  status: StageStatus;
  daysInStage: number;
  targetDays: number;
  /** Days past target when overdue (0 otherwise). */
  overdueBy: number;
};

const DAY = 86_400_000;

/** Whole days a deal has sat in its stage. Falls back to createdAt. */
export function daysInStage(stageChangedAt: Date | string | null, createdAt: Date | string, now: number = Date.now()): number {
  const entered = stageChangedAt ? new Date(stageChangedAt) : new Date(createdAt);
  const ms = now - entered.getTime();
  return Math.max(0, Math.floor(ms / DAY));
}

/** Compute the on-track / due-soon / overdue status for a stage with a target. */
export function stageTiming(
  stageChangedAt: Date | string | null,
  createdAt: Date | string,
  targetDays: number,
  now: number = Date.now(),
): StageTiming {
  const days = daysInStage(stageChangedAt, createdAt, now);
  if (!targetDays || targetDays <= 0) {
    return { status: "none", daysInStage: days, targetDays: 0, overdueBy: 0 };
  }
  if (days > targetDays) return { status: "overdue", daysInStage: days, targetDays, overdueBy: days - targetDays };
  if (days >= targetDays - 1) return { status: "due_soon", daysInStage: days, targetDays, overdueBy: 0 };
  return { status: "on_track", daysInStage: days, targetDays, overdueBy: 0 };
}

export const STAGE_STATUS_META: Record<Exclude<StageStatus, "none">, { dot: string; label: string; classes: string }> = {
  on_track: { dot: "🟢", label: "On Track", classes: "bg-emerald-100 text-emerald-700" },
  due_soon: { dot: "🟡", label: "Due Soon", classes: "bg-amber-100 text-amber-700" },
  overdue: { dot: "🔴", label: "Overdue", classes: "bg-red-100 text-red-700" },
};

/** Short status text incl. "Overdue by N days". */
export function stageStatusLabel(t: StageTiming): string {
  if (t.status === "none") return "";
  if (t.status === "overdue") return `Overdue by ${t.overdueBy} day${t.overdueBy === 1 ? "" : "s"}`;
  return STAGE_STATUS_META[t.status].label;
}

// ---------------------------------------------------------------------------
// Externally-blocked stages
//
// A deal sitting in "Permit Submitted" for 21 days is not late — plan review
// takes what it takes. What matters is whether WE have chased it recently. So
// these stages are measured from our last touch, and they never report as
// "overdue": that word is reserved for work we actually control.
//
// Without this split every solar deal is permanently red by week three, the
// team learns the colour means nothing, and the one deal that is genuinely
// stuck looks exactly like the ninety that are fine.
// ---------------------------------------------------------------------------

/** How a blocked deal's follow-up is tracking. Never "overdue" — see above. */
export type ChaseStatus = "none" | "recently_touched" | "chase_due" | "chase_overdue";

export type ChaseTiming = {
  status: ChaseStatus;
  /** Days since we last chased (falls back to when the deal entered the stage). */
  daysSinceTouch: number;
  followUpDays: number;
  /** Days past the cadence (0 unless chase_overdue). */
  chaseOverdueBy: number;
  /** True when nobody has ever logged a touch on this stage. */
  neverTouched: boolean;
};

/**
 * Follow-up timing for an externally-blocked stage.
 *
 * `lastTouchAt` is when a human last pushed on the blocker. When it is null we
 * fall back to stage entry, so a deal that lands in a blocked stage and is
 * never chased still surfaces after one cadence.
 */
export function chaseTiming(
  lastTouchAt: Date | string | null,
  stageChangedAt: Date | string | null,
  createdAt: Date | string,
  followUpDays: number,
  now: number = Date.now()
): ChaseTiming {
  const since = lastTouchAt ? new Date(lastTouchAt) : stageChangedAt ? new Date(stageChangedAt) : new Date(createdAt);
  const days = Math.max(0, Math.floor((now - since.getTime()) / DAY));
  const neverTouched = !lastTouchAt;

  if (!followUpDays || followUpDays <= 0) {
    return { status: "none", daysSinceTouch: days, followUpDays: 0, chaseOverdueBy: 0, neverTouched };
  }
  // Two cadences missed = the chase itself is being neglected.
  if (days >= followUpDays * 2) {
    return {
      status: "chase_overdue",
      daysSinceTouch: days,
      followUpDays,
      chaseOverdueBy: days - followUpDays,
      neverTouched,
    };
  }
  if (days >= followUpDays) {
    return { status: "chase_due", daysSinceTouch: days, followUpDays, chaseOverdueBy: 0, neverTouched };
  }
  return { status: "recently_touched", daysSinceTouch: days, followUpDays, chaseOverdueBy: 0, neverTouched };
}

export const CHASE_STATUS_META: Record<
  Exclude<ChaseStatus, "none">,
  { dot: string; label: string; classes: string }
> = {
  recently_touched: { dot: "🟢", label: "Followed up", classes: "bg-emerald-100 text-emerald-700" },
  chase_due: { dot: "🟡", label: "Follow up due", classes: "bg-amber-100 text-amber-700" },
  // Amber, not red: the deal is not late, OUR chasing is. Red stays reserved
  // for internally-owned work that has actually blown its deadline.
  chase_overdue: { dot: "🟠", label: "Follow up overdue", classes: "bg-orange-100 text-orange-700" },
};

/** e.g. "Follow up due · 8d since last touch". Never says the deal is overdue. */
export function chaseStatusLabel(t: ChaseTiming): string {
  if (t.status === "none") return "";
  const base = CHASE_STATUS_META[t.status].label;
  const suffix = t.neverTouched
    ? `${t.daysSinceTouch}d, never chased`
    : `${t.daysSinceTouch}d since last touch`;
  return `${base} · ${suffix}`;
}
