import { NextResponse } from "next/server";
import { prisma } from "@/server/db/client";
import { runUnscoped } from "@/server/vertical/context";
import { serveLayoutImage } from "@/server/modules/solar/proposal-images";

/**
 * The panel-layout drawing, served to the homeowner reading their proposal.
 *
 * The unguessable proposal token is the authorization, exactly as on the public
 * proposal page itself. It unlocks ONE file: the layout attached to that
 * proposal's own snapshot — never an arbitrary file id, so a valid token cannot
 * be walked into someone else's photos.
 *
 * The gate is here; the serving is shared with the print route — see
 * server/modules/solar/proposal-images.ts for why those two halves are split.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!token) return new NextResponse("Not found", { status: 404 });

  // The token identifies exactly one proposal, whose workspace is not known
  // until it has been read. SENT-ONLY, exactly like the proposal page itself:
  // an unsent proposal must not leak its layout drawing either, and a route
  // that only checked the token would have been the way around the page's gate.
  const proposal = await runUnscoped(
    "public proposal layout image: resolve the proposal by its token",
    () =>
      prisma.solarProposal.findUnique({
        where: { publicToken: token },
        select: { companyId: true, leadId: true, status: true, sentAt: true, snapshot: true },
      })
  );
  if (!proposal) return new NextResponse("Not found", { status: 404 });
  if (!proposal.sentAt) return new NextResponse("Not found", { status: 404 });
  if (!["sent", "viewed", "signed"].includes(proposal.status)) {
    return new NextResponse("Not found", { status: 404 });
  }

  return serveLayoutImage(proposal);
}
