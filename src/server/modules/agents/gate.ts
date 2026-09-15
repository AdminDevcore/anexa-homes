import type { AgentResult, ChangeRecord, RequestedChange, ResolvedChange } from "./types";

/**
 * The human gate, as a pure function.
 *
 * A gated agent may flag work, but may move a deal only into a stage flagged
 * `isActionRequired` — a side-state like "NTP Action Required" that exists to
 * hold a deal while a person deals with it. Anything else it asks for is held
 * for a human.
 */
export function decideChange(input: {
  alreadyInTarget: boolean;
  requiresHumanGate: boolean;
  targetIsActionRequired: boolean;
}): "noop" | "held" | "applied" {
  if (input.alreadyInTarget) return "noop";
  if (input.requiresHumanGate && !input.targetIsActionRequired) return "held";
  return "applied";
}

/**
 * Decide every change before any is applied. One invalid change (a deal or a
 * stage that is not there, a repeat move for a deal already asked to move, a
 * Contract Signed refusal, or a funding refusal on a change that would
 * otherwise apply) fails the run, and nothing in it is applied: a run that
 * half-happened is harder to reason about than one that did not happen.
 *
 * Precedence per change: deal not found, then a repeat move for a deal this
 * run already resolved, then stage not found, then already in the target
 * stage (a `noop` — a refusal never overrides it), then a Contract Signed
 * refusal, then the human gate, with a funding refusal only turning an
 * `applied` outcome into `invalid` — a `held` change stays `held`, because
 * the approving person's own authority decides that at Apply.
 */
export function planChanges(resolved: ResolvedChange[], requiresHumanGate: boolean): ChangeRecord[] {
  // Every change is resolved against the deal's stage as it stood before
  // anything in this run moved, so a second change for the same deal can't be
  // trusted — the first may have already moved it, which would make the
  // second's own "already in target" and stage lookups stale. Only the first
  // change for a deal (counting only changes whose deal was actually found)
  // is decided on its merits; every later one for that deal is invalid
  // outright, whatever it itself asked for.
  const seenLeadIds = new Set<string>();

  const records = resolved.map((r): ChangeRecord => {
    const base = {
      ...r.change,
      dealLabel: r.lead?.label ?? null,
      fromStage: r.fromStage,
      toStage: r.toStage,
    };
    if (!r.lead) {
      return { ...base, outcome: "invalid", note: "Deal not found in this company and workspace." };
    }
    if (seenLeadIds.has(r.change.leadId)) {
      return {
        ...base,
        outcome: "invalid",
        note: "An agent may move a deal once per run; this deal was already asked to move.",
      };
    }
    seenLeadIds.add(r.change.leadId);
    if (!r.toStage) {
      return { ...base, outcome: "invalid", note: `No stage "${r.change.toStageKey}" in this deal's pipeline.` };
    }
    const alreadyInTarget = r.fromStage?.id === r.toStage.id;
    if (alreadyInTarget) {
      return { ...base, outcome: "noop", note: null };
    }
    if (r.contractRefusal) {
      return { ...base, outcome: "invalid", note: r.contractRefusal };
    }
    const outcome = decideChange({
      // Always false here, because `noop` was decided above.
      alreadyInTarget: false,
      requiresHumanGate,
      targetIsActionRequired: r.toStage.isActionRequired,
    });
    if (outcome === "applied" && r.fundingRefusal) {
      return { ...base, outcome: "invalid", note: r.fundingRefusal };
    }
    return {
      ...base,
      outcome,
      note:
        outcome === "held"
          ? `Held: this agent is gated and ${r.toStage.name} is not an Action Required stage.`
          : null,
    };
  });

  if (!records.some((c) => c.outcome === "invalid")) return records;
  // A held change can never be approved once its run has failed, so it is
  // discarded alongside anything that would have applied.
  return records.map((c): ChangeRecord =>
    c.outcome === "applied" || c.outcome === "held"
      ? { ...c, outcome: "discarded", note: "Not applied: another change in this run was invalid." }
      : c
  );
}

export function discardAll(changes: RequestedChange[], note: string): ChangeRecord[] {
  return changes.map((c): ChangeRecord => ({
    ...c,
    dealLabel: null,
    fromStage: null,
    toStage: null,
    outcome: "discarded",
    note,
  }));
}

/** Strongest wins: failed > needs_human > success. */
export function finalStatus(
  handlerStatus: AgentResult["status"],
  changes: ChangeRecord[]
): "success" | "failed" | "needs_human" {
  if (handlerStatus === "failed" || changes.some((c) => c.outcome === "invalid")) return "failed";
  if (handlerStatus === "needs_human" || changes.some((c) => c.outcome === "held")) return "needs_human";
  return "success";
}
