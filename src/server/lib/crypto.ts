import crypto from "crypto";

// AES-256-GCM field encryption for sensitive PII (SSN, bank account, EIN).
// Key derives from ONBOARDING_ENC_KEY (set in prod) or falls back to the auth
// secret. The stored blob is "iv:tag:ciphertext", all base64.
function key(): Buffer {
  const secret = process.env.ONBOARDING_ENC_KEY || process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || "anexa-dev-onboarding-key";
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptField(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":");
}

export function decryptField(blob: string | null | undefined): string | null {
  if (!blob) return null;
  try {
    const [ivB, tagB, encB] = blob.split(":");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB, "base64"));
    decipher.setAuthTag(Buffer.from(tagB, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(encB, "base64")), decipher.final()]).toString("utf8");
  } catch {
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
