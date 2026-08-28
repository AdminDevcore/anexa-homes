import { describe, it, expect } from "vitest";
import { TRIGGER_DEFS, ACTION_DEFS, triggerLabel, actionLabel } from "../types";

describe("catalog", () => {
  it("defines every trigger in the Prisma enum", () => {
    expect(TRIGGER_DEFS.map((t) => t.value).sort()).toEqual([
      "document_completed",
      "photo_checklist_completed",
      "stage_age_exceeded",
      "stage_entered",
    ]);
  });

  it("defines all five actions", () => {
    expect(ACTION_DEFS.map((a) => a.value).sort()).toEqual([
      "compile_photos",
      "generate_document",
      "move_stage",
      "send_for_signature",
      "set_project_status",
    ]);
  });

  it("labels a known trigger and falls back on an unknown one", () => {
    expect(triggerLabel("stage_entered")).toBe("Deal reaches a stage");
    expect(triggerLabel("nonsense")).toBe("nonsense");
  });

  it("labels a known action", () => {
    expect(actionLabel("compile_photos")).toBe("Compile photos into a PDF");
  });
});
