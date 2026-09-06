"use server";

import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { revalidatePath } from "next/cache";
import { lenderReference } from "./lender-submit";

/**
 * ABANDONING A REFERENCE THE LENDER HAS BROKEN.
 *
 * A partner API is idempotent on the reference we send it, and that is not a
 * convenience — it is what stops a second tap opening a second credit file in
 * a household's name. The cost of the guarantee is that a reference the LENDER
 * has corrupted stays corrupted: there is no way to ask for a clean start.
 *
 * On 2026-09-05 that bill came due. Amos accepted a submission for the first
 * time — it had cleared authentication and their approved-vendor check — then
 * answered `500 internal_error` and did so again for every retry of the same
 * reference: six attempts across four materially different payloads, one
 * error. Their own message said the request was idempotent and to try again.
 * Trying again was the one thing that could not work, and nothing on our side
 * could reach past it, because the reference is the design id and the design
 * id does not change.
 *
 * This is the door out, and it is deliberately narrow.
 *
 * WHY IT IS NOT AUTOMATIC. A 500 is ambiguous by construction: the lender
 * crashed somewhere between receiving the application and finishing it, and
 * their API exposes no way to read back what survived — `/applications`
 * advertises `OPTIONS, POST` and nothing else. So a retry under a new
 * reference might be the only way through, or it might file a SECOND
 * application for a customer who already has one. Nobody can tell from here.
 * A person who has looked at the lender's own portal can, and that is who this
 * is for.
 */

export type ResetKeyResult =
  | { ok: true; reference: string; attempt: number }
  | { ok: false; error: string };

export async function resetLenderSubmissionKeyAction(proposalId: string): Promise<ResetKeyResult> {
  const user = await requireUser();
  // The same bar as sending: whoever may submit a deal may abandon its
  // reference, and nobody else. A customer holding a share token cannot reach
  // this at all — there is no public door onto it, on purpose.
  if (!can(user, "update", "Lead")) return { ok: false, error: "Not allowed." };

  // Keyed on the proposal, like the rep's submit door beside it, and scoped to
  // the caller's own company so an id from elsewhere finds nothing.
  const proposal = await prisma.solarProposal.findFirst({
    where: { id: proposalId, companyId: user.companyId },
    select: { leadId: true },
  });
  if (!proposal) return { ok: false, error: "Proposal not found." };
  const leadId = proposal.leadId;

  const design = await prisma.solarDesign.findFirst({
    where: { leadId, companyId: user.companyId },
    select: { id: true, lenderSubmissionAttempt: true, lenderId: true },
  });
  if (!design) return { ok: false, error: "Deal not found." };
  if (!design.lenderId) return { ok: false, error: "This deal has no lender selected." };

  /**
   * THE GUARD THIS WHOLE MODULE EXISTS AROUND.
   *
   * A reference that has already produced an application is not broken, and
   * giving the deal a new one would submit the household a second time. The
   * event is written by `qualifyOnProposal` the moment the lender hands back a
   * reference number, so it is the same record the office reads on the deal.
   */
  const submitted = await prisma.solarProposalEvent.findFirst({
    where: { type: "qualify_submitted", proposal: { leadId, companyId: user.companyId } },
    select: { id: true },
  });
  if (submitted) {
    return {
      ok: false,
      error:
        "This deal has already been submitted successfully. Starting a new reference would file a second application in the customer's name — check the lender's portal, or ask them to reopen the one you have.",
    };
  }

  /**
   * A ceiling, because a control that can be pressed forever will be. Four
   * abandoned references means the lender is not going to accept this deal and
   * somebody needs to talk to them rather than keep pressing.
   */
  if (design.lenderSubmissionAttempt >= 4) {
    return {
      ok: false,
      error:
        "This deal has been given four fresh references already and the lender has refused every one. Contact the lender's support with the references below rather than starting another.",
    };
  }

  const attempt = design.lenderSubmissionAttempt + 1;
  await prisma.solarDesign.update({
    where: { id: design.id },
    data: { lenderSubmissionAttempt: attempt },
  });

  const reference = lenderReference(design.id, attempt);

  /**
   * ON THE DEAL, NOT ONLY IN A LOG. Abandoning a reference is the kind of thing
   * somebody has to be able to account for six months later — both to explain a
   * duplicate if one appears, and to give the lender's support desk the list of
   * references to look under.
   */
  await prisma.activityLog.create({
    data: {
      companyId: user.companyId,
      type: "system",
      message: `Started a new lender reference for this deal (attempt ${attempt}) — ${reference}. The previous reference was abandoned after the lender failed to accept it.`,
      leadId,
    },
  });

  revalidatePath(`/portal/leads/${leadId}/solar-proposal/preview`);
  return { ok: true, reference, attempt };
}
