import { describe, it, expect } from "vitest";
import { decideChange, discardAll, finalStatus, planChanges } from "../gate";
import { agentRunVerticals, agentVisibleTo, viewerRunVerticals } from "../verticals";
import type { RequestedChange, ResolvedChange, TargetStage } from "../types";

const LEAD = "0b8f5a8e-2f1e-4d7c-9a6b-1c2d3e4f5a6b";
const change: RequestedChange = { type: "move_stage", leadId: LEAD, toStageKey: "to", reason: "why" };
const from = { id: "s1", key: "from", name: "NTP Submitted" };
const target = (over: Partial<TargetStage> = {}): TargetStage => ({
  id: "s2",
  key: "to",
  name: "NTP Action Required",
  position: 3,
  isActionRequired: true,
  defaultBlocker: null,
  stageType: "internally_owned",
  ...over,
});
const resolved = (over: Partial<ResolvedChange> = {}): ResolvedChange => ({
  change,
  lead: { id: LEAD, label: "Maria Lopez · 12 Elm St" },
  fromStage: from,
  toStage: target(),
  contractRefusal: null,
  fundingRefusal: null,
  ...over,
});

describe("decideChange", () => {
  it.each([
    [{ alreadyInTarget: true, requiresHumanGate: true, targetIsActionRequired: false }, "noop"],
    [{ alreadyInTarget: false, requiresHumanGate: true, targetIsActionRequired: false }, "held"],
    [{ alreadyInTarget: false, requiresHumanGate: true, targetIsActionRequired: true }, "applied"],
    [{ alreadyInTarget: false, requiresHumanGate: false, targetIsActionRequired: false }, "applied"],
    [{ alreadyInTarget: false, requiresHumanGate: false, targetIsActionRequired: true }, "applied"],
  ] as const)("%o → %s", (input, expected) => {
    expect(decideChange(input)).toBe(expected);
  });
});

describe("planChanges", () => {
  it("applies a move into an action-required stage even when gated", () => {
    const [c] = planChanges([resolved()], true);
    expect(c.outcome).toBe("applied");
    expect(c.dealLabel).toBe("Maria Lopez · 12 Elm St");
    expect(c.fromStage).toEqual(from);
  });

  it("holds a gated move onto the main line, and says why", () => {
    const [c] = planChanges([resolved({ toStage: target({ isActionRequired: false, name: "NTP Approved" }) })], true);
    expect(c.outcome).toBe("held");
    expect(c.note).toMatch(/NTP Approved is not an Action Required stage/);
  });

  it("is a noop when the deal is already there", () => {
    const [c] = planChanges([resolved({ fromStage: { id: "s2", key: "to", name: "NTP Action Required" } })], true);
    expect(c.outcome).toBe("noop");
  });

  it("marks a missing deal or stage invalid, and discards every change that would have applied", () => {
    const planned = planChanges([resolved({ lead: null }), resolved()], false);
    expect(planned.map((c) => c.outcome)).toEqual(["invalid", "discarded"]);
    const noStage = planChanges([resolved({ toStage: null })], false);
    expect(noStage[0].note).toMatch(/No stage "to"/);
  });

  // Amendment (2026-09-15): Contract Signed and M1 Funding refusals.

  it("a Contract Signed refusal is invalid, and discards the rest of the run", () => {
    const planned = planChanges(
      [
        resolved({ contractRefusal: "This deal has no signed proposal and completed contract on file." }),
        resolved(),
      ],
      false
    );
    expect(planned[0]).toMatchObject({
      outcome: "invalid",
      note: "This deal has no signed proposal and completed contract on file.",
    });
    expect(planned[1].outcome).toBe("discarded");
  });

  it("a funding refusal on a change that would apply is invalid", () => {
    const [c] = planChanges([resolved({ fundingRefusal: "M1 Funding is not certified for this deal." })], false);
    expect(c.outcome).toBe("invalid");
    expect(c.note).toBe("M1 Funding is not certified for this deal.");
  });

  it("a funding refusal on a held change stays held", () => {
    const [c] = planChanges(
      [
        resolved({
          toStage: target({ isActionRequired: false, name: "NTP Approved" }),
          fundingRefusal: "M1 Funding is not certified for this deal.",
        }),
      ],
      true
    );
    expect(c.outcome).toBe("held");
    expect(c.note).toMatch(/NTP Approved is not an Action Required stage/);
  });

  it("a refusal on a change already in its target is still noop", () => {
    const [c] = planChanges(
      [
        resolved({
          fromStage: { id: "s2", key: "to", name: "NTP Action Required" },
          contractRefusal: "This deal has no signed proposal and completed contract on file.",
          fundingRefusal: "M1 Funding is not certified for this deal.",
        }),
      ],
      true
    );
    expect(c.outcome).toBe("noop");
  });
});

describe("discardAll and finalStatus", () => {
  it("records every change as discarded with the reason", () => {
    const [c] = discardAll([change], "handler failed");
    expect(c).toMatchObject({ outcome: "discarded", note: "handler failed", dealLabel: null });
  });

  it("failed beats needs_human beats success", () => {
    const held = planChanges([resolved({ toStage: target({ isActionRequired: false }) })], true);
    const invalid = planChanges([resolved({ lead: null })], true);
    const applied = planChanges([resolved()], true);
    expect(finalStatus("success", applied)).toBe("success");
    expect(finalStatus("success", held)).toBe("needs_human");
    expect(finalStatus("needs_human", applied)).toBe("needs_human");
    expect(finalStatus("success", invalid)).toBe("failed");
    expect(finalStatus("failed", held)).toBe("failed");
  });
});

describe("workspaces", () => {
  it("a both-agent runs in every live workspace; a scoped one only in its own, if live", () => {
    expect(agentRunVerticals(null, ["roofing", "solar"])).toEqual(["roofing", "solar"]);
    expect(agentRunVerticals("solar", ["roofing", "solar"])).toEqual(["solar"]);
    expect(agentRunVerticals("solar", ["roofing"])).toEqual([]);
    expect(agentRunVerticals("others", ["roofing", "solar"])).toEqual([]);
  });

  it("Run now narrows to the workspaces the viewer holds", () => {
    expect(viewerRunVerticals(null, ["roofing", "solar"], ["roofing"])).toEqual(["roofing"]);
  });

  it("a both-agent is visible to everyone; a scoped one to holders of its workspace", () => {
    expect(agentVisibleTo(null, ["roofing"])).toBe(true);
    expect(agentVisibleTo("solar", ["roofing"])).toBe(false);
    expect(agentVisibleTo("solar", ["roofing", "solar"])).toBe(true);
  });
});
