import { prisma } from "@/server/db/client";
import { putObject } from "@/server/storage";
import type { WelcomeCallContent } from "./types";

// HeyGen config (company-wide default in v1; per-template avatars come later).
const HEYGEN_KEY = process.env.HEYGEN_API_KEY ?? "";
const HEYGEN_AVATAR_ID = process.env.HEYGEN_AVATAR_ID ?? "";
const HEYGEN_VOICE_ID = process.env.HEYGEN_VOICE_ID ?? "";

/** True when HeyGen is wired up. When false, avatar calls fall back to browser TTS clips. */
export function heygenConfigured(): boolean {
  return !!(HEYGEN_KEY && HEYGEN_AVATAR_ID && HEYGEN_VOICE_ID);
}

export type SegmentStatus = "pending" | "ready" | "failed";
/** A stored avatar clip (or a TTS placeholder) the customer plays in order. */
export type Segment = {
  key: string; // "intro" | "closing" | item id
  text: string; // what the avatar says (also the TTS fallback text)
  heygenVideoId: string | null;
  storageKey: string | null; // set once the clip is downloaded to our storage
  status: SegmentStatus;
};

export function parseSegments(json: unknown): Segment[] {
  if (!Array.isArray(json)) return [];
  return json
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && typeof (x as Record<string, unknown>).key === "string")
    .map((x) => ({
      key: String(x.key),
      text: String(x.text ?? ""),
      heygenVideoId: x.heygenVideoId == null ? null : String(x.heygenVideoId),
      storageKey: x.storageKey == null ? null : String(x.storageKey),
      status: (x.status === "ready" || x.status === "failed" ? x.status : "pending") as SegmentStatus,
    }));
}

/** Ordered narration: intro → each item (the question the avatar asks) → closing. */
export function narrationSegments(snapshot: WelcomeCallContent): { key: string; text: string }[] {
  const out: { key: string; text: string }[] = [];
  if (snapshot.intro?.trim()) out.push({ key: "intro", text: snapshot.intro.trim() });
  for (const it of snapshot.items) {
    const text = [it.title, it.body].filter(Boolean).join(". ").trim();
    if (text) out.push({ key: it.id, text });
  }
  if (snapshot.closing?.trim()) out.push({ key: "closing", text: snapshot.closing.trim() });
  return out;
}

const H = "https://api.heygen.com";

/** Kick off a single HeyGen clip; returns the video id to poll. */
async function generateClip(text: string): Promise<string> {
  const res = await fetch(`${H}/v2/video/generate`, {
    method: "POST",
    headers: { "X-Api-Key": HEYGEN_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      video_inputs: [
        {
          character: { type: "avatar", avatar_id: HEYGEN_AVATAR_ID, avatar_style: "normal" },
          voice: { type: "text", input_text: text, voice_id: HEYGEN_VOICE_ID },
        },
      ],
      dimension: { width: 1280, height: 720 },
    }),
  });
  const json = (await res.json()) as { data?: { video_id?: string }; error?: unknown };
  if (!res.ok || !json.data?.video_id) throw new Error(`HeyGen generate failed: ${res.status} ${JSON.stringify(json.error ?? json)}`);
  return json.data.video_id;
}

async function clipStatus(videoId: string): Promise<{ status: string; url: string | null }> {
  const res = await fetch(`${H}/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`, {
    headers: { "X-Api-Key": HEYGEN_KEY },
  });
  const json = (await res.json()) as { data?: { status?: string; video_url?: string } };
  return { status: json.data?.status ?? "unknown", url: json.data?.video_url ?? null };
}

/**
 * Build the segment list for a session and start generation.
 *  - HeyGen configured → kick off a clip per segment, status "generating".
 *  - Not configured → TTS-placeholder segments, immediately "ready".
 */
export async function startAvatarGeneration(sessionId: string, snapshot: WelcomeCallContent) {
  const base = narrationSegments(snapshot);
  if (!heygenConfigured()) {
    const segments: Segment[] = base.map((s) => ({ ...s, heygenVideoId: null, storageKey: null, status: "ready" }));
    await prisma.welcomeCallSession.update({ where: { id: sessionId }, data: { segments, avatarStatus: "ready" } });
    return;
  }
  const segments: Segment[] = [];
  for (const s of base) {
    try {
      const id = await generateClip(s.text);
      segments.push({ ...s, heygenVideoId: id, storageKey: null, status: "pending" });
    } catch {
      segments.push({ ...s, heygenVideoId: null, storageKey: null, status: "failed" });
    }
  }
  const anyFailed = segments.every((s) => s.status === "failed");
  await prisma.welcomeCallSession.update({
    where: { id: sessionId },
    data: { segments, avatarStatus: anyFailed ? "failed" : "generating" },
  });
}

/**
 * Poll HeyGen for any pending clips, download the finished ones into our storage,
 * and flip the session to "ready" once all clips are done. Safe to call repeatedly
 * (from the webhook OR the customer page's "preparing" poll).
 */
export async function syncAvatarSegments(sessionId: string) {
  if (!heygenConfigured()) return;
  const session = await prisma.welcomeCallSession.findUnique({ where: { id: sessionId }, select: { id: true, segments: true, avatarStatus: true } });
  if (!session || session.avatarStatus === "ready") return;

  const segments = parseSegments(session.segments);
  let changed = false;
  for (const seg of segments) {
    if (seg.status !== "pending" || !seg.heygenVideoId) continue;
    const { status, url } = await clipStatus(seg.heygenVideoId);
    if (status === "completed" && url) {
      try {
        const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
        const key = `welcome-calls/${sessionId}/${seg.key}.mp4`;
        await putObject(key, buf);
        seg.storageKey = key;
        seg.status = "ready";
      } catch {
        seg.status = "failed";
      }
      changed = true;
    } else if (status === "failed") {
      seg.status = "failed";
      changed = true;
    }
  }
  if (!changed) return;
  const allDone = segments.every((s) => s.status !== "pending");
  const anyReady = segments.some((s) => s.status === "ready");
  await prisma.welcomeCallSession.update({
    where: { id: sessionId },
    data: { segments, avatarStatus: allDone ? (anyReady ? "ready" : "failed") : "generating" },
  });
}
