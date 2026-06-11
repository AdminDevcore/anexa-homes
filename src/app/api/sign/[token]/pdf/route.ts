import { NextResponse } from "next/server";
import { prisma } from "@/server/db/client";
import { getObject } from "@/server/storage";
import { sha256 } from "@/server/modules/esign/tokens";

// Serves the source PDF for a signing session, gated by the signer's token.
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const signer = await prisma.documentSigner.findUnique({
    where: { tokenHash: sha256(token) },
    select: { package: { select: { snapshot: true } } },
  });
  const key = (signer?.package?.snapshot as { sourcePdfKey?: string } | null)?.sourcePdfKey;
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
