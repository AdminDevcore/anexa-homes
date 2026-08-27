import { NextResponse } from "next/server";
import { proposalForPrint } from "@/server/modules/solar/print-access";
import { serveSiteImage } from "@/server/modules/solar/proposal-images";

/** The aerial the array is drawn on, for the PDF render. */
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ sig: string }> }) {
  const { sig } = await params;
  const proposal = await proposalForPrint(sig);
  if (!proposal) return new NextResponse("Not found", { status: 404 });
  return serveSiteImage(proposal, req);
}
