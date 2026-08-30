import { notFound } from "next/navigation";
import { proposalForPrint } from "@/server/modules/solar/print-access";
import { certificateFor } from "@/server/modules/solar/proposal-signature";
import { ParticipateSubmissionSummary } from "@/components/proposal/solar/submission-summary";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Lender submission summary",
  robots: { index: false, follow: false },
};

/**
 * The funder's processing document, behind the same door the PDF render uses.
 *
 * A PRINT SIGNATURE, not a share token and not a session. The reasoning is
 * identical to `/proposal/print/[sig]` — this page has to be reachable by a
 * headless browser with no cookie, and it must unlock exactly one proposal and
 * nothing else — with one addition that matters here: a share token is the
 * CUSTOMER'S key, and the customer is not the audience for this document.
 * Minting is done by `/api/solar/proposals/[id]/submission`, which checks the
 * session, the company and the signature before it hands one out.
 *
 * Deliberately NOT the proposal component. See ParticipateSubmissionSummary:
 * the one thing this file must never become is a second document that looks
 * like the one somebody signed.
 */
export default async function ProposalSubmissionPage({
  params,
}: {
  params: Promise<{ sig: string }>;
}) {
  const { sig } = await params;
  const proposal = await proposalForPrint(sig);
  if (!proposal) notFound();

  return (
    <ParticipateSubmissionSummary
      snapshot={proposal.snapshot}
      version={proposal.version}
      reference={proposal.snapshot.reference}
      certificate={await certificateFor(proposal.id)}
    />
  );
}
