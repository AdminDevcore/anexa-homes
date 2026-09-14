import type { ActiveVertical } from "@/lib/vertical";

/**
 * Nova's own switch, independent of the Solar workspace flag.
 *
 *   Enable:  NOVA_ENABLED=1   (Vercel env var, or .env.local)
 *   Disable: unset it, or set it to 0/false
 */
export function novaEnabled(): boolean {
  const v = process.env.NOVA_ENABLED;
  return v === "1" || v === "true";
}

export type NovaAccess =
  | { ok: true }
  | { ok: false; status: 401 | 404 | 409 | 503; message: string };

/**
 * Who may talk to Nova at all, before any tool runs. Order matters: with the
 * flag off the routes look like they do not exist, to anyone.
 */
export function novaAccess(input: {
  enabled: boolean;
  user: { userId: string } | null;
  activeVertical: ActiveVertical | null;
  hasModelKey: boolean;
}): NovaAccess {
  if (!input.enabled) return { ok: false, status: 404, message: "Not found." };
  if (!input.user) return { ok: false, status: 401, message: "Sign in to use Nova." };
  if (input.activeVertical !== "solar") {
    return {
      ok: false,
      status: 409,
      message: "Nova works in the Solar workspace only. Switch to Solar to use it.",
    };
  }
  if (!input.hasModelKey) {
    return { ok: false, status: 503, message: "Nova isn't set up on this server yet." };
  }
  return { ok: true };
}

/**
 * A sliding-window request counter per person.
 *
 * In memory, so on serverless it counts per instance: a brake on a stuck
 * client or a runaway loop, not a security boundary. Every call still passes
 * the full permission check whatever this says.
 */
export function createRateLimiter({ limit, windowMs }: { limit: number; windowMs: number }) {
  const hits = new Map<string, number[]>();
  return {
    allow(key: string, now: number): boolean {
      const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      const allowed = recent.length < limit;
      if (allowed) recent.push(now);
      hits.set(key, recent);
      return allowed;
    },
  };
}
