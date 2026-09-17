"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "./session";
import { beginEnrollment, confirmEnrollment, regenerateRecoveryCodes } from "./mfa";

/**
 * ENROLLING A SECOND FACTOR.
 *
 * Why this file had to exist. `approvePayment` requires a TOTP code, `verifyMfa`
 * requires an enrolled factor, and until now NOTHING in the product could enrol
 * one — every caller of `beginEnrollment` and `confirmEnrollment` was a test. So
 * no payment could ever be approved, and since sending requires approval, no
 * payment could ever be sent. The whole of Phase 5 was unreachable in
 * production, and a payments screen without this would have shipped an approve
 * button that cannot succeed.
 *
 * THE SECURITY PROPERTY: no export here takes a `userId`. It is read from the
 * session every time, so the worst an authenticated caller can do is re-enrol
 * THEIR OWN account. An endpoint that accepted a user id would let anyone with
 * a session reset a colleague's second factor — and this is a public RPC route,
 * so that is not hypothetical.
 *
 * Deliberately NOT gated on a resource. A second factor protects the account
 * that owns it, so enrolling one is not a permission anybody needs to be
 * granted; `requireUser` is the whole check. Removing SOMEONE ELSE'S factor is a
 * different act with a different blast radius — `resetEnrollment` refuses
 * self-removal by design — and belongs with team administration, not here.
 */

function fail(error: string) {
  return { ok: false as const, error };
}

/**
 * Start setting up an authenticator, and return what the app needs to hold the
 * secret. The secret crosses the wire exactly once, at the moment the person
 * asks to see it; it is never readable again afterwards.
 */
export async function beginMfaEnrollmentAction() {
  const user = await requireUser();

  // The account label shown inside the authenticator app. Email when we have
  // one, otherwise something that still identifies the account rather than a
  // blank entry the person cannot tell apart from a colleague's.
  const accountEmail = user.email?.trim() || `${user.fullName || user.userId} · ${user.companySlug}`;

  const res = await beginEnrollment({
    userId: user.userId,
    companyId: user.companyId,
    accountEmail,
  });
  if (!res.ok) return res;

  return { ok: true as const, secret: res.secret, uri: res.uri };
}

const codeSchema = z.object({
  /** Six digits from the app, or a recovery code. */
  code: z.string().min(6).max(20),
});

/**
 * Finish enrolment by proving the phone holds the secret.
 *
 * Returns the recovery codes ONCE. They are not retrievable afterwards, only
 * regenerable, so the screen has to show them at this moment or not at all.
 */
export async function confirmMfaEnrollmentAction(input: z.infer<typeof codeSchema>) {
  const user = await requireUser();
  const parsed = codeSchema.safeParse(input);
  if (!parsed.success) return fail("Enter the six-digit code from your authenticator.");

  const res = await confirmEnrollment({ userId: user.userId, code: parsed.data.code });
  if (!res.ok) return res;

  revalidatePath("/portal/books/payments");
  return { ok: true as const, recoveryCodes: res.recoveryCodes };
}

/**
 * Issue a fresh set of recovery codes, spending a real one to do it.
 *
 * Requires a current code because the old list is invalidated: someone who has
 * borrowed the session but not the phone must not be able to lock the owner out
 * and walk away with a usable list.
 */
export async function regenerateMfaRecoveryCodesAction(input: z.infer<typeof codeSchema>) {
  const user = await requireUser();
  const parsed = codeSchema.safeParse(input);
  if (!parsed.success) return fail("Enter a code from your authenticator.");

  const res = await regenerateRecoveryCodes({ userId: user.userId, code: parsed.data.code });
  if (!res.ok) return res;

  revalidatePath("/portal/books/payments");
  return { ok: true as const, recoveryCodes: res.recoveryCodes };
}
