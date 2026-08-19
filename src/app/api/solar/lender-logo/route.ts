import { NextResponse } from "next/server";
import { prisma } from "@/server/db/client";
import { getObject } from "@/server/storage";
import { runUnscoped } from "@/server/vertical/context";

/**
 * Serves one lender's logo.
 *
 * Unauthenticated, like the branding logo route and for the same reason: a
 * homeowner opens their proposal from a link in an email, with no session and
 * no account, and the lender's mark has to render there. What it exposes is an
 * image a bank already publishes on its own website, addressed by a uuid nobody
 * can guess, so there is nothing here worth putting a login in front of.
 */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("lender");
  if (!id) return new NextResponse("Missing lender", { status: 400 });

  // Unscoped because there is no session here to say which workspace is
  // active, and a uuid already identifies exactly one lender. The same shape as
  // the public proposal page, which reads its drawing the same way.
  const lender = await runUnscoped("public lender logo: no session to scope by", () =>
    prisma.solarLender.findUnique({
      where: { id },
      select: { logoKey: true },
    })
  );
  if (!lender?.logoKey) return new NextResponse("Not found", { status: 404 });

  let data: Buffer;
  try {
    data = await getObject(lender.logoKey);
  } catch {
    return new NextResponse("Logo unavailable", { status: 404 });
  }

  return new NextResponse(new Uint8Array(data), {
    headers: {
      // Always PNG: everything is normalised on the way in.
      "Content-Type": "image/png",
      // The URL carries the logo's own updatedAt, so a changed logo is a
      // changed URL and this can be cached hard.
      "Cache-Control": "public, max-age=86400, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
