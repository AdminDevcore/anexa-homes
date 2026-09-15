import type { AccessUser } from "@/server/rbac/guards";
import { fundingGateError } from "@/server/modules/payroll/funding-authority";
import { contractSignedMoveError } from "./contract-signed";

/**
 * THE ONE QUESTION EVERY STAGE MOVE ASKS: may this deal go into this stage?
 *
 * Two rules answer it. Each lives beside its reasons:
 *
 *   M1 FUNDING (payroll/funding-authority.ts) — a deal goes at or past the
 *     funding gate only if the person moving it may certify funding, or funding
 *     is already certified.
 *   CONTRACT SIGNED (pipeline/contract-signed.ts) — a deal goes at or past the
 *     sale only with the signed proposal and the completed contract on file.
 *
 * The funding rule used to be asked by the board's move action alone, so every
 * other writer of a deal's stage walked around it. Now every writer asks here:
 * the board and the deal page, cancellation, the lead form and its quick edit,
 * website intake, the canvassing map, and automations. The paperwork-driven
 * advance to Contract Signed applies the funding rule directly, because it
 * sits inside the Contract Signed module and is that rule's own evidence check.
 * `src/lib/__tests__/stage-moves-guarded.test.ts` fails the build when a new
 * writer skips this module.
 *
 * NOT a "use server" module: it takes a company and an actor, which only a
 * server action that resolved them from the session may supply.
 *
 * ── THE ACTOR ───────────────────────────────────────────────────────────────
 * The signed-in person making the move, or null when nobody is: a website
 * lead, an automation rule. Nobody cannot certify funding — a rule an admin
 * wrote runs on whatever any rep's action triggered, so it carries no one's
 * authority.
 */

export type StageMove = {
  companyId: string;
  actor: AccessUser | null;
  /** `id` is null for a deal that does not exist yet (the create forms). */
  lead: { id: string | null; vertical: string; stageId: string | null };
  targetStageId: string;
};

/** The sentence to refuse this move with, or null to allow it. */
export async function stageMoveError(move: StageMove): Promise<string | null> {
  const funding = await fundingGateError(move);
  if (funding) return funding;
  return contractSignedMoveError(move);
}

/**
 * The stage a lead form should actually write, given both rules.
 *
 * The lead forms re-derive the stage from the appointment date
 * (`resolveStageForAppointment`) as well as taking one the user picked, so two
 * different things can propose a move:
 *
 *  - a stage the USER CHOSE that crosses a line is refused with the reason —
 *    they asked for it and need to know why not;
 *  - an AUTOMATIC re-stage that would cross one is simply not applied, and the
 *    deal stays where it was. Booking an appointment must never fail a save,
 *    and must never carry a deal over Contract Signed or M1 Funding either.
 *
 * `fallbackStageId` is where a NEW deal goes when its automatic stage is not
 * allowed — the pipeline's first stage — since it has nowhere to "stay".
 */
export async function guardedStageId(args: {
  companyId: string;
  actor: AccessUser | null;
  lead: StageMove["lead"];
  resolvedStageId: string | null;
  explicitStageId: string | null;
  fallbackStageId?: string | null;
}): Promise<{ ok: true; stageId: string | null } | { ok: false; error: string }> {
  const { resolvedStageId, explicitStageId, lead } = args;
  if (!resolvedStageId || resolvedStageId === lead.stageId) return { ok: true, stageId: resolvedStageId };

  const check = (targetStageId: string) =>
    stageMoveError({ companyId: args.companyId, actor: args.actor, lead, targetStageId });

  const err = await check(resolvedStageId);
  if (!err) return { ok: true, stageId: resolvedStageId };
  if (explicitStageId && resolvedStageId === explicitStageId) return { ok: false, error: err };

  // The automatic re-stage is refused; honour what the user picked, if anything.
  if (explicitStageId && explicitStageId !== lead.stageId) {
    const explicitErr = await check(explicitStageId);
    return explicitErr ? { ok: false, error: explicitErr } : { ok: true, stageId: explicitStageId };
  }
  return {
    ok: true,
    stageId: args.fallbackStageId !== undefined ? args.fallbackStageId : lead.stageId,
  };
}
