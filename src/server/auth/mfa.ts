import { prisma } from "@/server/db/client";
import { encryptField, decryptField } from "@/server/lib/crypto";
import {
  generateSecret,
  otpauthUri,
  verifyTotp,
  generateRecoveryCodes,
  hashRecoveryCode,
} from "@/server/lib/totp";

/**
 * THE SECOND FACTOR, AND WHEN IT COUNTS.
 *
 * This exists to gate money movement. A password that has been phished, reused,
 * or left signed-in on an unlocked laptop should not be enough to send money to
 * a bank account, and every control Phase 5 builds — maker-checker, thresholds,
 * cooling-off — assumes the person approving is who they claim to be.
 *
 * ── ENROLMENT IS NOT COMPLETE UNTIL A CODE PROVES IT ────────────────────────
 * `beginEnrollment` writes a secret; `enrolledAt` stays NULL until
 * `confirmEnrollment` accepts a code generated from it. An enrolment that is
 * counted before the phone has produced a code locks people out — they scanned
 * a QR that did not save, and now the system requires a factor nobody has.
 *
 * ── THE REPLAY GUARD IS THE POINT OF `lastStep` ─────────────────────────────
 * A TOTP code is valid for its whole 30-second window. Without recording the
 * step that was consumed, the same six digits work repeatedly inside that
 * window — so a code seen over a shoulder, in a screen share, or captured by a
 * phishing prompt can be replayed. It also means ONE code could approve two
 * payments. `verifyTotp` returns the matched step precisely so it can be
 * stored, and a step that is not strictly newer than `lastStep` is refused.
 *
 * ── RECOVERY CODES ARE SINGLE USE, AND HASHED ───────────────────────────────
 * They are shown once and stored as SHA-256. They get written on paper, so they
 * must be assumed to leak from the user's side; storing them in plain text
 * would make the table a password file that also defeats the factor.
 */

const ISSUER = "Anexa";

export type MfaStatus = {
  /** A confirmed factor. Only this counts as protection. */
  enrolled: boolean;
  /** A secret exists but no code has proved it yet. */
  pending: boolean;
  recoveryCodesRemaining: number;
};

export async function mfaStatus(userId: string): Promise<MfaStatus> {
  const row = await prisma.userMfa.findUnique({
    where: { userId },
    select: {
      enrolledAt: true,
      recoveryCodes: { where: { usedAt: null }, select: { id: true } },
    },
  });
  if (!row) return { enrolled: false, pending: false, recoveryCodesRemaining: 0 };
  return {
    enrolled: row.enrolledAt !== null,
    pending: row.enrolledAt === null,
    recoveryCodesRemaining: row.recoveryCodes.length,
  };
}

export async function isMfaEnrolled(userId: string): Promise<boolean> {
  const row = await prisma.userMfa.findUnique({ where: { userId }, select: { enrolledAt: true } });
  return row?.enrolledAt != null;
}

/**
 * Start enrolment: mint a secret, store it encrypted, and hand back the URI to
 * scan.
 *
 * Starting again before confirming REPLACES the pending secret rather than
 * refusing. Somebody who scanned a QR that did not save must be able to try
 * again; refusing would strand them with a secret they do not hold.
 *
 * An already-confirmed enrolment is NOT replaced — that would let anyone with a
 * live session silently swap the factor for one they control, which is exactly
 * the attack the factor exists to stop. Resetting a confirmed factor goes
 * through `resetEnrollment`, which an owner performs.
 */
export async function beginEnrollment(args: {
  userId: string;
  companyId: string;
  accountEmail: string;
}): Promise<{ ok: true; secret: string; uri: string } | { ok: false; error: string }> {
  const existing = await prisma.userMfa.findUnique({
    where: { userId: args.userId },
    select: { id: true, enrolledAt: true },
  });
  if (existing?.enrolledAt) {
    return {
      ok: false,
      error: "This account already has an authenticator. Remove the existing one before adding another.",
    };
  }

  const secret = generateSecret();
  const secretEnc = encryptField(secret);

  if (existing) {
    await prisma.userMfa.update({
      where: { id: existing.id },
      data: { secretEnc, lastStep: null },
    });
    // A restarted enrolment invalidates codes issued against the old secret.
    await prisma.mfaRecoveryCode.deleteMany({ where: { mfaId: existing.id } });
  } else {
    await prisma.userMfa.create({
      data: { userId: args.userId, companyId: args.companyId, secretEnc },
    });
  }

  return {
    ok: true,
    secret,
    uri: otpauthUri({ secret, account: args.accountEmail, issuer: ISSUER }),
  };
}

/**
 * Finish enrolment by proving the phone holds the secret.
 *
 * Returns the recovery codes ONCE. They are never retrievable afterwards —
 * only regenerable — because a list that can be re-read is a list that can be
 * re-read by whoever borrowed the session.
 */
