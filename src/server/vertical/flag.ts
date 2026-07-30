/**
 * Master switch for the whole multi-vertical experience.
 *
 * OFF (default): the Prisma extension returns every query untouched, the
 * workspace switcher does not render, and Solar is unreachable. The roofing
 * code path is byte-for-byte the one that shipped before this work — which is
 * what makes "provably regression-free" a claim we can demonstrate by running
 * the suite with the flag off and matching the recorded baseline.
 *
 * ON: vertical scoping is enforced on every read and write, and Solar appears
 * for users granted it.
 *
 * Read per call rather than cached at module load so tests and a running dev
 * server can flip it without a restart.
 *
 *   Enable:  SOLAR_VERTICAL_ENABLED=1   (Vercel env var, or .env.local)
 *   Disable: unset it, or set it to 0/false
 */
export function solarVerticalEnabled(): boolean {
  const v = process.env.SOLAR_VERTICAL_ENABLED;
  return v === "1" || v === "true";
}
