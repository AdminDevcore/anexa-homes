import OpenAI, { toFile } from "openai";
import type { PageDeal } from "./types";

/**
 * Nova's ears and voice. Server-only: the key is read here and nowhere else,
 * and the browser receives a transcript and an mp3 — see client-keys.test.ts.
 *
 *   OPENAI_API_KEY   speech-to-text and text-to-speech (optional: without it
 *                    Nova works by text and the mic is hidden)
 */

export const NOVA_STT_MODEL = "gpt-4o-mini-transcribe";
export const NOVA_TTS_MODEL = "gpt-4o-mini-tts";

/**
 * One of OpenAI's stock studio voices. Deliberately not a custom voice and not
 * modelled on any real person; the direction below only sets the delivery.
 */
export const NOVA_VOICE = "cedar";
const VOICE_DIRECTION =
  "Calm, warm and professional, like a voiceover artist reading a clear business update. " +
  "Even pace, crisp diction, friendly but never salesy. Say money, dates and times naturally.";

/** Under Vercel's request body limit, and far more than a minute of speech. */
export const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
export const MAX_SPOKEN_CHARS = 1200;

export function voiceEnabled(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

/** What the transcriber should expect to hear, so trade words and names come out right. */
export function transcriptionHint(page: PageDeal | null): string {
  const base =
    "A solar sales team talking to Nova, the assistant in their CRM. They may say: kW, kilowatts, panels, " +
    "offset, proposal, contract signed, site survey, permitting, interconnection, PTO, install, lender, " +
    "appointment, follow-up, task, lead.";
  return page ? `${base} The deal on screen is ${page.name}.` : base;
}

/** A reply as it should be read aloud: no markup, and whole sentences within the limit. */
export function speakable(text: string): string {
  const plain = text.replace(/[*#`>]+/g, "").replace(/\s+/g, " ").trim();
  if (plain.length <= MAX_SPOKEN_CHARS) return plain;
  const cut = plain.slice(0, MAX_SPOKEN_CHARS);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return end > MAX_SPOKEN_CHARS / 2 ? cut.slice(0, end + 1) : `${cut.slice(0, MAX_SPOKEN_CHARS - 1).trimEnd()}…`;
}

let client: OpenAI | null = null;
function openai(): OpenAI {
  client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 30_000, maxRetries: 1 });
  return client;
}

export async function transcribe(audio: File, hint: string): Promise<string> {
  const file = await toFile(audio, audio.name || "speech.webm", { type: audio.type || "audio/webm" });
  const result = await openai().audio.transcriptions.create({ model: NOVA_STT_MODEL, file, prompt: hint });
  return result.text.trim();
}

export async function speak(text: string): Promise<Response> {
  return openai().audio.speech.create({
    model: NOVA_TTS_MODEL,
    voice: NOVA_VOICE,
    input: speakable(text),
    instructions: VOICE_DIRECTION,
    response_format: "mp3",
  });
}
