import { NextResponse } from "next/server";
import { prisma } from "@/server/db/client";
import { getObject } from "@/server/storage";
import { sha256 } from "@/server/modules/esign/tokens";
import { envelopeDocuments, type Snapshot } from "@/server/modules/esign/pdf";

// Serves a source PDF for a signing session, gated by the signer's token.
// `?doc=` names one document in a multi-PDF envelope; without it the first
// document is served, which is the whole thing for a single-PDF envelope.
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const signer = await prisma.documentSigner.findUnique({
    where: { tokenHash: sha256(token) },
    select: { package: { select: { snapshot: true } } },
  });
  const snapshot = signer?.package?.snapshot as unknown as Snapshot | null;
  if (!snapshot) return new NextResponse("Not found", { status: 404 });

  const docs = envelopeDocuments(snapshot);
  const docId = new URL(req.url).searchParams.get("doc");
  const doc = docId ? docs.find((d) => d.id === docId) : docs[0];
  const key = doc?.sourcePdfKey;
  if (!key) return new NextResponse("Not found", { status: 404 });

  let data: Buffer;
  try {
    data = await getObject(key);
  } catch {
    return new NextResponse("File unavailable", { status: 404 });
  }
  return new NextResponse(new Uint8Array(data), {
    headers: { "Content-Type": "application/pdf", "Cache-Control": "private, max-age=60" },
  });
}
