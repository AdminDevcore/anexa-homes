import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { getActiveVertical } from "@/server/auth/vertical";
import { runInVertical } from "@/server/vertical/context";
import { buildNovaCtx } from "@/server/modules/nova/context";
import { createRateLimiter, novaAccess, novaEnabled } from "@/server/modules/nova/gate";
import { anthropicModel, runTurn } from "@/server/modules/nova/loop";
import { runNovaTool } from "@/server/modules/nova/tools/run";

// Nova: one spoken (or typed) request in, one answer out. The API key stays on
// the server; the browser only ever sees Nova's reply.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const limiter = createRateLimiter({ limit: 30, windowMs: 60_000 });

const bodySchema = z.object({
  text: z.string().trim().min(1).max(2000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(4000) }))
    .max(40)
    .default([]),
  pathname: z.string().max(500).nullable().default(null),
  conversationId: z.string().uuid().nullable().default(null),
});

export async function POST(req: Request) {
  const user = await getSessionUser();
  const access = novaAccess({
    enabled: novaEnabled(),
    user,
    activeVertical: user ? await getActiveVertical(user) : null,
    hasModelKey: Boolean(process.env.ANTHROPIC_API_KEY),
  });
  if (!access.ok || !user) {
    const denied = access.ok ? { status: 401, message: "Sign in to use Nova." } : access;
    return NextResponse.json({ error: denied.message }, { status: denied.status });
  }
  if (!limiter.allow(user.userId, Date.now())) {
    return NextResponse.json({ error: "Too many requests. Wait a moment and try again." }, { status: 429 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "That request wasn't understood." }, { status: 400 });
  }
  const { text, history, pathname, conversationId } = parsed.data;

  // The gate has already established the active workspace is Solar, so the
  // request's own resolution and this explicit one agree; the explicit one is
  // what holds if a caller ever reaches this code without a request scope.
  return runInVertical("solar", async () => {
    const ctx = await buildNovaCtx(user, { pathname, conversationId });
    try {
      const outcome = await runTurn(
        ctx,
        { text, history },
        { model: anthropicModel(new Anthropic({ timeout: 50_000, maxRetries: 1 })), runTool: runNovaTool }
      );
      return NextResponse.json({ conversationId: ctx.conversationId, ...outcome });
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
