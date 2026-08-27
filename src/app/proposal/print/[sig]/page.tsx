import { notFound } from "next/navigation";
import { proposalForPrint } from "@/server/modules/solar/print-access";
import { SolarProposalView } from "@/components/proposal/solar-proposal-view";
import { prisma } from "@/server/db/client";
import { objectExists } from "@/server/storage";
import { runUnscoped } from "@/server/vertical/context";
import { brandingForRecord } from "@/server/branding/resolve";

export const dynamic = "force-dynamic";
export const metadata = { title: "Proposal", robots: { index: false, follow: false } };

/**
 * The proposal as a sheet of paper — the render the PDF is taken from.
 *
 * A third door onto a document that already had two, and it exists because
 * neither of those can be walked through by this application's own headless
 * browser. See server/modules/solar/print-signature.ts.
 *
 * Deliberately the SAME component the customer gets, not a print-specific
 * layout. The filed copy is supposed to be the proposal that was sold, and a
 * second document maintained alongside the first stops being that the first
 * time either one changes. Everything paper needs is already in globals.css —
 * the zero page margin that keeps Chrome's URL furniture off a customer's
 * document, the explicit `8.5in 11in` page box, `print-color-adjust` on the
 * dark chapters — and it has been debugged against this exact document.
 *
 * `previewMode` because acceptance must be dead here: a PDF cannot be clicked,
 * and a live accept button rendered into one is at best furniture and at worst
 * a token in a file that gets emailed around.
 */
export default async function ProposalPrintPage({
  params,
}: {
  params: Promise<{ sig: string }>;
}) {
  const { sig } = await params;
  const proposal = await proposalForPrint(sig);
  if (!proposal) notFound();

  const layoutImageUrl = proposal.snapshot.layout
    ? await layoutUrlIfAvailable(sig, proposal.snapshot.layout.fileId, proposal.leadId)
    : null;

  // Branded by the DEAL, exactly as the customer's copy is. The renderer has no
  // session and therefore no workspace cookie to be misled by.
  const branding = await brandingForRecord(proposal.companyId, proposal.lead.vertical);

  return (
    <SolarProposalView
      snapshot={proposal.snapshot}
      showComparison={proposal.showComparison}
      showPaymentOptions={proposal.showPaymentOptions}
      // No token: acceptance is disabled, so there is nothing for one to
      // authorize, and it stays out of a file that may be forwarded.
      token=""
      previewMode
      alreadySigned={!!proposal.signedAt}
      // Not passed as superseded even when it is. A version approved after
      // being superseded is precisely the case this feature exists for, and
      // stamping "this is out of date" across the copy of what was sold would
      // be the document contradicting the decision that filed it.
      superseded={false}
      layoutImageUrl={layoutImageUrl}
      siteImageBase={proposal.snapshot.site ? `/proposal/print/${sig}/site-image` : null}
      accentColor={branding.accentColor}
    />
  );
}

/** Signature-scoped layout URL, or null when the drawing cannot be served. */
async function layoutUrlIfAvailable(sig: string, fileId: string, leadId: string) {
  const file = await runUnscoped(
    "proposal print: confirm the layout drawing is still fetchable",
    () =>
      prisma.fileAsset.findFirst({
        where: { id: fileId, leadId, kind: "photo" },
        select: { storageKey: true },
      })
  );
  if (!file) return null;
  return (await objectExists(file.storageKey)) ? `/proposal/print/${sig}/layout-image` : null;
}
