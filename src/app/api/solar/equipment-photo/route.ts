import { NextResponse } from "next/server";
import { prisma } from "@/server/db/client";
import { getObject } from "@/server/storage";
import { runUnscoped } from "@/server/vertical/context";

/**
 * Serves one catalogue item's photograph.
 *
 * Unauthenticated, like the lender-logo and branding-logo routes and for the
 * same reason: a homeowner opens their proposal from a link in an email, with
 * no session and no account, and the picture of the panel going on their roof
 * has to render there. What it exposes is a product shot of hardware the
 * manufacturer already publishes, addressed by a uuid nobody can guess.
 *
 * The `v` parameter is read by caches, not by this handler — it carries the
 * item's own `photoUpdatedAt`, so a changed photo is a changed URL.
 */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("equipment");
  if (!id) return new NextResponse("Missing equipment", { status: 400 });

  // Unscoped because there is no session here to say which workspace is
  // active, and a uuid already identifies exactly one catalogue item. The same
  // shape as the public proposal page, which reads its drawing the same way.
  const item = await runUnscoped("public equipment photo: no session to scope by", () =>
    prisma.solarEquipment.findUnique({
      where: { id },
      select: { photoKey: true },
    }),
  );
  if (!item?.photoKey) return new NextResponse("Not found", { status: 404 });

  let data: Buffer;
  try {
    data = await getObject(item.photoKey);
  } catch {
    return new NextResponse("Photo unavailable", { status: 404 });
  }

  return new NextResponse(new Uint8Array(data), {
    headers: {
      // Always PNG: everything is normalised on the way in.
      "Content-Type": "image/png",
      // The URL carries the photo's own updatedAt, so a changed photo is a
      // changed URL and this can be cached hard.
      "Cache-Control": "public, max-age=86400, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
