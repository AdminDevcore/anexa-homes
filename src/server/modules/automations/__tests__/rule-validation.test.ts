import { describe, it, expect } from "vitest";
import { validateRule } from "../validate";

const base = {
  name: "Installed paperwork",
  trigger: "stage_entered" as const,
  conditions: { stageId: "stage-1" },
  actions: [{ type: "generate_document", templateId: "t1" }],
  once: true,
  active: true,
};

describe("validateRule", () => {
  it("accepts a well-formed rule", () => {
    expect(validateRule(base).ok).toBe(true);
  });

  it("rejects a rule with no actions", () => {
    const r = validateRule({ ...base, actions: [] });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/at least one action/i);
  });

  it("rejects an unknown action type", () => {
    expect(validateRule({ ...base, actions: [{ type: "launch_rocket" }] }).ok).toBe(false);
  });

  it("rejects an action whose config is incomplete", () => {
    expect(validateRule({ ...base, actions: [{ type: "generate_document" }] }).ok).toBe(false);
  });

  it("refuses a stage rule that moves the deal back to its own trigger stage", () => {
    const r = validateRule({ ...base, actions: [{ type: "move_stage", stageId: "stage-1" }] });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/same stage/i);
  });

  it("allows moving to a different stage", () => {
    expect(validateRule({ ...base, actions: [{ type: "move_stage", stageId: "stage-2" }] }).ok).toBe(true);
  });

  it("rejects an empty name", () => {
    expect(validateRule({ ...base, name: "  " }).ok).toBe(false);
  });

  it("carries a signature rule's signer through", () => {
    const r = validateRule({
      ...base,
      actions: [{ type: "send_for_signature", templateId: "t1", signer: "customer" }],
    });
    expect(r.ok).toBe(true);
  });

  it("rejects a signature rule with no signer", () => {
    expect(
      validateRule({ ...base, actions: [{ type: "send_for_signature", templateId: "t1" }] }).ok
    ).toBe(false);
  });
});
