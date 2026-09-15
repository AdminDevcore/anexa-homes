import { describe, it, expect } from "vitest";
import {
  SCHEDULE_PRESETS,
  describeSchedule,
  nextRunAfter,
  nextRunAtFor,
  nextRuns,
  validateSchedule,
} from "../schedule";

describe("validateSchedule", () => {
  it("accepts a 5-field expression and normalises its spacing", () => {
    expect(validateSchedule("  */15   * * * *  ")).toEqual({ ok: true, schedule: "*/15 * * * *" });
  });

  it("refuses 6- and 7-field patterns, which croner would read as seconds and years", () => {
    expect(validateSchedule("0 */15 * * * *").ok).toBe(false);
    expect(validateSchedule("0 0 12 * * * 2027").ok).toBe(false);
  });

  it("refuses an expression croner cannot parse", () => {
    const r = validateSchedule("61 * * * *");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not a valid cron expression/i);
  });

  it("does not leak croner's internal 'CronPattern:' prefix into the error", () => {
    const r = validateSchedule("61 * * * *");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).not.toContain("CronPattern");
  });

  it("says a schedule never runs, rather than surfacing croner's stack-overflow message", () => {
    expect(validateSchedule("0 0 30 2 *")).toEqual({ ok: false, error: "That schedule never runs." });
    expect(validateSchedule("0 0 31 2,4,6,9,11 *")).toEqual({
      ok: false,
      error: "That schedule never runs.",
    });
  });

  it("accepts every preset", () => {
    for (const p of SCHEDULE_PRESETS) expect(validateSchedule(p.schedule).ok).toBe(true);
  });
});

describe("next runs, in UTC", () => {
  it("rounds up to the next quarter hour", () => {
    const from = new Date("2026-09-15T14:07:30.000Z");
    expect(nextRunAfter("*/15 * * * *", from)?.toISOString()).toBe("2026-09-15T14:15:00.000Z");
  });

  it("skips a weekend for a weekday schedule", () => {
    // 2026-09-19 is a Saturday.
    const from = new Date("2026-09-19T00:00:00.000Z");
    expect(nextRunAfter("0 13 * * 1-5", from)?.toISOString()).toBe("2026-09-21T13:00:00.000Z");
  });

  it("is strictly after `from`, even when `from` lands exactly on a match", () => {
    const from = new Date("2026-09-15T14:15:00.000Z");
    expect(nextRunAfter("*/15 * * * *", from)?.toISOString()).toBe("2026-09-15T14:30:00.000Z");
  });

  it("lists the next three", () => {
    const from = new Date("2026-09-15T14:00:00.000Z");
    expect(nextRuns("0 * * * *", from, 3).map((d) => d.toISOString())).toEqual([
      "2026-09-15T15:00:00.000Z",
      "2026-09-15T16:00:00.000Z",
      "2026-09-15T17:00:00.000Z",
    ]);
  });

  it("returns an empty list rather than spinning forever, for a bad count", () => {
    const from = new Date("2026-09-15T14:00:00.000Z");
    expect(nextRuns("0 * * * *", from, -1)).toEqual([]);
    expect(nextRuns("0 * * * *", from, 2.5)).toEqual([]);
    expect(nextRuns("0 * * * *", from, 0)).toEqual([]);
  });

  it("is null for a broken expression rather than throwing", () => {
    expect(nextRunAfter("nope", new Date())).toBeNull();
  });
});

describe("nextRunAtFor", () => {
  const now = new Date("2026-09-15T14:07:00.000Z");

  it("is null unless the agent is enabled AND scheduled", () => {
    expect(nextRunAtFor({ enabled: false, schedule: "*/5 * * * *" }, now)).toBeNull();
    expect(nextRunAtFor({ enabled: true, schedule: null }, now)).toBeNull();
    expect(nextRunAtFor({ enabled: true, schedule: "*/5 * * * *" }, now)?.toISOString()).toBe(
      "2026-09-15T14:10:00.000Z"
    );
  });

  it("is null when the schedule is not a valid cron expression", () => {
    expect(nextRunAtFor({ enabled: true, schedule: "not a cron" }, now)).toBeNull();
  });
});

describe("describeSchedule", () => {
  it("names presets, calls anything else custom, and says when there is none", () => {
    expect(describeSchedule("*/15 * * * *")).toBe("Every 15 minutes");
    expect(describeSchedule("7 3 * * 2")).toBe("Custom");
    expect(describeSchedule(null)).toBe("Not scheduled");
  });
});
