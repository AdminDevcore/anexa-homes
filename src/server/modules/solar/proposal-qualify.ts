import { prisma } from "@/server/db/client";
import { runInVertical, asActiveVertical } from "@/server/vertical/context";
import type { Vertical } from "@prisma/client";
import type { QualifyOffer } from "@/lib/proposal-qualify";
import { readLenderSubmission, submitDealToLender } from "./lender-submit";

/**
 * The homeowner's Qualify button, and what stands behind it.
 *
 * This used to be a rep-facing "Send to <lender>" card on the Financing step
 * of the builder, which was the wrong place for it twice over. A submission is
 * something the household does — the deal is priced, they have read the
 * document, and the next thing that happens is an application in their name.
 * And every partner issues its own API key, so "send to Amos" was never a
 * button about Amos: it is the deal's own lender, whichever one that is.
 *
 * So the capability moved onto the one control that was already the call to
 * action, on the one page the customer actually reads.
 */

/**
 * What the document is allowed to offer, resolved at RENDER on the server.
 *
 * Not fetched from the browser on mount, for two reasons. The customer's copy
 * would flash a plain link and then swap it for a different button under their
 * thumb; and an endpoint that answers "is this deal submittable, and why not"
 * to anyone holding a share token would hand a stranger the deal's blockers.
 * Rendering it means the answer is decided where the authorization already is.
 *
 * `audience` is the whole of the difference between the two doors:
 *   "customer" — only the ready case survives. A deal that cannot be submitted
 *                shows the ordinary application link and says nothing. Our
 *                preflight strings are written for a rep ("the customer has no
 *                phone number on file") and must never reach the customer.
 *   "rep"      — the portal preview, which is authenticated, and where the
 *                blockers are exactly what somebody needs to see.
 */
export async function readProposalQualifyOffer(
  proposal: { leadId: string; companyId: string; lead: { vertical: Vertical } },
  audience: "customer" | "rep",
): Promise<QualifyOffer | null> {
  const status = await runInVertical(asActiveVertical(proposal.lead.vertical), () =>
    readLenderSubmission(proposal.leadId, proposal.companyId),
  );

  if (status.mode === "link") return null;
  if (status.ready) {
    return { state: "ready", lenderName: status.lenderName, summary: status.summary };
  }
  if (audience === "customer") return null;
  return { state: "blocked", lenderName: status.lenderName, problems: status.problems };
}

export type QualifyResult =
  | { ok: true; lenderName: string; referenceNumber: string; customerUrl: string | null; sentTo: string }
  /**
   * `retryable` is the difference between "the lender was briefly unreachable"
   * and "this deal cannot be sent" — and the document has to act on it, not
   * just say it. A message reading "please try again in a moment" beside a
   * control that can no longer try is worse than no message: the household
   * presses it, is handed the lender's blank form, and nobody finds out the
   * automatic route was never retried.
   *
   * The KIND itself never crosses: "config" tells a customer their rep has not
   * finished setting the company up.
   */
  | { ok: false; error: string; retryable: boolean };

/**
 * Start the application.
 *
 * The proposal has already been resolved from its share token by the caller —
 * the token IS the authorization here, exactly as it is for signing. Every
 * fact that reaches the lender is re-read from the deal on the server:
 * which lender, which key, which amount, which term. The browser contributes
 * one thing, and it is the one thing we do not store.
 */
export async function qualifyOnProposal(
  proposal: {
    id: string;
    leadId: string;
    companyId: string;
    version: number;
    supersededAt: Date | null;
    lead: { vertical: Vertical };
  },
  input: { ownerOccupied: boolean; ip: string | null },
): Promise<QualifyResult> {
  // A superseded document quotes a price the deal is no longer written at.
  // Submitting from one would put a figure in front of an underwriter that
  // nobody in this company would stand behind.
  if (proposal.supersededAt) {
    return {
      ok: false,
      error:
        "This proposal has been replaced by a newer version. Please open the most recent one your representative sent you.",
      // Nothing they do on THIS document can change that.
      retryable: false,
    };
  }

  return runInVertical(asActiveVertical(proposal.lead.vertical), async () => {
    const result = await submitDealToLender({
      leadId: proposal.leadId,
      companyId: proposal.companyId,
      ownerOccupied: input.ownerOccupied,
      // The household is holding the device the link has to come back to.
      delivery: "in_person",
      // Only reached on a deal with no assigned rep. The lender takes a typed
      // name; "Anexa Homes" is truthful and is not somebody else's login.
      fallbackRepName: "Anexa Homes",
    });

    if (!result.ok) {
      // THE OFFICE HEARS ABOUT THIS. A homeowner who tried to apply and could
      // not is the single most time-critical thing that can happen on a solar
      // deal, and the reason is on the deal rather than in a log nobody reads.
      await record(proposal, "qualify_failed", input.ip, [result.error, ...(result.problems ?? [])].join(" "));
      return {
        ok: false,
        error: customerFacing(result.kind),
        retryable: result.kind === "transient",
      };
    }

    await record(
      proposal,
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
 * What a homeowner is told when it does not work.
 *
 * Never our preflight strings, and never the lender's. "The selected panel has
 * no manufacturer" is a sentence for a rep; in front of a customer it is an
 * admission that the company sent them a document it had not finished. Every
 * failure reads the same way to them, and the document falls back to the
 * lender's ordinary application link so they still have a way through.
 */
function customerFacing(kind: "deal" | "config" | "transient"): string {
  return kind === "transient"
    ? "We could not reach the lender just then. Please try again in a moment."
    : "We could not start your application automatically. Use the application link below, or contact your representative.";
}

/** The event on the proposal, and the line the office reads on the deal. */
async function record(
  proposal: { id: string; leadId: string; companyId: string; version: number },
  type: "qualify_submitted" | "qualify_failed",
  ip: string | null,
  detail: string,
) {
  try {
    await prisma.solarProposalEvent.create({
      data: { proposalId: proposal.id, type, ip, actorName: "Customer", detail },
    });
    await prisma.activityLog.create({
      data: {
        companyId: proposal.companyId,
        type: "system",
        message:
          type === "qualify_submitted"
            ? `Customer started a credit application from proposal v${proposal.version} — ${detail}`
            : `Customer tried to apply from proposal v${proposal.version} and it failed — ${detail}`,
        leadId: proposal.leadId,
      },
    });
  } catch (e) {
    // Never let the bookkeeping cost the customer their application: they are
    // already through to the lender by the time this runs.
    console.error("[proposal-qualify] could not record the attempt", e);
  }
}
