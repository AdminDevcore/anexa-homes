import { describe, it, expect } from "vitest";
import { MAX_DETAIL_CHARS, MAX_ERROR_CHARS, SUMMARY_MAX, parseAgentResult, truncateSummary } from "../result";
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

  it("refuses an empty summary", () => {
    expect(parseAgentResult({ status: "success", summary: "" }).ok).toBe(false);
  });

  it("truncates a long summary", () => {
    const r = parseAgentResult({ status: "success", summary: "x".repeat(400) });
    expect(r.ok && r.result.summary.length).toBe(SUMMARY_MAX);
    expect(truncateSummary("short")).toBe("short");
  });

  it("refuses a change: typo instead of changes:, rather than silently dropping it", () => {
    const r = parseAgentResult({
      status: "success",
      summary: "x",
      change: [{ type: "move_stage", leadId: LEAD, toStageKey: "k", reason: "r" }],
    });
    expect(r.ok).toBe(false);
  });

  it("shortens a long error instead of rejecting it", () => {
    const r = parseAgentResult({ status: "failed", summary: "x", error: "e".repeat(5000) });
    expect(r.ok).toBe(true);
    expect(r.ok && r.result.error?.length).toBe(MAX_ERROR_CHARS);
  });

  describe("detail must be JSON and bounded", () => {
    it("refuses a circular detail", () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      const r = parseAgentResult({ status: "success", summary: "x", detail: circular });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/JSON-serialisable/);
    });

    it("refuses a BigInt in detail", () => {
      const r = parseAgentResult({ status: "success", summary: "x", detail: { big: BigInt(10) } });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/JSON-serialisable/);
    });

    it("refuses a detail over 32 KB serialised", () => {
      const r = parseAgentResult({ status: "success", summary: "x", detail: { big: "x".repeat(40_000) } });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(new RegExp(`at most ${MAX_DETAIL_CHARS} characters`));
    });

    it("allows a normal, small detail", () => {
      const r = parseAgentResult({ status: "success", summary: "x", detail: { observed: "stip", count: 3 } });
      expect(r.ok).toBe(true);
    });
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

  it("treats a handler array as absent, and drops non-object changes", () => {
    const d = readDetail({ handler: [], changes: [null, 1, { outcome: "applied" }] });
    expect(d.handler).toBeNull();
    expect(d.changes).toEqual([{ outcome: "applied" }]);
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