export async function confirmEnrollment(args: {
  userId: string;
  code: string;
}): Promise<{ ok: true; recoveryCodes: string[] } | { ok: false; error: string }> {
  const row = await prisma.userMfa.findUnique({
    where: { userId: args.userId },
    select: { id: true, secretEnc: true, enrolledAt: true },
  });
  if (!row) return { ok: false, error: "Start setting up an authenticator first." };
  if (row.enrolledAt) return { ok: false, error: "This authenticator is already set up." };

  const secret = decryptField(row.secretEnc, "mfa secret");
  if (!secret) return { ok: false, error: "This enrolment cannot be read. Start again." };

  const step = verifyTotp(secret, args.code);
  if (step === null) return { ok: false, error: "That code is not right. Check the time on your phone." };

  const { plain, hashes } = generateRecoveryCodes();

  await prisma.$transaction([
    prisma.userMfa.update({
      where: { id: row.id },
      data: { enrolledAt: new Date(), lastStep: step },
    }),
    prisma.mfaRecoveryCode.deleteMany({ where: { mfaId: row.id } }),
    prisma.mfaRecoveryCode.createMany({
      data: hashes.map((codeHash) => ({ mfaId: row.id, codeHash })),
    }),
  ]);

  return { ok: true, recoveryCodes: plain };
}

export type MfaVerification =
  | { ok: true; step: bigint | null; usedRecoveryCode: boolean }
  | { ok: false; error: string };

/**
 * Verify a code for a sensitive action.
 *
 * Accepts either six digits from the authenticator or a recovery code. The
 * shape decides which, so a mistyped recovery code is never silently tried as a
 * TOTP and reported with the wrong error.
 *
 * CONSUMES what it verifies: the TOTP step is advanced, a recovery code is
 * marked used. Callers must treat a successful verification as spent — which is
 * why the step comes back, to be recorded against whatever it authorised.
 */
export async function verifyMfa(args: {
  userId: string;
  code: string;
  at?: number;
}): Promise<MfaVerification> {
  const row = await prisma.userMfa.findUnique({
    where: { userId: args.userId },
    select: { id: true, secretEnc: true, enrolledAt: true, lastStep: true },
  });
  if (!row || !row.enrolledAt) {
    return { ok: false, error: "This account has no authenticator set up." };
  }

  const cleaned = args.code.trim();
  if (!cleaned) return { ok: false, error: "Enter the code from your authenticator." };

  if (/^\d{6}$/.test(cleaned.replace(/\s/g, ""))) {
    const secret = decryptField(row.secretEnc, "mfa secret");
    if (!secret) return { ok: false, error: "This authenticator cannot be read. Set it up again." };

    const step = verifyTotp(secret, cleaned, args.at === undefined ? {} : { at: args.at });
    if (step === null) return { ok: false, error: "That code is not right." };

    // THE REPLAY GUARD. A code is good for 30 seconds, so without this the same
    // six digits authorise repeatedly — including approving two payments.
    if (row.lastStep !== null && step <= row.lastStep) {
      return { ok: false, error: "That code has already been used. Wait for the next one." };
    }

    await prisma.userMfa.update({ where: { id: row.id }, data: { lastStep: step } });
    return { ok: true, step, usedRecoveryCode: false };
  }

  // Otherwise treat it as a recovery code.
  const hash = hashRecoveryCode(cleaned);
  const match = await prisma.mfaRecoveryCode.findFirst({
    where: { mfaId: row.id, codeHash: hash },
    select: { id: true, usedAt: true },
  });
  if (!match) return { ok: false, error: "That code is not right." };
  if (match.usedAt) return { ok: false, error: "That recovery code has already been used." };

  // `updateMany` with the usedAt guard, so two requests racing the same code
  // cannot both spend it — the second updates zero rows.
  const spent = await prisma.mfaRecoveryCode.updateMany({
    where: { id: match.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (spent.count === 0) return { ok: false, error: "That recovery code has already been used." };

  return { ok: true, step: null, usedRecoveryCode: true };
}

/**
 * Issue a fresh set of recovery codes, invalidating the old ones.
 *
 * Requires a current code: otherwise a borrowed session could mint itself a
 * permanent way back in without ever holding the factor.
 */
export async function regenerateRecoveryCodes(args: {
  userId: string;
  code: string;
  /**
   * Threaded through to `verifyMfa`. A control whose behaviour depends on the
   * clock cannot be proved without a seam for the clock — and confirming an
   * enrolment already spends the current step, so a test necessarily works in a
   * later window than "now".
   */
  at?: number;
}): Promise<{ ok: true; recoveryCodes: string[] } | { ok: false; error: string }> {
  const verified = await verifyMfa(
    args.at === undefined
      ? { userId: args.userId, code: args.code }
      : { userId: args.userId, code: args.code, at: args.at }
  );
  if (!verified.ok) return verified;

  const row = await prisma.userMfa.findUnique({ where: { userId: args.userId }, select: { id: true } });
  if (!row) return { ok: false, error: "This account has no authenticator set up." };

  const { plain, hashes } = generateRecoveryCodes();
  await prisma.$transaction([
    prisma.mfaRecoveryCode.deleteMany({ where: { mfaId: row.id } }),
    prisma.mfaRecoveryCode.createMany({
      data: hashes.map((codeHash) => ({ mfaId: row.id, codeHash })),
    }),
  ]);
  return { ok: true, recoveryCodes: plain };
}

/**
 * Remove a confirmed factor — the lost-phone path.
 *
 * Deliberately takes the acting user separately from the subject: this is an
 * OWNER action performed for somebody else, and the caller is responsible for
 * checking that. A user cannot quietly remove their own factor, because then
 * anyone with a live session could strip the control before moving money.
 */
export async function resetEnrollment(args: {
  userId: string;
  actorUserId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (args.userId === args.actorUserId) {
    return {
      ok: false,
      error: "Ask an owner to remove your authenticator. You cannot remove your own.",
    };
  }
  await prisma.userMfa.deleteMany({ where: { userId: args.userId } });
  return { ok: true };
}
