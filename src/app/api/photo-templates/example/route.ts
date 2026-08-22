import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import { getObject } from "@/server/storage";

/**
 * Serves the example photo for one checklist slot.
 *
 * Behind a session, unlike a lender's logo: no homeowner ever sees one of
 * these, so there is no anonymous reader to serve, and "a photo of the inside
 * of a panel we consider correct" is internal training material. Company is the
 * only scope that matters — every rep and crew member on the job is meant to
 * look at it, which is the entire point of it existing.
 */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("item");
  if (!id) return new NextResponse("Missing item", { status: 400 });

  const user = await requireUser();
  const item = await prisma.photoTemplateItem.findFirst({
    where: { id, template: { companyId: user.companyId } },
    select: { exampleKey: true },
  });
  if (!item?.exampleKey) return new NextResponse("Not found", { status: 404 });

  let data: Buffer;
  try {
    data = await getObject(item.exampleKey);
  } catch {
    return new NextResponse("Example unavailable", { status: 404 });
  }

  return new NextResponse(new Uint8Array(data), {
    headers: {
      // Always JPEG: everything is normalised on the way in.
      "Content-Type": "image/jpeg",
      // The URL carries the example's own updatedAt, so a replaced example is a
      // different URL. Private because it is behind a login.
      "Cache-Control": "private, max-age=86400, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
