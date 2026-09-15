import { prisma } from "@/server/db/client";
import { packagesByFolder } from "@/lib/deal-folders";
import type { StageMoveVia } from "@/lib/stage-history";
import {
  CONTRACT_FOLDER_KEY,
  CONTRACT_MIME_TYPE,
  CONTRACT_SIGNED_MILESTONE,
  SIGNED_LENDER_CONTRACT,
  SOLAR_CONTRACT_TEMPLATE_TYPE,
  NO_EVIDENCE,
  contractSignedMet,
  contractSignedMissing,
  crossesContractSigned,
  type ContractSignedEvidence,
} from "@/lib/contract-signed";
import { recordStageEntry } from "./stage-history";

/**
 * The server half of the Contract Signed rule — see lib/contract-signed.ts for
 * the rule itself.
 *
 * NOT a "use server" module, deliberately: every export here takes a
 * `companyId`, and exported from a server-action file each one would be a
 * public endpoint that trusts the caller to say which company it is. Callers
 * pass the id they resolved from the session (or, on the public signing paths,
 * from the row the token unlocked).
 *
 * ENFORCED AT EVERY WRITE THAT CAN MOVE A DEAL: the board and the deal page
 * (`moveLeadStage`), the lead form and its quick edits (`manage.ts`), the
 * website intake, and automations (`move_stage`). There is no override. A deal
 * whose paperwork is real gets there by filing the paperwork, which advances it
 * on its own — see `advanceToContractSignedIfReady`.
 */

/** What is on file for this deal, read fresh. */
export async function readContractSignedEvidence(
  companyId: string,
  leadId: string,
): Promise<ContractSignedEvidence> {
  const [proposal, packages, file] = await Promise.all([
    prisma.solarProposal.findFirst({
      where: { companyId, leadId, signedAt: { not: null } },
      select: { id: true },
    }),
    // COMPLETED — every signer signed and the certificate issued — and from a
    // template somebody classified as THE solar contract. A package still out
    // for signature, or a completed utility authorisation or permit form, is
    // not a contract however it was routed.
    prisma.documentPackage.findMany({
      where: {
        companyId,
        leadId,
        status: "completed",
        template: { type: SOLAR_CONTRACT_TEMPLATE_TYPE },
      },
      select: { folderKey: true },
    }),
    // An uploaded file counts only when a person allowed to edit files has
    // MARKED it as the lender's signed contract, it is a PDF, and it sits in the
    // Contract folder. Being in the folder is not evidence: a utility bill, a
    // photo, a generated-but-unsigned document or the proposal's own PDF can all
    // be filed there. The countersigned PDF of an e-signature package is counted
    // through its package above, never as a loose file.
    prisma.fileAsset.findFirst({
      where: {
        companyId,
        leadId,
        category: CONTRACT_FOLDER_KEY,
        documentType: SIGNED_LENDER_CONTRACT,
        mimeType: CONTRACT_MIME_TYPE,
      },
      select: { id: true },
    }),
  ]);
  return {
    signedProposal: !!proposal,
    // The folder a package is SHOWN in, by the one rule the folder grid uses:
    // no destination, or one this vertical does not know, means Contract.
    contractPackage: (packagesByFolder("solar", packages).get(CONTRACT_FOLDER_KEY)?.length ?? 0) > 0,
    contractFile: !!file,
  };
}

/**
 * May this deal move into this stage? The sentence to refuse with, or null.
 *
 * `lead.id` is null for a deal that does not exist yet (the create form): it
 * has no documents, so it can never start at or past Contract Signed.
 */
export async function contractSignedMoveError(args: {
  companyId: string;
  lead: { id: string | null; vertical: string; stageId: string | null };
  targetStageId: string;
}): Promise<string | null> {
  // Roofing has no such milestone; its stages are untouched by this rule.
  if (args.lead.vertical !== "solar") return null;

  const target = await prisma.pipelineStage.findFirst({
    where: { id: args.targetStageId, pipeline: { companyId: args.companyId } },
    select: { id: true, position: true, isLost: true, pipelineId: true },
  });
  // An unknown stage is the caller's to refuse; this rule has nothing to add.
  if (!target) return null;

  const stages = await prisma.pipelineStage.findMany({
    where: { pipelineId: target.pipelineId },
    select: { id: true, position: true, isLost: true, milestone: true },
  });
  const from = args.lead.stageId ? (stages.find((s) => s.id === args.lead.stageId) ?? null) : null;
  if (!crossesContractSigned(stages, from, target)) return null;

  const evidence = args.lead.id
    ? await readContractSignedEvidence(args.companyId, args.lead.id)
    : NO_EVIDENCE;
  return contractSignedMissing(evidence);
}

