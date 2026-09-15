import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { z } from "zod";
import { runInVertical } from "@/server/vertical/context";
import { classifyConfirmation } from "@/server/modules/nova/confirmation";
import { buildNovaCtx } from "@/server/modules/nova/context";
import { runTurn } from "@/server/modules/nova/loop";
import { novaModel } from "@/server/modules/nova/model";
import { cancelPendingAction, confirmPendingAction } from "@/server/modules/nova/pending";
import { authorizeNovaRequest } from "@/server/modules/nova/request";
import { runNovaTool } from "@/server/modules/nova/tools/run";
import { MAX_AUDIO_BYTES, transcribe, transcriptionHint, voiceEnabled } from "@/server/modules/nova/voice";

// Nova: one spoken or typed request in, one answer out. Speech is transcribed
// and the model is called here, on the server; the browser only ever sees the
// transcript and Nova's reply.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const contextSchema = z.object({
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(4000) }))
    .max(40)
    .default([]),
  pathname: z.string().max(500).nullable().default(null),
  conversationId: z.string().uuid().nullable().default(null),
  /** The write Nova last read out, if the user is answering it. */
  pendingActionId: z.string().uuid().nullable().default(null),
});
const textSchema = contextSchema.extend({ text: z.string().trim().min(1).max(2000) });

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function POST(req: Request) {
  const auth = await authorizeNovaRequest();
  if (!auth.ok) return auth.response;

  // A spoken request arrives as a recording plus the same JSON a typed one sends.
  let audio: File | null = null;
  let body: z.infer<typeof contextSchema> & { text?: string };
  if ((req.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
    if (!voiceEnabled()) return bad("Nova's voice isn't set up on this server. Type instead.", 503);
    const form = await req.formData().catch(() => null);
    const file = form?.get("audio");
    if (!(file instanceof File) || file.size === 0) return bad("That recording was empty.");
    if (file.size > MAX_AUDIO_BYTES) return bad("That recording is too long. Keep it to under a minute.", 413);
    let payload: unknown = null;
    try {
      payload = JSON.parse(String(form?.get("payload") ?? "{}"));
    } catch {
      return bad("That request wasn't understood.");
    }
    const parsed = contextSchema.safeParse(payload);
    if (!parsed.success) return bad("That request wasn't understood.");
    audio = file;
    body = parsed.data;
  } else {
    const parsed = textSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return bad("That request wasn't understood.");
    body = parsed.data;
  }
  const { history, pathname, conversationId, pendingActionId } = body;

  // The gate has already established the active workspace is Solar, so the
  // request's own resolution and this explicit one agree; the explicit one is
  // what holds if a caller ever reaches this code without a request scope.
  return runInVertical("solar", async () => {
    const ctx = await buildNovaCtx(auth.user, { pathname, conversationId });
    let transcript: string | undefined;
    const reply = (out: object, status = 200) =>
      NextResponse.json(
        { conversationId: ctx.conversationId, ...(transcript !== undefined ? { transcript } : {}), ...out },
        { status }
      );

    try {
      let text = body.text ?? "";
      if (audio) {
        try {
          transcript = await transcribe(audio, transcriptionHint(ctx.page));
        } catch (e) {
          console.error("[nova] transcription failed", e);
          transcript = "";
          return reply(
            { kind: "error", reply: "I couldn't make out that recording because the speech service failed. Try again, or type instead.", tools: [] },
            502
          );
        }
        if (!transcript) {
          return reply({ kind: "error", reply: "I didn't catch anything. Hold the mic button down while you talk.", tools: [] });
        }
        text = transcript.slice(0, 2000);
      }

      // Answering a proposed write: only a plain yes confirms it. A no cancels
      // it; anything else cancels it too and is handled as a new request — so
      // "yes, but make it three" books nothing until the new time is read back.
      if (pendingActionId) {
        const answer = classifyConfirmation(text);
        if (answer === "yes") return reply(await confirmPendingAction(ctx, pendingActionId));
        const cancelled = await cancelPendingAction(ctx, pendingActionId);
        if (answer === "no") return reply(cancelled);
      }

      const outcome = await runTurn(
        ctx,
        { text, history },
        { model: novaModel(), runTool: runNovaTool }
      );
      return reply(outcome);
    } catch (e) {
      const modelDown = e instanceof Anthropic.APIError;
      console.error(modelDown ? "[nova] model call failed" : "[nova] turn failed", e);
      return reply(
        {
          kind: "error",
          reply: modelDown
            ? "I couldn't reach my language model just now, so I don't have an answer. Try again in a moment."
            : "Something went wrong on the server, so I don't have an answer.",
          tools: [],
        },
        modelDown ? 502 : 500
      );
    }
  });
}
