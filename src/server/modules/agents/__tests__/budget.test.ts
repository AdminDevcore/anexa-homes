import { describe, it, expect } from "vitest";
import {
  APPLY_DEADLINE_MS,
  CRON_MAX_DURATION_SECONDS,
  HANDLER_BUDGET_MS,
  MAX_RUNS_PER_TICK,
  MAX_TIMEOUT_SECONDS,
  MIN_START_MS,
  canStart,
  handlerDeadlineMs,
  pastApplyDeadline,
} from "../budget";
import { withTimeout } from "../timeout";

describe("tick budget", () => {
  it("fits five concurrent 240 s runs, their apply and their finalise inside the 300 s function", () => {
    expect(MAX_RUNS_PER_TICK).toBe(5);
    expect(MAX_TIMEOUT_SECONDS * 1000).toBeLessThanOrEqual(HANDLER_BUDGET_MS);
    expect(HANDLER_BUDGET_MS).toBeLessThan(APPLY_DEADLINE_MS);
    expect(APPLY_DEADLINE_MS).toBeLessThan(CRON_MAX_DURATION_SECONDS * 1000);
  });

  it("a handler gets its own timeout, cut short by time already spent in the tick", () => {
    expect(handlerDeadlineMs(240, 0, 0)).toBe(240_000);
    expect(handlerDeadlineMs(240, 0, 10_000)).toBe(230_000);
    expect(handlerDeadlineMs(60, 0, 10_000)).toBe(60_000);
    expect(handlerDeadlineMs(60, 0, 0, 200)).toBe(200);
  });

  it("does not start a run with under five seconds left", () => {
    const left = handlerDeadlineMs(60, 0, HANDLER_BUDGET_MS - 4_000);
    expect(left).toBe(4_000);
    expect(canStart(left)).toBe(false);
    expect(canStart(MIN_START_MS)).toBe(true);
  });

  it("stops applying changes after the apply deadline", () => {
    expect(pastApplyDeadline(0, APPLY_DEADLINE_MS)).toBe(false);
    expect(pastApplyDeadline(0, APPLY_DEADLINE_MS + 1)).toBe(true);
  });
});

describe("withTimeout", () => {
  it("returns the value", async () => {
    const c = new AbortController();
    await expect(withTimeout(async () => 42, 1_000, c)).resolves.toEqual({ kind: "result", value: 42 });
    expect(c.signal.aborted).toBe(false);
  });

  it("catches a synchronous or async throw", async () => {
    const c = new AbortController();
    const sync = await withTimeout(() => {
      throw new Error("sync");
    }, 1_000, c);
    expect(sync.kind).toBe("threw");
    const asyncThrow = await withTimeout(async () => Promise.reject(new Error("async")), 1_000, c);
    expect(asyncThrow.kind).toBe("threw");
  });

  it("gives up at the deadline and aborts the signal", async () => {
    const c = new AbortController();
    const r = await withTimeout(() => new Promise(() => {}), 20, c);
    expect(r).toEqual({ kind: "timeout" });
    expect(c.signal.aborted).toBe(true);
  });
});
