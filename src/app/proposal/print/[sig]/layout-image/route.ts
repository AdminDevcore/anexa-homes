import { NextResponse } from "next/server";
import { proposalForPrint } from "@/server/modules/solar/print-access";
import { serveLayoutImage } from "@/server/modules/solar/proposal-images";

/** The layout drawing, for the PDF render. Signature in place of a token. */
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ sig: string }> }) {
  const { sig } = await params;
  const proposal = await proposalForPrint(sig);
  if (!proposal) return new NextResponse("Not found", { status: 404 });
  return serveLayoutImage(proposal);
}
