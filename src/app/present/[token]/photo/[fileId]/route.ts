import { NextResponse } from "next/server";
import { prisma } from "@/server/db/client";
import { getObject } from "@/server/storage";
import { runUnscoped } from "@/server/vertical/context";

// Token-scoped public image serving for the customer presentation. A valid
// proposal token only unlocks PHOTOS attached to that proposal's own lead — never
// arbitrary files.
export async function GET(_req: Request, { params }: { params: Promise<{ token: string; fileId: string }> }) {
  const { token, fileId } = await params;

  // The unguessable token IS the authorization and identifies exactly one
  // proposal, whose workspace is not known until it has been read.
  const proposal = await runUnscoped(
    "public presentation photo: resolve the proposal by its token",
    () =>
      prisma.proposal.findUnique({
        where: { publicToken: token },
        select: { companyId: true, leadId: true },
      })
  );
  if (!proposal) return new NextResponse("Not found", { status: 404 });

  const file = await prisma.fileAsset.findFirst({
    where: { id: fileId, companyId: proposal.companyId, leadId: proposal.leadId, kind: "photo" },
    select: { storageKey: true, mimeType: true, name: true },
  });
  if (!file) return new NextResponse("Not found", { status: 404 });

  let data: Buffer;
  try {
    data = await getObject(file.storageKey);
  } catch {
    return new NextResponse("File unavailable", { status: 404 });
  }

  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": file.mimeType ?? "image/jpeg",
      "Content-Disposition": `inline; filename="${file.name.replace(/[^a-z0-9._-]/gi, "_")}"`,
      "Cache-Control": "public, max-age=300",
    },
  });
}
