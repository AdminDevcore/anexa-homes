import { prisma } from "@/server/db/client";
import { runInVertical, asActiveVertical } from "@/server/vertical/context";
import type { Vertical } from "@prisma/client";
import { submitDealToLender } from "./lender-submit";
import type { QualifyResult } from "./proposal-qualify";

/**
 * The SECOND door onto a credit application: the rep's, from inside the portal.
 *
 * NOT a "use server" module — see the note in lender-submit.ts. This is the
 * work; `proposal-qualify-rep-action.ts` is the endpoint that authenticates a
 * session, resolves the company from it and hands over.
 *
 * WHY THERE IS A SECOND DOOR AT ALL. Qualify was deliberately made the
 * household's own act, on the household's own copy, and that has not changed —
 * `proposal-qualify.ts` is still the door the customer's link uses, and its
 * authorization is still the share token. But the portal preview rendered the
 * SAME button dead, and the only live one in the building was behind a share
 * link. So a rep sitting at the table with a signed document in front of them,
 * or an office starting the application after the fact, had nowhere to press.
 * "Applying is the household's act" is a statement about whose details go and
 * whose consent is captured — both still true here, and neither of them is a
 * statement about which screen the deal is submitted from.
 *
 * THREE THINGS DIFFER FROM THE CUSTOMER'S DOOR, and they are the whole file:
 *
 *  1. The authorization is a SESSION, not a token. Resolved by the caller.
 *  2. The failure is told STRAIGHT. `customerFacing()` exists because "the
 *     selected panel has no manufacturer" is an admission in front of a
 *     homeowner; in front of the rep who can go and fix it, it is the only
 *     useful sentence on the screen. The preflight problems come through.
 *  3. The attempt is recorded UNDER THE REP'S NAME. An office reading the deal
 *     has to be able to tell an application the household started from one a
 *     rep started for them — those are different facts about the same deal, and
 *     writing "Customer" against both would make the activity log lie.
 *
 * Everything else — which lender, which key, which amount, which term — is
 * re-read from the deal by `submitDealToLender`, exactly as before. And the
 * submission is still idempotent on the design id, so a rep pressing this after
 * the customer already pressed theirs returns the same application rather than
 * opening a second credit file.
 */

/** Who pressed it. A real session user, so there is always a name. */
export type RepActor = { fullName: string };

export async function qualifyOnProposalAsRep(
  proposal: {
    id: string;
    leadId: string;
    companyId: string;
    version: number;
    supersededAt: Date | null;
    lead: { vertical: Vertical };
  },
  actor: RepActor,
  input: { ownerOccupied: boolean; ip: string | null },
): Promise<QualifyResult> {
  // Same rule as the customer's door and for the same reason: a superseded
  // document quotes a price the deal is no longer written at. Said in the words
  // of somebody who can do something about it.
  if (proposal.supersededAt) {
    return {
      ok: false,
      error: `Proposal v${proposal.version} has been replaced by a newer version, so its price is not what this deal is written at any more. Open the current version and submit from there.`,
      retryable: false,
    };
  }

  return runInVertical(asActiveVertical(proposal.lead.vertical), async () => {
    const result = await submitDealToLender({
      leadId: proposal.leadId,
      companyId: proposal.companyId,
      ownerOccupied: input.ownerOccupied,
      // Whether the completion link comes back in the response — so the rep
      // can hand their own device over, which is the situation this door
      // exists for — is now THIS PARTNER'S rule, read off the lender row. The
      // lender emails and texts the household either way; there is no such
      // thing as a silent submission. See SolarSubmissionDelivery.
      //
      // Only reached on a deal with no assigned rep, and then the truthful
      // answer is the person who pressed the button.
      fallbackRepName: actor.fullName,
      // Who that is, as its own fact: a partner set to `submitter` wants this
      // name whether or not the deal has a rep of its own.
      submitterName: actor.fullName,
    });

    if (!result.ok) {
      const detail = [result.error, ...(result.problems ?? [])].join(" ");
      await record(proposal, actor, "qualify_failed", input.ip, detail);
      return { ok: false, error: detail, retryable: result.kind === "transient" };
    }

    await record(
      proposal,
      actor,
      "qualify_submitted",
      input.ip,
      `${result.lenderName} · reference ${result.referenceNumber}`,
    );

    return {
      ok: true,
      lenderName: result.lenderName,
      referenceNumber: result.referenceNumber,
      customerUrl: result.customerUrl,
      sentTo: result.sentTo,
    };
  });
}

/**
 * The event on the proposal, and the line the office reads on the deal.
 *
 * Deliberately not shared with `proposal-qualify.ts`'s copy: the only thing the
 * two have in common is the table they write to. Every word differs, because
 * "the customer applied" and "their rep applied for them" are different facts,
 * and a helper taking an actor name plus two message templates would be a
 * worse way of saying that than two short functions.
 */
async function record(
  proposal: { id: string; leadId: string; companyId: string; version: number },
  actor: RepActor,
  type: "qualify_submitted" | "qualify_failed",
  ip: string | null,
  detail: string,
) {
  try {
    await prisma.solarProposalEvent.create({
      data: { proposalId: proposal.id, type, ip, actorName: actor.fullName, detail },
    });
    await prisma.activityLog.create({
      data: {
        companyId: proposal.companyId,
        type: "system",
        message:
          type === "qualify_submitted"
            ? `${actor.fullName} started a credit application from proposal v${proposal.version} — ${detail}`
            : `${actor.fullName} tried to start a credit application from proposal v${proposal.version} and it failed — ${detail}`,
        leadId: proposal.leadId,
      },
    });
  } catch (e) {
    // Never let the bookkeeping cost the application: by the time this runs the
    // deal is already with the lender.
    console.error("[proposal-qualify-rep] could not record the attempt", e);
  }
}
