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

  // Serve the file the SNAPSHOT froze, not whatever the design points at today.
  // The customer's document is a record of what they were shown; swapping the
  // drawing under it after the fact would quietly rewrite that record.
  const snapshot = proposal.snapshot as unknown as { layout?: { fileId?: string } | null };
  const fileId = snapshot?.layout?.fileId;
  if (!fileId) return new NextResponse("Not found", { status: 404 });

  const file = await runUnscoped(
    "public proposal layout image: read the file row",
    () =>
      prisma.fileAsset.findFirst({
        where: {
          id: fileId,
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
