import { prisma } from "@/server/db/client";
import {
  decideGoogleSignIn,
  screenGoogleAttempt,
  type GoogleAttempt,
  type GoogleDecision,
} from "@/lib/google-signin";

/**
 * The database half of the Google sign-in gate. The decision itself is pure and
 * lives in `src/lib/google-signin.ts`, where it is unit-tested.
 *
 * Deliberately hand-rolled rather than `@auth/prisma-adapter`: there is no
 * `Account`, `Session` or `VerificationToken` model in this schema for an
 * adapter to write to, and `getUserByEmail` would fail outright anyway because
 * `User` is keyed `@@unique([companyId, email])` with no standalone unique on
 * `email`. Sessions here are JWTs, so the adapter was never load-bearing.
 */

/** Only this Google Workspace domain may sign in, when set. */
export const REQUIRED_HOSTED_DOMAIN = process.env.GOOGLE_ALLOWED_HD?.trim() || null;

/**
 * True when the Google provider is configured. The login page reads this to
 * decide whether to offer the button — a provider with no credentials would
 * throw on boot, and a button that always fails is worse than no button.
 */
export const isGoogleEnabled = Boolean(
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
);

export async function authorizeGoogleSignIn(attempt: GoogleAttempt): Promise<GoogleDecision> {
  const screened = screenGoogleAttempt({ ...attempt, requiredHostedDomain: REQUIRED_HOSTED_DOMAIN });
  if (!screened.ok) return screened;

  const candidates = await prisma.user.findMany({
    where: { email: { equals: screened.email, mode: "insensitive" } },
    select: { id: true, email: true, status: true, role: true },
  });

  const decision = decideGoogleSignIn(screened.email, candidates);

  // Same bookkeeping the credentials path does, and best-effort for the same
  // reason: a failed timestamp write is not worth refusing a valid sign-in.
  if (decision.ok) {
    await prisma.user
      .update({ where: { id: decision.userId }, data: { lastLoginAt: new Date() } })
      .catch(() => {});
  }
  return decision;
}

/**
 * The claims a Google sign-in needs stamped onto its token.
 *
 * Auth.js hands the jwt callback a user built from the GOOGLE profile, whose
 * `id` is Google's `sub` — not our row id, and carrying none of our
 * authorization data. Without this the session would have no company and no
 * role, and every page would treat it as a stranger.
 */
export async function googleTokenClaims(email: string | null | undefined) {
  const normalized = (email ?? "").trim().toLowerCase();
  if (!normalized) return null;
  const candidates = await prisma.user.findMany({
    where: { email: { equals: normalized, mode: "insensitive" } },
    select: {
      id: true,
      email: true,
      status: true,
      role: true,
      companyId: true,
      firstName: true,
      lastName: true,
      sessionVersion: true,
      company: { select: { slug: true } },
    },
  });
  const decision = decideGoogleSignIn(normalized, candidates);
  if (!decision.ok) return null;
  const user = candidates.find((c) => c.id === decision.userId);
  if (!user) return null;
  return {
    userId: user.id,
    companyId: user.companyId,
    companySlug: user.company.slug,
    role: user.role,
    sessionVersion: user.sessionVersion,
    name: `${user.firstName} ${user.lastName}`.trim(),
  };
}
