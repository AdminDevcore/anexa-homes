import { describe, it, expect } from "vitest";
import { resolvePeriod } from "../period";

describe("resolvePeriod", () => {
  // The regression: `new Date("2026-06-01")` is UTC midnight, which in any
  // timezone west of Greenwich is the evening of May 31 — and rounding that
  // down to the start of its day reported a June range from May 31.
  it("reads a custom range as local calendar days", () => {
    const period = resolvePeriod("custom", "2026-06-01", "2026-07-01");
    expect(period.from.getFullYear()).toBe(2026);
    expect(period.from.getMonth()).toBe(5); // June
    expect(period.from.getDate()).toBe(1);
    expect(period.from.getHours()).toBe(0);
    // The last day is included whole — a job installed that afternoon counts.
    expect(period.to.getMonth()).toBe(6); // July
    expect(period.to.getDate()).toBe(1);
    expect(period.to.getHours()).toBe(23);
  });

  it("falls back to the week when a custom range is malformed", () => {
    expect(resolvePeriod("custom", "not-a-date", "").preset).toBe("week");
  });

  it("reaches back past the company for all time", () => {
    const period = resolvePeriod("all");
    expect(period.label).toBe("All time");
    expect(period.from.getFullYear()).toBeLessThanOrEqual(2000);
    expect(period.to.getTime()).toBeGreaterThan(Date.now() - 1000);
  });

  it("ends last month on the last day of last month", () => {
    const period = resolvePeriod("last_month");
    const now = new Date();
    expect(period.from.getMonth()).toBe(new Date(now.getFullYear(), now.getMonth() - 1, 1).getMonth());
    // Not today: a "last month" window that runs to now would double-count.
    expect(period.to.getTime()).toBeLessThan(new Date(now.getFullYear(), now.getMonth(), 1).getTime());
  });

  it("defaults to this week", () => {
    expect(resolvePeriod().preset).toBe("week");
    expect(resolvePeriod("nonsense").preset).toBe("week");
  });
});
