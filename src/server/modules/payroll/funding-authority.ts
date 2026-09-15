import type { AccessUser } from "@/server/rbac/guards";
import { can } from "@/server/rbac/guards";
import { findGateStage, type GateStageShape } from "./gate";

/**
 * WHO MAY SAY THE MONEY ARRIVED.
 *
 * Commission on a solar deal is released by two facts standing together:
 *
 *   1. the deal's stage is at or past its pipeline's funding gate (M1 Funding)
 *   2. `SolarMilestone(payee: "rep", sequence: 1).paidAt` is set
 *
 * Both used to be ordinary `Lead:update` writes, which every `sales_rep` holds
 * on their own deals. A rep could therefore drag their own deal to M1 Funding,
 * tick the rep-commission milestone as paid, and present an unfunded — or
 * fabricated — deal to the funding desk as fully commission-ready. They could
 * not approve their own pay, but they could manufacture every precondition for
 * somebody else to approve it in a queue worked through in bulk.
 *
 * That is a segregation-of-duties failure, not a UI problem, so the authority
 * lives here and is enforced in the server actions rather than by hiding a
 * control.
 *
 * ── THE AUTHORITY ───────────────────────────────────────────────────────────
 * `Commission:approve`, which the matrix grants to exactly the people whose job
 * this is: `super_admin`, `admin` and `accounting` — the funding desk. It is
 * deliberately NOT a new permission: "may decide a commission is real" is the
 * grant that already means this, and inventing a second one to sit beside it
 * would give two answers to one question.
 *
 * Explicitly NOT holders: `manager` and `sales_rep` both hold `Commission:read`
 * and nothing more. A manager runs the sales floor; funding is the desk that
 * watches the bank.
 *
 * ── VIEWING IS NOT CERTIFYING ───────────────────────────────────────────────
 * Nothing here restricts READING funding status. A rep needs to know whether
 * their deal has funded, and `Commission:read` still shows them. What they may
 * not do is be the one who says so.
 */
export function canCertifyFunding(user: AccessUser): boolean {
  return can(user, "approve", "Commission");
}

/** The sentence shown to somebody who tried and may not. */
export const FUNDING_AUTHORITY_ERROR =
  "Recording that a lender has funded a deal is the funding desk's to do. " +
  "Ask an administrator or accounting to confirm M1.";

/**
 * Does moving into this stage cross the funding gate?
 *
 * AT OR PAST, BY POSITION, and matched through `findGateStage` rather than by
 * name — a stage created or renamed in Settings gets an auto-suffixed key, and
 * the live M1 stage is `partial_funding_26` for exactly that reason. Hard-coding
 * `key === "m1_funding"` would leave the gate open on the only pipeline that
 * matters.
 *
 * "At or past" rather than "exactly the gate" because `eligibleStageIds` is
 * itself positional: a deal parked at Inspection Complete is past M1 and is
 * eligible, so jumping straight there would clear the same bar as landing on
 * the gate stage.
 *
 * A LOST STAGE IS NEVER PAST THE GATE, whatever its position. Cancelled
 * conventionally sits at the very end of a pipeline, and treating it as beyond
 * the funding line would stop a rep from cancelling their own dead deal — which
 * is both the wrong outcome and nothing to do with money arriving.
 *
 * A pipeline with no gate stage at all yields `false`: nothing to cross.
 */
export function crossesFundingGate<T extends GateStageShape & { position: number; isLost: boolean }>(
  vertical: string,
  stages: T[],
  target: { id: string; position: number; isLost: boolean }
): boolean {
  if (target.isLost) return false;
  const gate = findGateStage(vertical, stages);
  if (!gate) return false;
  return target.position >= gate.position;
}

/**
 * May this user move this deal into this stage, or is it past the funding line?
 *
 * Returns the sentence to refuse with, or null to allow.
 *
 * ── WHY THE STAGE IS GUARDED AT ALL ─────────────────────────────────────────
 * Locking `paidAt` alone already breaks the conjunction that releases
 * commission, so a rep dragging a deal to M1 Funding can no longer be paid for
 * it. The stage is guarded anyway because the board is an operational record
 * that other people act on: a deal sitting in "M1 Funding" is a claim that a
 * lender has paid, and the funding desk works from that board. Letting a rep
 * make the claim invites the desk to confirm it.
 *
 * ── AND WHY IT DOES NOT BREAK OPERATIONS ────────────────────────────────────
 * The rule is not "only the funding desk may touch a funded deal", which would
 * stop a coordinator moving a job through Inspection and PTO. It is:
 *
 *   you may move a deal at or past the funding gate IF you may certify
 *   funding, OR IF funding has already been certified.
 *
 * So the desk records M1 once, and from then on anybody who can work the board
 * carries the job forward normally. What nobody without the authority can do is
 * put a deal past the line ahead of the money.
 *
 * Roofing is untouched: its gate is the depreciation request, which is not a
 * claim about cash received, and it has no funding milestone. The rule applies
 * only where a milestone exists to be certified — see the vertical check.
 */
export async function fundingGateMoveError(
  user: AccessUser,
  leadId: string,
  target: { id: string; position: number; isLost: boolean; pipelineId: string }
): Promise<string | null> {
  if (canCertifyFunding(user)) return null;

  const { prisma } = await import("@/server/db/client");
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, companyId: user.companyId },
    select: { vertical: true },
  });
  // Solar is the only vertical whose gate asserts that money arrived.
  if (lead?.vertical !== "solar") return null;

  const stages = await prisma.pipelineStage.findMany({
    where: { pipelineId: target.pipelineId },
    select: { id: true, key: true, name: true, position: true, isLost: true },
  });
  if (!crossesFundingGate("solar", stages, target)) return null;

  // Already funded by somebody who may say so — the job can move on.
  const funded = await prisma.solarMilestone.count({
    where: { leadId, payee: "rep", sequence: 1, paidAt: { not: null } },
  });
  if (funded > 0) return null;

  return (
    "This stage is at or past M1 Funding, and this deal has no funding confirmed yet. " +
    "The funding desk records M1 first — ask an administrator or accounting."
  );
}
