import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { getObject } from "@/server/storage";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!can(user, "read", "Document")) return new NextResponse("Forbidden", { status: 403 });

  const template = await prisma.documentTemplate.findFirst({
    where: { id, companyId: user.companyId },
    select: { sourcePdfKey: true },
  });
  if (!template) return new NextResponse("Not found", { status: 404 });

  // `?doc=` picks one PDF out of a multi-document template. Without it the
  // template's own source is served, which is the whole document for every
  // single-PDF template.
  const docId = new URL(req.url).searchParams.get("doc");
  let key = template.sourcePdfKey;
  if (docId) {
    const doc = await prisma.documentTemplateDocument.findFirst({
      where: { id: docId, templateId: id },
      select: { sourcePdfKey: true },
    });
    if (!doc) return new NextResponse("Not found", { status: 404 });
    key = doc.sourcePdfKey;
  }
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
