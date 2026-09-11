"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { leadAccessible } from "@/server/rbac/lead-access";
import { mintWitness } from "./witness";

const fail = (error: string) => ({ ok: false as const, error });

/**
 * "Sign on this device" — the rep opens the proposal on their own phone or
 * tablet and hands it to the homeowner at the table.
 *
 * The same pattern as the e-sign module's in-person button, and the same reason
 * for it: half of these deals are closed in a living room, and telling a
 * customer sitting in front of you to go and find your email is how a signature
 * becomes a follow-up call.
 *
 * WHAT IT RETURNS IS THE CUSTOMER'S OWN LINK, not a rep-only view. The document
 * that gets signed has to be the document that was sent — one page, one code
 * path, one thing to keep correct. What the rep's press adds is the WITNESS
 * token in the URL: minted here, signed by this server, naming this proposal
 * and this user, and the only way a signature can be recorded as taken in
 * person. See ./witness.
 *
 * The link is minted if it does not exist yet, exactly as sending does — a rep
 * who built the proposal at the table has not emailed it, and refusing to let
 * the customer sign until they do would be ceremony for its own sake. The token
 * is kept once minted, so a proposal signed in person and re-sent afterwards
 * still resolves to the same URL the customer already has.
 */
export async function openInPersonProposalSigningAction(proposalId: string) {
  const user = await requireUser();
  if (!can(user, "update", "Proposal")) return fail("Not allowed.");

  const p = await prisma.solarProposal.findFirst({
    where: { companyId: user.companyId, id: proposalId },
    select: {
      id: true, leadId: true, version: true, publicToken: true,
      supersededAt: true, signedAt: true,
    },
  });
  if (!p) return fail("Proposal not found.");
  // Scoped to the caller's own deals, not just their company: `p.leadId`
  // came out of an id the browser supplied. Same sentence as a missing
  // proposal, so the two cases stay indistinguishable from outside.
  if (!(await leadAccessible(user, p.leadId))) return fail("Proposal not found.");
  if (p.signedAt) return fail("This proposal has already been signed.");
  if (p.supersededAt) {
    return fail("This version has been replaced. Open the current one to sign it.");
  }

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  if (!appUrl) {
    // The rep's device is about to be handed to a customer. Sending it to a
    // relative path that resolves to nothing is worse than saying why not.
    return fail("NEXT_PUBLIC_APP_URL is not configured, so the signing link would be unreachable.");
  }

  const publicToken = p.publicToken ?? randomBytes(24).toString("base64url");

  await prisma.solarProposal.update({
    where: { id: p.id },
    data: {
      // The customer is about to look at it, so it has been sent in every sense
      // that matters. Left alone once it is further along than that: a proposal
      // already marked viewed must not be walked backwards by opening it again.
      ...(p.publicToken ? {} : { status: "sent", sentAt: new Date() }),
      publicToken,
      events: {
        create: {
          type: "in_person_opened",
          actorId: user.userId,
          actorName: user.fullName,
          detail: "opened on a representative's device for in-person signing",
        },
      },
    },
  });

  revalidatePath(`/portal/leads/${p.leadId}/solar-proposal`);

  const witness = mintWitness(p.id, user.userId);
  return {
    ok: true as const,
    url: `${appUrl}/proposal/${publicToken}?w=${encodeURIComponent(witness)}#accept`,
  };
}
