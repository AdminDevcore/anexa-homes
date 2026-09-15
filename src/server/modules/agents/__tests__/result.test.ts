import { describe, it, expect } from "vitest";
import { SUMMARY_MAX, parseAgentResult, truncateSummary } from "../result";
import { emptyDetail, errorText, missingHandlerMessage, readDetail } from "../detail";

const LEAD = "0b8f5a8e-2f1e-4d7c-9a6b-1c2d3e4f5a6b";

describe("parseAgentResult", () => {
  it("accepts a well-formed result", () => {
    const r = parseAgentResult({
      status: "needs_human",
      summary: "Stipulation on NTP",
      detail: { observed: "stip" },
      changes: [{ type: "move_stage", leadId: LEAD, toStageKey: "ntp_action_required_10", reason: "stip" }],
    });
    expect(r.ok).toBe(true);
  });

  it("refuses an unknown status, a missing summary, or a malformed change", () => {
    expect(parseAgentResult({ status: "done", summary: "x" }).ok).toBe(false);
    expect(parseAgentResult({ status: "success" }).ok).toBe(false);
    const bad = parseAgentResult({
      status: "success",
      summary: "x",
      changes: [{ type: "delete_deal", leadId: LEAD, toStageKey: "x", reason: "" }],
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/invalid result/i);
  });

  it("refuses a non-object", () => {
    expect(parseAgentResult(undefined).ok).toBe(false);
  });

  it("truncates a long summary", () => {
    const r = parseAgentResult({ status: "success", summary: "x".repeat(400) });
    expect(r.ok && r.result.summary.length).toBe(SUMMARY_MAX);
    expect(truncateSummary("short")).toBe("short");
  });
});

describe("run detail", () => {
  it("starts empty from the agent it ran", () => {
    expect(emptyDetail({ handlerKey: "system.hello", config: {}, requiresHumanGate: true })).toEqual({
      handlerKey: "system.hello",
      configSnapshot: {},
      gated: true,
      durationMs: null,
      log: [],
      handler: null,
      changes: [],
      resolution: null,
      lateResult: null,
    });
  });

  it("normalises whatever was stored", () => {
    const d = readDetail({ handlerKey: "k", log: ["a", 1], durationMs: "x" });
    expect(d.log).toEqual(["a", "1"]);
    expect(d.durationMs).toBeNull();
    expect(d.changes).toEqual([]);
    expect(readDetail(null).handlerKey).toBe("");
  });

  it("keeps a stack when there is one", () => {
    const err = new Error("boom");
    expect(errorText(err)).toContain("boom");
    expect(errorText("plain")).toBe("plain");
  });

  it("says what to do about a missing handler", () => {
    expect(missingHandlerMessage("bank.ntp_poll")).toBe(
      'No handler is registered for "bank.ntp_poll". Deploy the handler or disable this agent.'
    );
  });
});
