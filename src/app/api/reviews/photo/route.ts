import { NextResponse } from "next/server";
import { prisma } from "@/server/db/client";
import { getObject } from "@/server/storage";

/**
 * Serves an optional customer-submitted review photo by review id. Photos are
 * low-sensitivity marketing images keyed by an unguessable UUID, so this is
 * intentionally unauthenticated (same posture as the branding logo route) —
 * which also lets staff preview a pending review's photo in moderation. We
 * never serve a soft-deleted review's photo.
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const id = sp.get("id");
  if (!id) return new NextResponse("Missing id", { status: 400 });
  const index = Math.max(0, Number(sp.get("i") ?? 0) || 0);

  const review = await prisma.review.findFirst({
    where: { id, deletedAt: null },
    select: { photoKey: true, photoKeys: true, photoMime: true },
  });
  if (!review) return new NextResponse("Not found", { status: 404 });
  const keys = review.photoKeys.length ? review.photoKeys : review.photoKey ? [review.photoKey] : [];
  const key = keys[index];
  if (!key) return new NextResponse("Not found", { status: 404 });

  let data: Buffer;
  try {
    data = await getObject(key);
  } catch {
    return new NextResponse("Photo unavailable", { status: 404 });
  }

  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": review.photoMime ?? "image/jpeg",
      "Cache-Control": "public, max-age=600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
