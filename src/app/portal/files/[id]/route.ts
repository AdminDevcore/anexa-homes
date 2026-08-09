import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import { listScope } from "@/server/rbac/policies";
import { stampVertical } from "@/server/vertical/visibility";
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
  // Chat is deliberately cross-vertical, so these skip the vertical check below.
  if (file.conversationId) {
    if ((file.conversation?.members.length ?? 0) === 0) return new NextResponse("Forbidden", { status: 403 });
  }

  // PRIVATE — the uploader and admins, nobody else, in any workspace.
  //
  // This is checked before everything below because it is not a workspace rule
  // at all: an onboarding SSN card should not become readable to a colleague
  // just because they share a workspace with the person who uploaded it. It also
  // FIXES an old gap in the opposite direction — the staff branch further down
  // only ever allowed deal-attached files, so an employee could not open their
  // own ID photo back.
  if (file.scope === "private") {
    const isOwner = file.uploadedById === user.userId;
    const isAdmin = user.role === "super_admin" || user.role === "admin";
    if (!isOwner && !isAdmin) return new NextResponse("Forbidden", { status: 403 });
  }

  // WORKSPACE, with no parent deal to inherit from (knowledge-base material).
  // Deal-attached files are covered by the parent check below; these have no
  // parent, so the row's own workspace is the only thing to compare against.
  if (file.scope === "workspace" && file.vertical && !file.leadId && !file.projectId) {
    const active = await stampVertical();
    if (active && active !== file.vertical) return new NextResponse("Not found", { status: 404 });
  }

  // VERTICAL ISOLATION — applies to EVERY role, admins included.
  //
  // FileAsset has no vertical of its own and is intentionally not a SCOPED
  // model: the same table holds company-level assets (the branding logo,
  // bookkeeping receipts) that belong to no workspace. So a deal-attached file
  // is isolated through its PARENT instead.
  //
  // Non-admin staff were already covered further down, because `listScope` runs
  // through the scoped `prisma.lead` / `prisma.project`. Admins were not: their
  // branch skips that check entirely, so an admin sitting in Roofing could
  // fetch a Solar photo by guessing or replaying its id. That is the hole this
  // closes, and it is why the check lives here rather than in the staff branch.
  //
  // Flag off, the extension short-circuits and these lookups return the row
  // exactly as before — so Roofing behaviour is unchanged today.
  if (!file.conversationId && (file.leadId || file.projectId)) {
    const inVertical = file.leadId
      ? await prisma.lead.findFirst({ where: { id: file.leadId }, select: { id: true } })
      : await prisma.project.findFirst({ where: { id: file.projectId! }, select: { id: true } });
    if (!inVertical) return new NextResponse("Not found", { status: 404 });
  }

  // Customers may only access files tied to their own lead/project.
  if (user.role === "customer") {
    const ownsLead = file.lead?.customerUserId === user.userId;
    const ownsProject = file.project?.lead?.customerUserId === user.userId;
    if (!ownsLead && !ownsProject) return new NextResponse("Forbidden", { status: 403 });
  } else if (
    user.role !== "super_admin" &&
    user.role !== "admin" &&
    !file.conversationId &&
    // A private file has already passed its own owner/admin check above; falling
    // into the staff branch would then reject the owner for not having a deal.
    file.scope !== "private"
  ) {
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
