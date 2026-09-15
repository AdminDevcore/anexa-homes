import { describe, it, expect, afterEach, vi } from "vitest";
import { stageEntryData } from "../stage-entry-data";

describe("stageEntryData", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("connects the stage, restarts both clocks and takes the stage's default blocker", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T14:00:00.000Z"));
    expect(stageEntryData({ id: "s1", defaultBlocker: "lender", stageType: "externally_blocked" })).toEqual({
      stage: { connect: { id: "s1" } },
      stageChangedAt: new Date("2026-09-15T14:00:00.000Z"),
      stageAlertLevel: 0,
      stageOverdue: false,
      blockedBy: "lender",
      lastTouchAt: null,
      lastChaseAlertAt: null,
    });
  });

  it("clears the blocker note only when we own the stage", () => {
    expect(stageEntryData({ id: "s1", defaultBlocker: null, stageType: "internally_owned" })).toMatchObject({
      blockerNote: null,
    });
    expect(
      stageEntryData({ id: "s1", defaultBlocker: null, stageType: "externally_blocked" })
    ).not.toHaveProperty("blockerNote");
  });
});
