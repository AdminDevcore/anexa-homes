/**
 * Who a Google identity is allowed to sign in as.
 *
 * Google is identity PROOF, not a signup mechanism. The User row must already
 * exist — created by an admin on the Team page — and signing in attaches that
 * Google identity to it. Nothing here ever creates a user, so somebody with a
 * Google account and the login URL still cannot get in.
 *
 * The decision is pure and lives here rather than in the Auth.js callback so it
 * can be tested without a database or an OAuth round trip. `src/server/auth/
 * google.ts` supplies the rows and applies the result.
 */
import { isStaff } from "@/server/rbac/matrix";

/**
 * Statuses that may sign in.
 *
 * `invited` is included deliberately: a Google sign-in is a legitimate way to
 * accept an invite, and the credentials path already admits `invited` too.
 * These two MUST agree — a status admitted by one and refused by the other is
 * an account that can sign in one way and not the other, with no explanation.
 */
export const SIGN_IN_STATUSES = ["active", "invited"] as const;

/**
 * Why a sign-in was refused. Each maps to its own sentence on the login page:
 * one generic "access denied" for every cause is what makes this class of
 * failure impossible to diagnose from the outside.
 */
export type GoogleDenialReason =
  | "google_email_missing"
  | "google_email_unverified"
  | "google_domain_not_allowed"
  | "no_account"
  | "account_inactive"
  | "account_not_staff"
  | "account_ambiguous";

export type GoogleCandidate = {
  id: string;
  email: string;
  status: string;
  role: string;
};

export type GoogleAttempt = {
  email: string | null | undefined;
  /** `email_verified` from the Google profile. */
  emailVerified?: boolean | null;
  /** `hd` from the Google profile — the Workspace domain, absent for @gmail. */
  hostedDomain?: string | null;
  /** When set, only this Workspace domain may sign in. */
  requiredHostedDomain?: string | null;
};

export type GoogleDecision =
  | { ok: true; userId: string }
  | { ok: false; reason: GoogleDenialReason };

export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

/**
 * Checks that can be made before touching the database. Returns the normalized
 * email when the attempt is worth looking up, or the reason it is not.
 */
export function screenGoogleAttempt(
  attempt: GoogleAttempt
): { ok: true; email: string } | { ok: false; reason: GoogleDenialReason } {
  const email = normalizeEmail(attempt.email);
  if (!email) return { ok: false, reason: "google_email_missing" };

  // Google states whether it has verified the address. An unverified one is not
  // identity proof: without this, whoever controls a Google account on an
  // unverified address could claim the staff account holding it.
  if (attempt.emailVerified === false) {
    return { ok: false, reason: "google_email_unverified" };
  }

  // Optional Workspace restriction, e.g. only @anexahomes.com. `hd` is absent
  // for consumer accounts, so a personal Gmail fails this by construction.
  if (attempt.requiredHostedDomain && attempt.hostedDomain !== attempt.requiredHostedDomain) {
    return { ok: false, reason: "google_domain_not_allowed" };
  }

  return { ok: true, email };
}

/**
 * Pick the one user a verified Google address corresponds to.
 *
 * Matching is case-insensitive, because `User` is keyed `@@unique([companyId,
 * email])` on the raw string — nothing stops `Dana@x.com` and `dana@x.com` from
 * both existing, and Google hands back whatever casing the address was
 * registered with. An exact-match-only lookup silently fails to find a real
 * account, which from the outside is indistinguishable from having none.
 *
 * `candidates` must already be the case-insensitive matches for `email`.
 */
export function decideGoogleSignIn(
  email: string,
  candidates: GoogleCandidate[]
): GoogleDecision {
  if (candidates.length === 0) return { ok: false, reason: "no_account" };

  const signable = candidates.filter((c) =>
    (SIGN_IN_STATUSES as readonly string[]).includes(c.status)
  );
  // Rows exist but none may sign in — a disabled or suspended account, which is
  // a different answer for the person than "there is no account here".
  if (signable.length === 0) return { ok: false, reason: "account_inactive" };

  // Staff only, matching the credentials path exactly. A row carrying a retired
  // role (`customer`, from before homeowner accounts were dropped) is refused
  // here, which is what keeps "there is no customer portal" a property of the
  // system rather than a missing button.
  const staff = signable.filter((c) => isStaff(c.role as never));
  if (staff.length === 0) return { ok: false, reason: "account_not_staff" };

  if (staff.length === 1) return { ok: true, userId: staff[0]!.id };

  // Several still match — the same address in two companies, or two rows
  // differing only by letter case. An exact match on the normalized address
  // breaks the tie; otherwise refuse rather than guess, because picking one of
  // two accounts would be authenticating as the wrong person.
  const exact = staff.filter((c) => c.email === email);
  if (exact.length === 1) return { ok: true, userId: exact[0]!.id };
  return { ok: false, reason: "account_ambiguous" };
}

/** What the login page says for each refusal. */
export const GOOGLE_ERROR_COPY: Record<GoogleDenialReason, string> = {
  google_email_missing: "Google did not share an email address for that account.",
  google_email_unverified: "That Google address is not verified. Verify it with Google and try again.",
  google_domain_not_allowed: "Use your work Google account to sign in.",
  no_account: "No Anexa account uses that email address. Ask an admin to add you to the team first.",
  account_inactive: "That account is not active. Ask an admin to re-enable it.",
  account_not_staff: "That account cannot sign in to the team portal.",
  account_ambiguous: "That email matches more than one account. Contact an admin to sort it out.",
};
