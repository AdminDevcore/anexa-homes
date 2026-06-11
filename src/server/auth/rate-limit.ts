// Simple in-memory login throttle: caps failed attempts per identifier within a
// rolling window. Sufficient for a single instance; for multi-instance
// deployments back this with Redis/Upstash using the same interface.

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

type Bucket = { count: number; firstAt: number };
const buckets = new Map<string, Bucket>();

function keyFor(id: string) {
  return id.toLowerCase().trim();
}

/** Returns true if this identifier is currently allowed to attempt a login. */
export function isLoginAllowed(identifier: string): boolean {
  const b = buckets.get(keyFor(identifier));
  if (!b) return true;
  if (Date.now() - b.firstAt > WINDOW_MS) {
    buckets.delete(keyFor(identifier));
    return true;
  }
  return b.count < MAX_FAILURES;
}

export function recordFailedLogin(identifier: string): void {
  const k = keyFor(identifier);
  const now = Date.now();
  const b = buckets.get(k);
  if (!b || now - b.firstAt > WINDOW_MS) {
    buckets.set(k, { count: 1, firstAt: now });
  } else {
    b.count += 1;
  }
}

export function clearLoginAttempts(identifier: string): void {
  buckets.delete(keyFor(identifier));
}
