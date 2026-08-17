import { NextResponse } from "next/server";
import { prisma } from "@/server/db/client";
import { getObject } from "@/server/storage";
import { runUnscoped } from "@/server/vertical/context";

/**
 * The panel-layout drawing, served to the homeowner reading their proposal.
 *
 * The unguessable proposal token is the authorization, exactly as on the public
 * proposal page itself. It unlocks ONE file: the layout attached to that
 * proposal's own design — never an arbitrary file id, so a valid token cannot be
 * walked into someone else's photos.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  // The token identifies exactly one proposal, whose workspace is not known
  // until it has been read.
  const proposal = await runUnscoped(
    "public proposal layout image: resolve the proposal by its token",
    () =>
      prisma.solarProposal.findUnique({
        where: { publicToken: token },
        select: { companyId: true, leadId: true },
      })
  );
  if (!proposal) return new NextResponse("Not found", { status: 404 });

  const design = await runUnscoped(
    "public proposal layout image: read the layout attached to that design",
    () =>
      prisma.solarDesign.findUnique({
        where: { leadId: proposal.leadId },
        select: { layoutImageFileId: true },
      })
  );
  if (!design?.layoutImageFileId) return new NextResponse("Not found", { status: 404 });

  const file = await runUnscoped(
    "public proposal layout image: read the file row",
    () =>
      prisma.fileAsset.findFirst({
        where: {
          id: design.layoutImageFileId!,
          companyId: proposal.companyId,
          leadId: proposal.leadId,
          kind: "photo",
        },
        select: { storageKey: true, mimeType: true, name: true },
      })
  );
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
