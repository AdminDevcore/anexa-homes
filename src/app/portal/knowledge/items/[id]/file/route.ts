import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/session";
import { getActiveVertical } from "@/server/auth/vertical";
import { getObject } from "@/server/storage";
import { knowledgeFileForUser } from "@/server/modules/knowledge/queries";

/**
 * Streams a training file ONLY if its category is visible to the requesting
 * user's role (re-checked here so a guessed item id can't leak another
 * department's training).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const vertical = await getActiveVertical(user);

  const file = await knowledgeFileForUser(user, vertical, id);
  if (!file) return new NextResponse("Not found", { status: 404 });

  let data: Buffer;
  try {
    data = await getObject(file.storageKey);
  } catch {
    return new NextResponse("File unavailable", { status: 404 });
  }

  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": file.mimeType ?? "application/octet-stream",
      "Content-Disposition": `inline; filename="${file.name.replace(/[^a-z0-9._-]/gi, "_")}"`,
      "Cache-Control": "private, max-age=60",
    },
  });
}
