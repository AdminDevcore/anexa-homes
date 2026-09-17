import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import { can } from "@/server/rbac/guards";
import { isContractorInvoice } from "@/lib/contractor-invoice";
import { listScope } from "@/server/rbac/policies";
import { stampVertical } from "@/server/vertical/visibility";
import { getObject } from "@/server/storage";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  // `?download=1` is the difference between looking at a file and taking it.
  // Everything that renders one — thumbnails, <img>, the preview tab — wants it
  // inline; the Download button beside a photo wants the browser to save it,
  // under the name the checklist slot gave it.
  const download = new URL(req.url).searchParams.get("download") === "1";

  const file = await prisma.fileAsset.findFirst({
    where: { id, companyId: user.companyId },
    include: {
      // The lead/project relations were only ever loaded to answer "is the
      // logged-in homeowner the owner of this file". No homeowner logs in, so
      // the ids on the row are all the scope check below needs.
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

  /* ── A CONTRACTOR'S INVOICE IS NOT JOB PAPERWORK ───────────────────────
   * Read by the ContractorInvoice permission alone — super_admin and
   * accounting — for everybody, in every workspace, admins and the person who
   * uploaded it included.
   *
   * It is checked HERE, above every other branch, because every other branch
   * would let it through. The deal-scope branch below is the whole problem:
   * a file on a deal is authorised by "can you open this deal", so the rep
   * whose commission this cost reduces, their manager, and every admin would
   * all be able to open the subcontractor's bill. `scope = "private"` is not
   * the lever either — it admits the uploader and all admins, which is the
   * opposite of the rule here.
   *
   * The deal is only the envelope's address. See src/lib/contractor-invoice.ts.
   */
  if (isContractorInvoice(file.category)) {
    if (!can(user, "read", "ContractorInvoice")) {
      return new NextResponse("Forbidden", { status: 403 });
    }
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

  /* ── A FILE ON A LEDGER TRANSACTION IS BOOKKEEPING DATA ────────────────
   * Receipts (bookkeeping/actions.ts) and pay stubs (payroll/post-bookkeeping.ts)
   * hang off a Transaction with no deal, project or conversation. They are read
   * by the Bookkeeping permission alone (super_admin and accounting) and never
   * by role: the admin branch below would hand them to every admin, and the
   * staff branch would refuse accounting, who owns the books, for not having a
   * deal. So the permission decides, and a file that passes is served without
   * falling into either branch.
   */
  if (file.transactionId && !can(user, "read", "Bookkeeping")) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  // There is no customer branch here any more. Homeowners have no accounts in
  // this product, so every authenticated reader is staff and goes through the
  // scope check below.
  if (
    user.role !== "super_admin" &&
    user.role !== "admin" &&
    !file.conversationId &&
    // A private file has already passed its own owner/admin check above; falling
    // into the staff branch would then reject the owner for not having a deal.
    file.scope !== "private" &&
    // A transaction file has already passed its Bookkeeping check above.
    !file.transactionId
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
      "Content-Disposition": contentDisposition(file.name, download),
      "Cache-Control": "private, max-age=60",
    },
  });
}

/**
 * `Content-Disposition` carrying the file's real name.
 *
 * Slot labels are written for people — "Roof from the back — showing the
 * opposite roof plane.jpg" — so they hold spaces and an em dash, neither of
 * which survives the ASCII `filename=` parameter. RFC 5987's `filename*` does
 * carry them, and every browser prefers it when both are present, so the
 * squashed ASCII form stays behind purely as the fallback.
 */
function contentDisposition(name: string, download: boolean): string {
  const ascii = name.replace(/[^a-z0-9._-]/gi, "_");
  // encodeURIComponent leaves ' ( ) * ! ~ alone; RFC 5987 attr-char does not
  // allow the first four, so percent-encode them by hand.
  const utf8 = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
  return `${download ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}
