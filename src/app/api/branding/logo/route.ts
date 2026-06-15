import { NextResponse } from "next/server";
import { prisma } from "@/server/db/client";
import { getObject } from "@/server/storage";

/**
 * Public logo serving route. Logos must render pre-auth (login page) and in
 * email clients, so this is intentionally unauthenticated — logos aren't
 * sensitive. The logo is the latest FileAsset tagged "branding_logo" for the
 * company. Callers point an <img src> here via CompanySettings.logoUrl.
 */
export async function GET(req: Request) {
  const company = new URL(req.url).searchParams.get("company");
  if (!company) return new NextResponse("Missing company", { status: 400 });

  const asset = await prisma.fileAsset.findFirst({
    where: { companyId: company, category: "branding_logo" },
    orderBy: { createdAt: "desc" },
    select: { storageKey: true, mimeType: true },
  });
  if (!asset) return new NextResponse("Not found", { status: 404 });

  let data: Buffer;
  try {
    data = await getObject(asset.storageKey);
  } catch {
    return new NextResponse("Logo unavailable", { status: 404 });
  }

  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": asset.mimeType ?? "image/png",
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
