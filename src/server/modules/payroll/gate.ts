/**
 * WHERE A DEAL HAS TO BE BEFORE ANYBODY GETS PAID.
 *
 * Commissions — and therefore payroll, which is built out of approved
 * commissions — cannot be generated until a deal reaches its vertical's gate
 * stage. The gate is PER VERTICAL because the two pipelines are not the same
 * shape and the money does not arrive at the same moment:
 *
 *   ROOFING gates at "Depreciation Requested". The carrier's recoverable
 *     depreciation is the last piece of the job's revenue; asking for it is the
 *     point where the pool is finally knowable.
 *
 *   SOLAR gates at "M1 Funding" — the lender's first milestone payment, which
 *     lands after the system is installed. This is the first dollar the company
 *     actually receives on a solar deal. Everything before it (contract signed,
 *     NTP approved, permit approved, even installed) is work we have paid for
 *     and not yet been paid for, so a payout there would be advancing the rep
 *     the company's own cash on a job that can still cancel.
 *
 * This module is deliberately free of any database import so the matching rule
 * can be unit-tested on its own.
 *
 * Matching is by KEY OR NAME, and that is not belt-and-braces. Stage keys are
 * only stable for stages that came out of the seed; a stage a human adds in
 * Settings gets an auto-generated key with a numeric suffix ("M1 Funding"
 * created after a rename from "Partial Funding" is live today as
 * `partial_funding_26`). The name is what the humans maintain, so the name is
 * what we are allowed to rely on.
 */

export type GateStageShape = { key: string; name: string };

type GateDef = {
  /** What the UI calls the gate when telling somebody a deal has not reached it. */
  label: string;
  /** Seeded keys, tolerating the `_12` suffix Settings appends to hand-made stages. */
  keyPattern: RegExp;
  /** The maintained-by-humans side of the match. */
  namePattern: RegExp;
};

const GATE_BY_VERTICAL: Record<string, GateDef> = {
  roofing: {
    label: "Depreciation Requested",
    keyPattern: /^depreciation_requested(_\d+)?$/i,
    namePattern: /depreciation/i,
  },
  solar: {
    label: "M1 Funding",
    // `partial_funding` is the name this stage was born with before it was
    // renamed to M1 Funding; the key it minted then is still the live one.
    keyPattern: /^(m1[_-]?funding|partial[_-]?funding)(_\d+)?$/i,
    // "M1", "M-1", "M 1", plus the name this stage was born with — but never
    // "m2 Funded", which is the SECOND milestone and sits at the far end of the
    // pipeline, months later.
    namePattern: /\bm[\s._-]?1\b|partial\s+funding/i,
  },
};

export const COMMISSION_GATE_LABEL = GATE_BY_VERTICAL.roofing.label;
export const COMMISSION_GATE_STAGE_KEY = "depreciation_requested";

function gateFor(vertical: string): GateDef {
  return GATE_BY_VERTICAL[vertical] ?? GATE_BY_VERTICAL.roofing;
}

/** What the UI tells a user no deal has reached yet, for the vertical they're in. */
export function commissionGateLabel(vertical: string): string {
  return gateFor(vertical).label;
}

/**
 * The gate stage inside one pipeline's stage list, or undefined when that
 * pipeline has no such stage (a custom pipeline, or a solar pipeline seeded
 * before M1 Funding existed). Callers decide the fallback.
 */
export function findGateStage<T extends GateStageShape>(vertical: string, stages: T[]): T | undefined {
  const gate = gateFor(vertical);
  return (
    stages.find((s) => gate.keyPattern.test(s.key)) ?? stages.find((s) => gate.namePattern.test(s.name))
  );
}

/** The stage rows the eligibility set is built from. */
export type EligibilityStage = GateStageShape & { id: string; position: number; isWon: boolean; isLost: boolean };

/**
 * Which stage IDs, across every pipeline in a company, sit at or past their own
 * pipeline's commission gate. Pure, so the rules below are testable without a
 * database:
 *
 *   AT OR PAST, BY POSITION — not an exact stage match. A deal that has already
 *     run past the gate (solar sitting at Inspection Complete, roofing at Paid)
 *     is obviously still owed, and nobody should have to drag it backwards to
 *     get a payout generated.
 *
 *   NEVER A LOST STAGE — a Cancelled stage usually lives at the very END of the
 *     pipeline, so "at or past the gate" sweeps it up and a dead deal pays a
 *     commission. Lost stages are cut back out regardless of position.
 *
 *   NO GATE STAGE AT ALL → fall back to the pipeline's won stages, so a custom
 *     pipeline can still pay rather than being silently unable to.
 */
export function eligibleStageIds(pipelines: { vertical: string; stages: EligibilityStage[] }[]): Set<string> {
  const eligible = new Set<string>();
  for (const p of pipelines) {
    const gate = findGateStage(p.vertical, p.stages);
    for (const s of p.stages) {
      if (s.isLost) continue;
      if (gate ? s.position >= gate.position : s.isWon) eligible.add(s.id);
    }
  }
  return eligible;
}
