import { nanoid } from "nanoid";
import { prisma } from "@/server/db/client";
import { putObject } from "@/server/storage";
import { hasCreditSwitch } from "@/lib/solar-proposal";
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
 * ONE SIGNATURE, TWO DOCUMENTS.
 *
 * A proposal that earns federal credits has two honest readings of the same
 * deal, and the switch on the customer's page is what picks between them: the
 * payment at par, and the payment once the credits have been claimed and
 * applied. Both are what was sold. The household signs once — they sign the
 * proposal, not one scenario of it — and whether the credits are ever claimed
 * is a fact about somebody's tax return that the day of signing cannot settle.
 *
 * So the folder gets both, carrying the same signature and the same certificate,
 * because paper has no switch. The one at par is the larger figure and is named
 * so it can be told apart at a glance in a folder listing.
 *
 * A deal with nothing to claim files one copy, exactly as this always has.
 */
type Copy = {
  /** Which reading of the deal to render. */
  creditsApplied: boolean;
  /** How it is named in the folder. */
  name: string;
  /** Which column on the proposal row points at it. */
  column: "approvedFileId" | "approvedParFileId";
};

/**
 * Render the approved version and put it in the deal's Proposal folder.
 *
 * Also the retry path: a version already approved whose render failed calls
 * straight back in here. Any copy already filed for this proposal is replaced,
 * so a retry cannot leave two PDFs of the same version in one folder.
 *
 * BOTH RENDERS HAPPEN BEFORE ANYTHING IS WRITTEN. A pair that half-files is
 * worse than one that does not file at all: the folder would show the deal at
 * par with no sign that the other reading was ever meant to be there, and the
 * row would report success. Either both land or neither does.
 *
 * Never throws. The caller's question is always "is there a copy on the deal",
 * and the honest answers are "yes, this one" and "no, because this went wrong".
 */
export async function fileApprovedCopy(
  /**
   * `userId` is NULLABLE because the sweep that guarantees this happens is a
   * cron with no user behind it — see api/cron/file-signed-proposals. The same
   * reasoning as `ApprovalActor.userId`: inventing an uploader would put a name
   * against an act nobody performed, and `FileAsset.uploadedById` is nullable
   * for exactly this case.
   */
  actor: { companyId: string; userId: string | null },
  proposal: { id: string; leadId: string; version: number },
): Promise<{ fileId: string | null; error: string | null }> {
  let rendered: { copy: Copy; pdf: Buffer }[];
  try {
    const lead = await prisma.lead.findFirst({
      where: { id: proposal.leadId, companyId: actor.companyId },
      select: { firstName: true, lastName: true },
    });
    const customer = [lead?.firstName, lead?.lastName].filter(Boolean).join(" ").trim();
    const suffix = `v${proposal.version}${customer ? ` — ${customer}` : ""}.pdf`;

    rendered = [];
    for (const copy of await copiesFor(actor.companyId, proposal.id, suffix)) {
      rendered.push({
        copy,
        pdf: await renderProposalPdf(proposal.id, { creditsApplied: copy.creditsApplied }),
      });
    }
  } catch (err) {
    return { fileId: null, error: reason(err) };
  }

  try {
    // Replace rather than accumulate. The link that says which file belongs to
    // which version is the pair of columns on the proposal, so the copies to
    // drop are whatever this row points at right now — no second foreign key on
    // FileAsset, and no guessing by category, which would sweep up a PDF a rep
    // dropped into the same folder by hand.
    const previous = await prisma.solarProposal.findFirst({
      where: { id: proposal.id, companyId: actor.companyId },
      select: { approvedFileId: true, approvedParFileId: true },
    });

    const written: Partial<Record<Copy["column"], string>> = {};
    for (const { copy, pdf } of rendered) {
      const key = `companies/${actor.companyId}/solar-proposals/${nanoid()}.pdf`;
      await putObject(key, pdf);
      const asset = await prisma.fileAsset.create({
        data: {
          companyId: actor.companyId,
          kind: "document",
          name: copy.name,
          storageKey: key,
          mimeType: "application/pdf",
          size: pdf.length,
          category: PROPOSAL_CATEGORY,
          leadId: proposal.leadId,
          uploadedById: actor.userId,
        },
        select: { id: true },
      });
      written[copy.column] = asset.id;
    }

    await removeFiledCopies(
      actor.companyId,
      [previous?.approvedFileId, previous?.approvedParFileId].filter((id): id is string => !!id),
    );

    await prisma.solarProposal.update({
      where: { id: proposal.id },
      data: {
        approvedFileId: written.approvedFileId ?? null,
        // Nulled rather than left alone when this proposal has only one reading
        // — a version re-priced out of its credits must not keep pointing at a
        // par copy of the deal it used to be.
        approvedParFileId: written.approvedParFileId ?? null,
      },
    });

    return { fileId: written.approvedFileId ?? null, error: null };
  } catch (err) {
    return { fileId: null, error: reason(err) };
  }
}

/**
 * Which copies this proposal files.
 *
 * Decided from the FROZEN SNAPSHOT, not from the deal as it stands now: the
 * question is what the document the customer signed says, and a rate sheet
 * edited since must not change how many copies a signed proposal has.
 *
 * `hasCreditSwitch` is the ONE definition of "this document has two readings",
 * shared with the version row on the deal so the folder and the row that
 * describes it can never disagree — including about the battery-only deck,
 * which has no switch and would otherwise file the same PDF twice.
 */
async function copiesFor(companyId: string, id: string, suffix: string): Promise<Copy[]> {
  const row = await prisma.solarProposal.findFirst({
    where: { id, companyId },
    select: { snapshot: true },
  });
  const hasSwitch = hasCreditSwitch(row?.snapshot);

  // The credits-applied reading keeps the plain name, because on a deal that
  // earns them it is the one the conversation ended on. The par copy is the
  // larger figure and says so.
  return hasSwitch
    ? [
        { creditsApplied: true, name: `Proposal ${suffix}`, column: "approvedFileId" },
        { creditsApplied: false, name: `Proposal PAR ${suffix}`, column: "approvedParFileId" },
      ]
    : [{ creditsApplied: false, name: `Proposal ${suffix}`, column: "approvedFileId" }];
}

function reason(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.slice(0, 300);
}
