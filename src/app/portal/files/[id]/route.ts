import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import { getObject } from "@/server/storage";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();

  const file = await prisma.fileAsset.findFirst({
    where: { id, companyId: user.companyId },
    include: {
      lead: { select: { customerUserId: true, assignedRepId: true } },
      project: { select: { lead: { select: { customerUserId: true } } } },
      conversation: { select: { members: { where: { userId: user.userId }, select: { userId: true } } } },
    },
  });
  if (!file) return new NextResponse("Not found", { status: 404 });

  // Chat attachments: only members of that conversation may fetch them.
  if (file.conversationId) {
    if ((file.conversation?.members.length ?? 0) === 0) return new NextResponse("Forbidden", { status: 403 });
  }

  // Customers may only access files tied to their own lead/project.
  if (user.role === "customer") {
    const ownsLead = file.lead?.customerUserId === user.userId;
    const ownsProject = file.project?.lead?.customerUserId === user.userId;
    if (!ownsLead && !ownsProject) return new NextResponse("Forbidden", { status: 403 });
  }

  let data: Buffer;
  try {
    data = await getObject(file.storageKey);
  } catch {
    return new NextResponse("File unavailable", { status: 404 });
  }

  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": file.mimeType ?? "application/octet-stream",
      "Content-Disposition": `inline; filename="${file.name.replace(/[^a-z0-9._-]/gi, "_")}"`,
      "Cache-Control": "private, max-age=60",
    },
  });
}
