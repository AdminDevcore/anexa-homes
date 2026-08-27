import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { fileApprovedCopy } from "@/server/modules/solar/proposal-file-copy";

/**
 * Render the approved proposal and file it in the deal's Proposal folder.
 *
 * A ROUTE RATHER THAN A SERVER ACTION, for two reasons that both come out of
 * the same fact — this is the only thing in the app that boots a browser:
 *
 *  1. `@sparticuz/chromium` is 66MB, and Next traces it into every function
 *     whose imports reach it. As a Server Action it was pulled into BOTH pages
 *     that host the approve button (measured: 220 browser files traced into
 *     each). One route carries it now, and the pages stay lean.
 *  2. `maxDuration` is a property of a route segment. A Server Action inherits
 *     whichever page it was invoked from, so the limit that governs a render
 *     was set on two pages that have nothing to do with rendering.
 *
 * Called straight after approving, and again by the row's Retry link. Both go
 * through here, so the failure path is not a second implementation of the
 * success one.
 */
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();

  // The same authority that approves. Filing the copy is the second half of
  // one act, and a caller who may not do the first must not do the second.
  if (!can(user, "update", "Settings")) {
    return NextResponse.json({ ok: false, error: "Not allowed." }, { status: 403 });
  }

  const proposal = await prisma.solarProposal.findFirst({
    where: { companyId: user.companyId, id },
    select: { id: true, leadId: true, version: true, approvedAt: true },
  });
  if (!proposal) {
    return NextResponse.json({ ok: false, error: "Proposal not found." }, { status: 404 });
  }
  // Only the approved version gets a copy on the deal. Without this the route
  // would render any version on demand, which is a browser boot per request for
  // anybody who can guess an id.
  if (!proposal.approvedAt) {
    return NextResponse.json({ ok: false, error: "That version is not approved." }, { status: 409 });
  }

  const filed = await fileApprovedCopy({ companyId: user.companyId, userId: user.userId }, proposal);
  if (filed.error) {
    return NextResponse.json({ ok: false, error: filed.error }, { status: 502 });
  }

  revalidatePath(`/portal/leads/${proposal.leadId}`);
  revalidatePath(`/portal/leads/${proposal.leadId}/solar-proposal`);
  return NextResponse.json({ ok: true, fileId: filed.fileId });
}
