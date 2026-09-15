/**
 * Where a deal stands on its pipeline's MAIN LINE: the stages it moves through
 * on its way to done.
 *
 * Two kinds of stage sit in a pipeline without being steps forward:
 *  - the lost stage (Cancelled), a dead end;
 *  - action-required side-states (NTP Action Required, QC Failed), where a deal
 *    waits while somebody clears a problem and then rejoins the line.
 *
 * Advance and "step N of M" read the main line only. Without this, Advance
 * from Adjuster Meeting Complete would offer Claim Denied as the one-click next
 * step. Side-states stay reachable from Move, and agents move deals into them.
 */

export type ProgressStage = { id: string; isLost?: boolean; isActionRequired?: boolean };

export function isMainLine(stage: ProgressStage): boolean {
  return !stage.isLost && !stage.isActionRequired;
}

export type StageProgress<S extends ProgressStage> = {
  currentIndex: number;
  current: S | null;
  /** Main-line stages in the pipeline. */
  liveCount: number;
  /** Main-line stages up to and including the current one; a side-state keeps the step before it. */
  step: number;
  /** The next main-line stage after the current one. Never Cancelled, never a side-state. */
  nextStage: S | null;
  lostStage: S | null;
  isCancelled: boolean;
  isSideState: boolean;
};

export function stageProgress<S extends ProgressStage>(
  stages: S[],
  currentStageId: string | null
): StageProgress<S> {
  const currentIndex = stages.findIndex((s) => s.id === currentStageId);
  const current = currentIndex >= 0 ? stages[currentIndex] : null;
  const reached = currentIndex >= 0 ? stages.slice(0, currentIndex + 1) : [];
  return {
    currentIndex,
    current,
    liveCount: stages.filter(isMainLine).length,
    step: reached.filter(isMainLine).length,
    nextStage: stages.slice(currentIndex + 1).find(isMainLine) ?? null,
    lostStage: stages.find((s) => s.isLost) ?? null,
    isCancelled: !!current?.isLost,
    isSideState: !!current && !current.isLost && !!current.isActionRequired,
  };
}
