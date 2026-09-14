import { NextResponse } from "next/server";
import { getSessionUser, type SessionUser } from "@/server/auth/session";
import { getActiveVertical } from "@/server/auth/vertical";
import { createRateLimiter, novaAccess, novaEnabled } from "./gate";

const limiter = createRateLimiter({ limit: 30, windowMs: 60_000 });

/** The checks every Nova route runs before it reads the body. */
export async function authorizeNovaRequest(): Promise<
  { ok: true; user: SessionUser } | { ok: false; response: NextResponse }
> {
  const user = await getSessionUser();
  const access = novaAccess({
    enabled: novaEnabled(),
    user,
    activeVertical: user ? await getActiveVertical(user) : null,
    hasModelKey: Boolean(process.env.ANTHROPIC_API_KEY),
  });
  if (!access.ok || !user) {
    const denied = access.ok ? { status: 401, message: "Sign in to use Nova." } : access;
    return { ok: false, response: NextResponse.json({ error: denied.message }, { status: denied.status }) };
  }
  if (!limiter.allow(user.userId, Date.now())) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Too many requests. Wait a moment and try again." }, { status: 429 }),
    };
  }
  return { ok: true, user };
}
