import { timingSafeEqual } from "node:crypto";

/**
 * Machine authentication for the scheduled and ingest endpoints.
 *
 * WHY THIS EXISTS. Every cron route used to carry its own copy of:
 *
 *     const secret = process.env.CRON_SECRET;
 *     if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) → 401
 *
 * which authenticates nobody when `CRON_SECRET` is unset — the `secret &&`
 * short-circuits and the handler runs. Eleven endpoints shared that shape,
 * including two that spend money per call (`enrich-owners` bills a skip-trace
 * lookup, `geocode-leads` bills Google), one that WRITES rows from an
 * unauthenticated body (`storm/swaths/ingest`), and four that send mail to every
 * manager in the company. `CRON_SECRET` was also undocumented in
 * `.env.example`, so an environment could reach production without it and
 * nothing would say so.
 *
 * The rule now: **no secret configured means no cron runs.** A misconfigured
 * server is a server that refuses, not one that opens.
 *
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` for every entry in
 * `vercel.json` when the variable is set on the project, so the wire contract is
 * unchanged — only the failure mode is.
 */

/** Distinct from 401 on purpose: 503 is OUR fault, 401 is the caller's. */
const MISCONFIGURED = "Cron is not configured on this deployment.";

function bearerMatches(header: string | null, secret: string): boolean {
  if (!header) return false;
  const expected = `Bearer ${secret}`;
  // Length is compared first because timingSafeEqual throws on a length
  // mismatch; the early return leaks only the length, which the format already
  // gives away.
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Authorise a cron / machine request.
 *
 * Returns a `Response` the handler must return immediately, or `null` when the
 * request is authorised. Fails closed in all three ways it can fail:
 *
 *   1. `CRON_SECRET` unset or blank  → 503 (this deployment cannot run crons)
 *   2. no `Authorization` header      → 401
 *   3. wrong secret                   → 401
 *
 * Never echoes the secret, the supplied header, or their lengths.
 */
export function assertCronRequest(req: Request): Response | null {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    // Loud in the platform log, silent to the caller: an operator reading
    // Vercel's function logs needs to know why every cron is 503-ing.
    console.error(
      "[cron] refused: CRON_SECRET is not set. Set it on the deployment — see .env.example."
    );
    return new Response(MISCONFIGURED, { status: 503 });
  }
  if (!bearerMatches(req.headers.get("authorization"), secret)) {
    return new Response("Unauthorized", { status: 401 });
  }
  return null;
}
