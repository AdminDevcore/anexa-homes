/**
 * A fixed-window counter, keyed by caller.
 *
 * This exists for one surface: the public website contact form, which is the
 * only address field a stranger can reach and therefore the only one that can
 * run up a Places bill without logging in. Everything inside /portal is already
 * behind a session.
 *
 * Deliberately in-memory and therefore per serverless instance: a visitor
 * spread across three cold starts gets three windows. That is a cost guard
 * against someone holding down a key, not a defence against a determined
 * attacker — the real backstop is a daily quota cap on Places API (New) in the
 * Google Cloud console. Reaching for Redis here would buy precision nobody
 * needs for a suggestion dropdown.
 */

export type Throttle = {
  /** Record a hit; false means the caller is over the limit for this window. */
  allow: (key: string) => boolean;
  /** Callers currently tracked. Exposed so the eviction can be tested. */
  size: () => number;
};

export function createThrottle({
  limit,
  windowMs,
  clock = Date.now,
}: {
  limit: number;
  windowMs: number;
  clock?: () => number;
}): Throttle {
  const hits = new Map<string, { count: number; windowStart: number }>();

  return {
    allow(key: string): boolean {
      const now = clock();
      const entry = hits.get(key);

      if (!entry || now - entry.windowStart >= windowMs) {
        // A new window is also the only moment we can cheaply drop callers who
        // have gone quiet. Without this the map is an unbounded leak on a
        // long-lived instance, one entry per IP that ever typed an address.
        for (const [k, v] of hits) {
          if (now - v.windowStart >= windowMs) hits.delete(k);
        }
        hits.set(key, { count: 1, windowStart: now });
        return true;
      }

      if (entry.count >= limit) return false;
      entry.count += 1;
      return true;
    },
    size: () => hits.size,
  };
}
