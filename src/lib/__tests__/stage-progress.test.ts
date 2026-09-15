// src/lib/__tests__/stage-progress.test.ts
import { describe, it, expect } from "vitest";
import { isMainLine, stageProgress, type ProgressStage } from "../stage-progress";

const s = (id: string, flags: Omit<ProgressStage, "id"> = {}): ProgressStage => ({ id, ...flags });

/** Roofing once the side-states land, trimmed. */
const ROOFING = [
  s("adjuster_meeting"),
  s("adjuster_meeting_complete"),
  s("claim_denied", { isActionRequired: true }),
  s("scope_received"),
  s("qc_inspection"),
  s("qc_failed", { isActionRequired: true }),
  s("paid"),
  s("cancelled", { isLost: true }),
];

describe("isMainLine", () => {
  it("leaves out the lost stage and every side-state", () => {
    expect(ROOFING.filter(isMainLine).map((x) => x.id)).toEqual([
      "adjuster_meeting",
      "adjuster_meeting_complete",
      "scope_received",
      "qc_inspection",
      "paid",
    ]);
  });
});

describe("stageProgress", () => {
  it("offers the next main-line stage, stepping over a side-state", () => {
    const p = stageProgress(ROOFING, "adjuster_meeting_complete");
    expect(p.nextStage?.id).toBe("scope_received");
    expect(p.step).toBe(2);
    expect(p.liveCount).toBe(5);
    expect(p.isSideState).toBe(false);
  });

  it("from a side-state, offers the main-line stage after it and keeps the step already reached", () => {
    const p = stageProgress(ROOFING, "claim_denied");
    expect(p.nextStage?.id).toBe("scope_received");
    expect(p.step).toBe(2);
    expect(p.isSideState).toBe(true);
  });

  it("never offers Cancelled from the last main-line stage", () => {
    const p = stageProgress(ROOFING, "paid");
    expect(p.nextStage).toBeNull();
    expect(p.step).toBe(5);
  });

  it("knows a cancelled deal, and where Cancelled is", () => {
    const p = stageProgress(ROOFING, "cancelled");
    expect(p.isCancelled).toBe(true);
    expect(p.lostStage?.id).toBe("cancelled");
    expect(p.nextStage).toBeNull();
  });

  it("starts a deal with no stage before the first main-line stage", () => {
    const p = stageProgress(ROOFING, null);
    expect(p.currentIndex).toBe(-1);
    expect(p.step).toBe(0);
    expect(p.nextStage?.id).toBe("adjuster_meeting");
  });

  it("with nothing flagged action-required, behaves exactly as Advance did before", () => {
    const plain = [s("a"), s("b"), s("c"), s("x", { isLost: true })];
    const p = stageProgress(plain, "b");
    expect(p).toMatchObject({ currentIndex: 1, step: 2, liveCount: 3, isCancelled: false, isSideState: false });
    expect(p.nextStage?.id).toBe("c");
  });

  it("counts a live stage past an early lost stage, excluding the lost one from step and live count", () => {
    const withEarlyLoss = [s("a"), s("dead_early", { isLost: true }), s("b"), s("c")];
    const p = stageProgress(withEarlyLoss, "b");
    expect(p.step).toBe(2);
    expect(p.liveCount).toBe(3);
    expect(p.nextStage?.id).toBe("c");
  });

  it("treats an unknown stage id, or no stage at all, as before the first main-line stage", () => {
    const unknown = stageProgress(ROOFING, "not_a_real_stage");
    const none = stageProgress(ROOFING, null);
    for (const p of [unknown, none]) {
      expect(p.currentIndex).toBe(-1);
      expect(p.current).toBeNull();
      expect(p.step).toBe(0);
      expect(p.nextStage?.id).toBe("adjuster_meeting");
      expect(p.isCancelled).toBe(false);
      expect(p.isSideState).toBe(false);
    }
  });
});