/**
 * The stage a lead form should actually write, given the Contract Signed rule.
 *
 * The lead forms re-derive the stage from the appointment date
 * (`resolveStageForAppointment`) as well as taking one the user picked, so two
 * different things can propose a move:
 *
 *  - a stage the USER CHOSE that crosses the line is refused with the reason —
 *    they asked for it and need to know why not;
 *  - an AUTOMATIC re-stage that would cross it is simply not applied, and the
 *    deal stays where it was. Booking an appointment must never fail a save,
 *    and must never carry a deal over Contract Signed either.
 *
 * `fallbackStageId` is where a NEW deal goes when its automatic stage is not
 * allowed — the pipeline's first stage — since it has nowhere to "stay".
 */
export async function guardedStageId(args: {
  companyId: string;
  lead: { id: string | null; vertical: string; stageId: string | null };
  resolvedStageId: string | null;
  explicitStageId: string | null;
  fallbackStageId?: string | null;
}): Promise<{ ok: true; stageId: string | null } | { ok: false; error: string }> {
  const { resolvedStageId, explicitStageId, lead } = args;
  if (!resolvedStageId || resolvedStageId === lead.stageId) return { ok: true, stageId: resolvedStageId };

  const check = (targetStageId: string) =>
    contractSignedMoveError({ companyId: args.companyId, lead, targetStageId });

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

/**
 * RE-EVALUATE, AND ADVANCE WHEN BOTH DOCUMENTS ARE ON FILE.
 *
 * Called whenever one of the two documents arrives — the customer signing the
 * proposal, an e-signature contract completing, a contract filed into the
 * Contract folder — so the order they arrive in does not matter and nobody has
 * to remember to move the card.
 *
 * Only ever FORWARDS, and only from before the line: a deal already at or past
 * Contract Signed is left alone, and a CANCELLED deal is never revived by
 * paperwork arriving late.
 *
 * Race-safe: the move is conditional on the stage the deal was read in, so two
 * documents landing in the same second advance it once.
 *
 * Best-effort and never throws. Every caller is committing something more
 * important — a customer's signature, a filed contract — that must not fail
 * because the pipeline could not be updated; the rule is re-checked the next
 * time either document changes, and the move can be made by hand once both are
 * on file.
 */
export async function advanceToContractSignedIfReady(args: {
  companyId: string;
  leadId: string;
  via: StageMoveVia;
}): Promise<{ advanced: boolean }> {
  const { companyId, leadId } = args;
  try {
    const lead = await prisma.lead.findFirst({
      where: { id: leadId, companyId },
      select: {
        vertical: true,
        pipelineId: true,
        stageId: true,
        stage: { select: { position: true, isLost: true } },
      },
    });
    if (!lead || lead.vertical !== "solar" || !lead.pipelineId) return { advanced: false };
    if (lead.stage?.isLost) return { advanced: false };

    const stage = await prisma.pipelineStage.findFirst({
      where: { pipelineId: lead.pipelineId, milestone: CONTRACT_SIGNED_MILESTONE, isLost: false },
      select: { id: true, name: true, position: true, defaultBlocker: true, stageType: true },
    });
    if (!stage) return { advanced: false };
    if (lead.stage && lead.stage.position >= stage.position) return { advanced: false };

    if (!contractSignedMet(await readContractSignedEvidence(companyId, leadId))) {
      return { advanced: false };
    }

    const now = new Date();
    const moved = await prisma.lead.updateMany({
      where: { id: leadId, companyId, stageId: lead.stageId },
      data: {
        stageId: stage.id,
        stageChangedAt: now,
        stageAlertLevel: 0,
        stageOverdue: false,
        blockedBy: stage.defaultBlocker,
        // A document arriving IS a touch — the same stamp signing always made.
        lastTouchAt: now,
        lastChaseAlertAt: null,
        ...(stage.stageType === "internally_owned" ? { blockerNote: null } : {}),
      },
    });
    if (moved.count !== 1) return { advanced: false };

    await recordStageEntry({ leadId, stageId: stage.id, stage, via: args.via });
    await prisma.activityLog.create({
      data: {
        companyId,
        type: "stage_change",
        message: `Moved to ${stage.name}: the signed proposal and the completed contract are both on file`,
        leadId,
      },
    });
    return { advanced: true };
  } catch (err) {
    console.warn(`[contract-signed] could not re-evaluate deal ${leadId}`, err);
    return { advanced: false };
  }
}
