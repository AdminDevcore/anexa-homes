import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import { listScope } from "@/server/rbac/policies";
import { getObject } from "@/server/storage";
import { appendDocumentEvent } from "@/server/modules/esign/audit";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await requireUser();

  const scope = listScope(user, "Document") as Prisma.DocumentPackageWhereInput;
  const pkg = await prisma.documentPackage.findFirst({
    where: { AND: [{ id }, scope] },
    include: { signedFile: true },
  });

  if (!pkg || !pkg.signedFile) {
    return new NextResponse("Not found", { status: 404 });
  }

  let data: Buffer;
  try {
    data = await getObject(pkg.signedFile.storageKey);
  } catch {
    return new NextResponse("File unavailable", { status: 404 });
  }

  await appendDocumentEvent(prisma, {
    companyId: user.companyId,
    packageId: pkg.id,
    type: "downloaded",
    actor: user.fullName,
  });

  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${pkg.title.replace(/[^a-z0-9]+/gi, "_")}.pdf"`,
    },
  });
}
