import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/session";
import { getObject } from "@/server/storage";
import { scopePdfForUser } from "@/server/modules/scope/queries";

/** Streams the carrier scope PDF, only to users who can access the owning deal. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();

  const file = await scopePdfForUser(user, id);
  if (!file) return new NextResponse("Not found", { status: 404 });

  let data: Buffer;
  try {
    data = await getObject(file.storageKey);
  } catch {
    return new NextResponse("File unavailable", { status: 404 });
  }

  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": file.mimeType ?? "application/pdf",
      "Content-Disposition": `inline; filename="${file.name.replace(/[^a-z0-9._-]/gi, "_")}"`,
      "Cache-Control": "private, max-age=60",
    },
  });
}
