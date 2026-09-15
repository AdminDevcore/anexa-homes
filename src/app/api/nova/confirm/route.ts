import { NextResponse } from "next/server";
import { z } from "zod";
import { runInVertical } from "@/server/vertical/context";
import { buildNovaCtx } from "@/server/modules/nova/context";
import { cancelPendingAction, confirmPendingAction } from "@/server/modules/nova/pending";
import { authorizeNovaRequest } from "@/server/modules/nova/request";

// The Confirm and Cancel buttons under a write Nova has read out.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  pendingActionId: z.string().uuid(),
  decision: z.enum(["confirm", "cancel"]),
  conversationId: z.string().uuid().nullable().default(null),
});

export async function POST(req: Request) {
  const auth = await authorizeNovaRequest();
  if (!auth.ok) return auth.response;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "That request wasn't understood." }, { status: 400 });
  }
  const { pendingActionId, decision, conversationId } = parsed.data;

  return runInVertical("solar", async () => {
    const ctx = await buildNovaCtx(auth.user, { pathname: null, conversationId });
    try {
      const out =
        decision === "confirm"
          ? await confirmPendingAction(ctx, pendingActionId)
          : await cancelPendingAction(ctx, pendingActionId);
      return NextResponse.json({ conversationId: ctx.conversationId, ...out });
    } catch (e) {
      console.error("[nova] confirmation failed", e);
      return NextResponse.json(
        {
          conversationId: ctx.conversationId,
          kind: "error",
          reply: "Something went wrong on the server. I can't tell whether that change was made, so check the deal before trying again.",
          tools: [],
        },
        { status: 500 }
      );
    }
  });
}
