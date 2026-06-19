import { getAvatarClip } from "@/server/modules/welcome-call/service";

export const dynamic = "force-dynamic";

// Public: streams a ready avatar clip. Gated by the unguessable session token.
export async function GET(_req: Request, { params }: { params: Promise<{ token: string; key: string }> }) {
  const { token, key } = await params;
  const buf = await getAvatarClip(token, decodeURIComponent(key));
  if (!buf) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(buf), {
    headers: { "Content-Type": "video/mp4", "Cache-Control": "private, max-age=3600" },
  });
}
