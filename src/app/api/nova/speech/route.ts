import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeNovaRequest } from "@/server/modules/nova/request";
import { speak, voiceEnabled } from "@/server/modules/nova/voice";

// Nova's reply, read aloud. The browser gets audio back; the key stays here.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const bodySchema = z.object({ text: z.string().trim().min(1).max(4000) });

export async function POST(req: Request) {
  const auth = await authorizeNovaRequest();
  if (!auth.ok) return auth.response;
  if (!voiceEnabled()) {
    return NextResponse.json({ error: "Nova's voice isn't set up on this server." }, { status: 503 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "That request wasn't understood." }, { status: 400 });
  }

  try {
    const audio = await speak(parsed.data.text);
    return new NextResponse(audio.body, {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
    });
  } catch (e) {
    console.error("[nova] speech failed", e);
    return NextResponse.json({ error: "Nova's voice isn't available right now." }, { status: 502 });
  }
}
