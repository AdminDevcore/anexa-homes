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
