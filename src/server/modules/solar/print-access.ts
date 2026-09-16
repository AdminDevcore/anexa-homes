import { prisma } from "@/server/db/client";
import { runUnscoped } from "@/server/vertical/context";
import { readPrintSignature } from "./print-signature";
import { withCustomerContact, readProposalSnapshot } from "@/lib/solar-proposal";

/**
 * Resolve the one proposal a print signature names, or null.
 *
 * The single gate the whole print route family goes through. Note what it does
 * NOT check: `sentAt`, and the publicly-readable statuses. That is the entire
 * reason this door exists — approving a version records which one was sold, and
 * a version is routinely approved before it is sent, or instead of ever being
 * sent. Applying the customer-facing gate here would mean the copy filed on the
 * deal could only ever be of a proposal already in a homeowner's inbox.
 *
 * What replaces that gate is the signature itself: minted only by this server,
 * only for a proposal being rendered, and dead five minutes later.
 *
 * Unscoped for the same reason the token routes are — the row's workspace is
 * not known until it has been read.
 */
export async function proposalForPrint(sig: string) {
  const id = readPrintSignature(sig);
  if (!id) return null;

  const proposal = await runUnscoped(
    "proposal print render: resolve the proposal by its print signature",
    () =>
      prisma.solarProposal.findUnique({
        where: { id },
        select: {
          id: true, companyId: true, leadId: true, version: true,
          snapshot: true, signedAt: true, supersededAt: true,
          showComparison: true, showPaymentOptions: true,
          lead: { select: { vertical: true, email: true, phone: true } },
        },
      })
  );
  if (!proposal) return null;
  return {
    ...proposal,
    // The filed PDF is meant to be the proposal as the customer sees it, and
    // the customer's copy fills the contact block on pre-change documents. The
    // two renders would otherwise disagree about the cover.
    snapshot: withCustomerContact(
      readProposalSnapshot(proposal.snapshot)!,
      proposal.lead,
    ),
  };
}
