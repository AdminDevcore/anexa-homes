import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { getObject } from "@/server/storage";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!can(user, "read", "Document")) return new NextResponse("Forbidden", { status: 403 });

  const template = await prisma.documentTemplate.findFirst({
    where: { id, companyId: user.companyId },
    select: { sourcePdfKey: true },
  });
  if (!template?.sourcePdfKey) return new NextResponse("Not found", { status: 404 });

  let data: Buffer;
  try {
    data = await getObject(template.sourcePdfKey);
  } catch {
    return new NextResponse("File unavailable", { status: 404 });
  }
  return new NextResponse(new Uint8Array(data), {
    headers: { "Content-Type": "application/pdf", "Cache-Control": "private, max-age=60" },
  });
}
