import { headers } from "next/headers";
import { storeAvatarRecording } from "@/server/modules/welcome-call/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 200 * 1024 * 1024; // 200 MB cap for a recorded call

// Public: the customer's browser POSTs the recorded call video (raw blob).
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length === 0) return new Response("Empty body", { status: 400 });
  if (buf.length > MAX_BYTES) return new Response("Recording too large", { status: 413 });

  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || null;
  const res = await storeAvatarRecording(token, buf, ip);
  return Response.json(res, { status: res.ok ? 200 : 400 });
}
