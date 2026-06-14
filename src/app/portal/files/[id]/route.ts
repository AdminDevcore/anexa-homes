import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import { listScope } from "@/server/rbac/policies";
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
  } else if (user.role !== "super_admin" && user.role !== "admin" && !file.conversationId) {
    // Staff must own the file's deal: verify its lead/project is within their scope
    // (a rep can't fetch another rep's file, an installer only their crew's jobs).
    let allowed = false;
    if (file.leadId) {
      allowed = !!(await prisma.lead.findFirst({
        where: { id: file.leadId, ...(listScope(user, "Lead") as Prisma.LeadWhereInput) },
        select: { id: true },
      }));
    } else if (file.projectId) {
      allowed = !!(await prisma.project.findFirst({
        where: { id: file.projectId, ...(listScope(user, "Project") as Prisma.ProjectWhereInput) },
        select: { id: true },
      }));
    }
    // Files not tied to any deal/conversation aren't exposed to non-admin staff.
    if (!allowed) return new NextResponse("Forbidden", { status: 403 });
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
