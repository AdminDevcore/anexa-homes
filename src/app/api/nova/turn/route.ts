import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { z } from "zod";
import { runInVertical } from "@/server/vertical/context";
import { classifyConfirmation } from "@/server/modules/nova/confirmation";
import { buildNovaCtx } from "@/server/modules/nova/context";
import { anthropicModel, runTurn } from "@/server/modules/nova/loop";
import { cancelPendingAction, confirmPendingAction } from "@/server/modules/nova/pending";
import { authorizeNovaRequest } from "@/server/modules/nova/request";
import { runNovaTool } from "@/server/modules/nova/tools/run";

// Nova: one spoken (or typed) request in, one answer out. The API key stays on
// the server; the browser only ever sees Nova's reply.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({
  text: z.string().trim().min(1).max(2000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(4000) }))
    .max(40)
    .default([]),
  pathname: z.string().max(500).nullable().default(null),
  conversationId: z.string().uuid().nullable().default(null),
  /** The write Nova last read out, if the user is answering it. */
  pendingActionId: z.string().uuid().nullable().default(null),
});

export async function POST(req: Request) {
  const auth = await authorizeNovaRequest();
  if (!auth.ok) return auth.response;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "That request wasn't understood." }, { status: 400 });
  }
  const { text, history, pathname, conversationId, pendingActionId } = parsed.data;

  // The gate has already established the active workspace is Solar, so the
  // request's own resolution and this explicit one agree; the explicit one is
  // what holds if a caller ever reaches this code without a request scope.
  return runInVertical("solar", async () => {
    const ctx = await buildNovaCtx(auth.user, { pathname, conversationId });
    const reply = (out: object) => NextResponse.json({ conversationId: ctx.conversationId, ...out });
    try {
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
        { model: anthropicModel(new Anthropic({ timeout: 50_000, maxRetries: 1 })), runTool: runNovaTool }
      );
      return reply(outcome);
    } catch (e) {
      const modelDown = e instanceof Anthropic.APIError;
      console.error(modelDown ? "[nova] model call failed" : "[nova] turn failed", e);
      return NextResponse.json(
        {
          conversationId: ctx.conversationId,
          kind: "error",
          reply: modelDown
            ? "I couldn't reach my language model just now, so I don't have an answer. Try again in a moment."
            : "Something went wrong on the server, so I don't have an answer.",
          tools: [],
        },
        { status: modelDown ? 502 : 500 }
      );
    }
  });
}
