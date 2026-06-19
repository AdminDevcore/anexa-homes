import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { getCallRecording } from "@/server/modules/welcome-call/service";

export const dynamic = "force-dynamic";

// Staff: stream a completed call recording for playback on the deal.
export async function GET(_req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const user = await requireUser();
  if (!can(user, "read", "Document")) return new Response("Forbidden", { status: 403 });
  const { sessionId } = await params;
  const buf = await getCallRecording(user.companyId, sessionId);
  if (!buf) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(buf), {
    headers: { "Content-Type": "video/webm", "Cache-Control": "private, max-age=3600" },
  });
}
