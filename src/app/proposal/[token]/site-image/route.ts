import { NextResponse } from "next/server";
import { prisma } from "@/server/db/client";
import { runUnscoped } from "@/server/vertical/context";
import { serveSiteImage } from "@/server/modules/solar/proposal-images";

/**
 * The customer's own roof, from above, so the array can be drawn on it.
 *
 * PROXIED, never linked — a Static Maps URL carries the API key as a query
 * parameter, and this page's whole audience is anonymous. The token stands in
 * for a session and unlocks ONE picture: the coordinate frozen into that
 * proposal's own snapshot.
 *
 * SENT-ONLY, like the page and the layout image. Every failure is a 404: an
 * unset key, a deal that never geocoded and a bad token are indistinguishable
 * from outside, and inside they all mean "draw the fallback".
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token) return new NextResponse("Not found", { status: 404 });

  const proposal = await runUnscoped(
    "public proposal site image: resolve the proposal by its token",
    () =>
      prisma.solarProposal.findUnique({
        where: { publicToken: token },
        select: { companyId: true, leadId: true, status: true, sentAt: true, snapshot: true },
      })
  );
  if (!proposal?.sentAt) return new NextResponse("Not found", { status: 404 });
  if (!["sent", "viewed", "signed"].includes(proposal.status)) {
    return new NextResponse("Not found", { status: 404 });
  }

  return serveSiteImage(proposal, req);
}
