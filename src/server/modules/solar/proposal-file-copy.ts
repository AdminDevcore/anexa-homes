import { nanoid } from "nanoid";
import { prisma } from "@/server/db/client";
import { putObject } from "@/server/storage";
import { renderProposalPdf } from "./proposal-pdf";
import { removeFiledCopies } from "./proposal-approval";

/**
 * Rendering the approved version and filing it on the deal.
 *
 * ITS OWN MODULE, and deliberately imported by exactly one route. It pulls in
 * `@/sparticuz/chromium` — a 66MB browser — and Next traces that into every
 * serverless function whose import graph reaches it. When this lived beside the
 * approval logic, the two pages that host the approve button each shipped their
 * own copy of Chrome. Keep this import graph narrow.
 */

/** The folder key on a solar deal. Load-bearing — see lib/deal-folders.ts. */
const PROPOSAL_CATEGORY = "proposal";

/**
 * Render the approved version and put it in the deal's Proposal folder.
 *
 * Also the retry path: a version already approved whose render failed calls
 * straight back in here. Any copy already filed for this proposal is replaced,
 * so a retry cannot leave two PDFs of the same version in one folder.
 *
 * Never throws. The caller's question is always "is there a copy on the deal",
 * and the honest answers are "yes, this one" and "no, because this went wrong".
 */
export async function fileApprovedCopy(
  actor: { companyId: string; userId: string },
  proposal: { id: string; leadId: string; version: number },
): Promise<{ fileId: string | null; error: string | null }> {
  let pdf: Buffer;
  try {
    pdf = await renderProposalPdf(proposal.id);
  } catch (err) {
    return { fileId: null, error: reason(err) };
  }

  try {
    const lead = await prisma.lead.findFirst({
      where: { id: proposal.leadId, companyId: actor.companyId },
      select: { firstName: true, lastName: true },
    });
    const customer = [lead?.firstName, lead?.lastName].filter(Boolean).join(" ").trim();
    const name = `Proposal v${proposal.version}${customer ? ` — ${customer}` : ""}.pdf`;

    const key = `companies/${actor.companyId}/solar-proposals/${nanoid()}.pdf`;
    await putObject(key, pdf);

    // Replace rather than accumulate. The link that says which file belongs to
    // which version is `approvedFileId` on the proposal, so the copy to drop is
    // whatever this row points at right now — no second foreign key on
    // FileAsset, and no guessing by category, which would sweep up a PDF a rep
    // dropped into the same folder by hand.
    const previous = await prisma.solarProposal.findFirst({
      where: { id: proposal.id, companyId: actor.companyId },
      select: { approvedFileId: true },
    });

    const asset = await prisma.fileAsset.create({
      data: {
        companyId: actor.companyId,
        kind: "document",
        name,
        storageKey: key,
        mimeType: "application/pdf",
        size: pdf.length,
        category: PROPOSAL_CATEGORY,
        leadId: proposal.leadId,
        uploadedById: actor.userId,
      },
      select: { id: true },
    });

    if (previous?.approvedFileId) {
      await removeFiledCopies(actor.companyId, [previous.approvedFileId]);
    }

    await prisma.solarProposal.update({
      where: { id: proposal.id },
      data: { approvedFileId: asset.id },
    });

    return { fileId: asset.id, error: null };
  } catch (err) {
    return { fileId: null, error: reason(err) };
  }
}

function reason(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.slice(0, 300);
}
