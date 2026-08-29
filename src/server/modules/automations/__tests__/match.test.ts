import { describe, it, expect } from "vitest";
import { matchesConditions } from "../match";

describe("matchesConditions", () => {
  it("matches a stage rule on its stage", () => {
    expect(matchesConditions("stage_entered", { stageId: "s1" }, { stageId: "s1" })).toBe(true);
  });

  it("rejects a stage rule on another stage", () => {
    expect(matchesConditions("stage_entered", { stageId: "s1" }, { stageId: "s2" })).toBe(false);
  });

  it("treats empty conditions as 'every occurrence'", () => {
    expect(matchesConditions("stage_entered", {}, { stageId: "anything" })).toBe(true);
  });

  it("matches a checklist rule on its kind", () => {
    expect(matchesConditions("photo_checklist_completed", { kind: "install" }, { kind: "install" })).toBe(true);
    expect(matchesConditions("photo_checklist_completed", { kind: "install" }, { kind: "site" })).toBe(false);
  });

  it("matches a document rule on its template", () => {
    expect(matchesConditions("document_completed", { templateId: "t1" }, { templateId: "t1" })).toBe(true);
    expect(matchesConditions("document_completed", { templateId: "t1" }, { templateId: "t2" })).toBe(false);
  });

  it("matches a document rule on ANY template in a bundled envelope", () => {
    // Several templates can share one envelope, and the package's own
    // templateId only names the first — a rule keyed to the second must still
    // fire, or it silently never runs.
    const bundle = { templateId: "t1", templateIds: ["t1", "t2"] };
    expect(matchesConditions("document_completed", { templateId: "t2" }, bundle)).toBe(true);
    expect(matchesConditions("document_completed", { templateId: "t1" }, bundle)).toBe(true);
    expect(matchesConditions("document_completed", { templateId: "t3" }, bundle)).toBe(false);
    // Any-document rules still fire regardless.
    expect(matchesConditions("document_completed", {}, bundle)).toBe(true);
  });

  it("fires a stage-age rule only once the threshold is passed", () => {
    const cond = { stageId: "s1", days: 7 };
    expect(matchesConditions("stage_age_exceeded", cond, { stageId: "s1", days: 7 })).toBe(true);
    expect(matchesConditions("stage_age_exceeded", cond, { stageId: "s1", days: 9 })).toBe(true);
    expect(matchesConditions("stage_age_exceeded", cond, { stageId: "s1", days: 6 })).toBe(false);
  });

  it("rejects a stage-age rule sitting in a different stage", () => {
    expect(
      matchesConditions("stage_age_exceeded", { stageId: "s1", days: 1 }, { stageId: "s2", days: 30 })
    ).toBe(false);
  });

  it("survives a conditions blob that is not an object", () => {
    expect(matchesConditions("stage_entered", null, { stageId: "s1" })).toBe(true);
    expect(matchesConditions("stage_entered", "junk", { stageId: "s1" })).toBe(true);
  });
});
