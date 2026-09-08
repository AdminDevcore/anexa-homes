import crypto from "crypto";

// AES-256-GCM field encryption for sensitive PII (SSN, bank account, EIN) and
// for lender API keys. The stored blob is "iv:tag:ciphertext", all base64.
//
// ── THE KEY ────────────────────────────────────────────────────────────────
// The derivation below is LOAD-BEARING FOR EXISTING DATA. Every value already
// in the database was sealed with sha256() of whichever of these was set at the
// time it was written, in this order. Changing the order, adding a salt, or
// switching to a KDF would make every existing ciphertext undecryptable, and
// `decryptField` would report it as "no value" rather than as a failure.
//
// So: do not reorder, do not "improve" the derivation, and do not introduce
// ONBOARDING_ENC_KEY into an environment that has been running without it
// without following scratchpad/remediation/ENCRYPTION-KEY-MIGRATION-PLAN.md —
// on a deployment whose data was written under AUTH_SECRET, simply setting
// ONBOARDING_ENC_KEY silently orphans every stored secret.
const KEY_SOURCES = ["ONBOARDING_ENC_KEY", "NEXTAUTH_SECRET", "AUTH_SECRET"] as const;

/**
 * The dev-only fallback.
 *
 * It is a literal in a public repository, so anything sealed with it is sealed
 * with a key the whole world has. In production at least AUTH_SECRET is always
 * set (NextAuth refuses to start without it — see server/auth/config.ts:18), so
 * this branch is unreachable there today. `key()` now refuses rather than
 * relying on that remaining true.
 */
const DEV_FALLBACK = "anexa-dev-onboarding-key";

function key(): Buffer {
  for (const name of KEY_SOURCES) {
    const value = process.env[name];
    if (value) return crypto.createHash("sha256").update(value).digest();
  }
  if (process.env.NODE_ENV === "production") {
    // Fail closed. Sealing production PII with a published constant is worse
    // than refusing to seal it at all, and this is loud where the silent
    // version was invisible.
    throw new Error(
      "Field encryption is not configured: set one of " +
        KEY_SOURCES.join(", ") +
        ". Refusing to use the development fallback key in production."
    );
  }
  return crypto.createHash("sha256").update(DEV_FALLBACK).digest();
}

export function encryptField(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":");
}

/**
 * Decrypt a stored blob, or null.
 *
 * SIGNATURE DELIBERATELY UNCHANGED. Three callers treat `null` as "no key on
 * file" and say so to the user — `settings/solar-lenders/page.tsx:155`,
 * `solar/amos-actions.ts:129` and `solar/lender-submit.ts:154`. Widening the
 * return type would touch the live lender-submission path, which is not this
 * pass's to change.
 *
 * What IS new: a blob that exists but will not open is no longer
 * indistinguishable from an empty column. That case means the key moved —
 * somebody set ONBOARDING_ENC_KEY on a deployment whose data was written under
 * AUTH_SECRET, or rotated AUTH_SECRET itself — and it presents to an admin as
 * "this lender has no API key yet" on a lender whose key was entered months
 * ago. It now leaves a line in the platform log saying which field failed.
 *
 * Never logs the blob, the plaintext, the key, or any length derived from them.
 */
export function decryptField(blob: string | null | undefined, label = "field"): string | null {
  if (!blob) return null;
  try {
    const [ivB, tagB, encB] = blob.split(":");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB, "base64"));
    decipher.setAuthTag(Buffer.from(tagB, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(encB, "base64")), decipher.final()]).toString("utf8");
  } catch {
    console.error(
      `[crypto] stored ${label} could not be decrypted. The encryption key does not match the one ` +
        `this value was written with — check ONBOARDING_ENC_KEY / AUTH_SECRET on this deployment. ` +
        `Callers will report this as "not configured".`
    );
    return null;
  }
}

/** Mask all but the last `keep` characters: "•••••6789". */
export function maskTail(value: string | null | undefined, keep = 4): string {
  if (!value) return "—";
  const digits = value.replace(/\s/g, "");
  if (digits.length <= keep) return digits;
  return "•".repeat(Math.max(2, digits.length - keep)) + digits.slice(-keep);
}
