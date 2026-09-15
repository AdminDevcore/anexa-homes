/**
 * How a tick stays inside the cron function's limit.
 *
 *   0 s ─ reap, claim ─ handlers run concurrently ─ 240 s ─ apply + finalise ─ 285 s ─ 15 s spare ─ 300 s
 *
 * Every figure is measured from the tick's own start, so time spent reaping and
 * claiming comes OUT of the handler budget rather than adding to it. Execution
 * is concurrent, never sequential; five runs at most, which also leaves half
 * the runtime's `connection_limit=10` pool free.
 *
 * `CRON_MAX_DURATION_SECONDS` must match `maxDuration` in
 * src/app/api/cron/agents/route.ts — cron-route.test.ts reads the route file to make sure.
 */
export const CRON_MAX_DURATION_SECONDS = 300;
export const MAX_RUNS_PER_TICK = 5;
export const HANDLER_BUDGET_MS = 240_000;
export const APPLY_DEADLINE_MS = 285_000;
export const MIN_START_MS = 5_000;
export const MIN_TIMEOUT_SECONDS = 5;
export const MAX_TIMEOUT_SECONDS = 240;

/** How long this handler may run: its own timeout, cut short by the tick. */
export function handlerDeadlineMs(
  timeoutSeconds: number,
  anchorMs: number,
  nowMs: number,
  capMs: number = Number.POSITIVE_INFINITY
): number {
  return Math.min(timeoutSeconds * 1000, HANDLER_BUDGET_MS - (nowMs - anchorMs), capMs);
}

export function canStart(deadlineMs: number): boolean {
  return deadlineMs >= MIN_START_MS;
}

export function pastApplyDeadline(anchorMs: number, nowMs: number): boolean {
  return nowMs - anchorMs > APPLY_DEADLINE_MS;
}
