import crypto from "crypto";

// AES-256-GCM field encryption for sensitive PII (SSN, bank account, EIN),
// lender API keys, and bank-aggregator access tokens.
//
// ── TWO BLOB SHAPES ────────────────────────────────────────────────────────
//   legacy   "iv:tag:ciphertext"                    (3 parts, no key version)
//   current  "v1.<keyId>:iv:tag:ciphertext"         (4 parts, key named)
//
// Everything written from now on carries the id of the key that sealed it, so
// a key can be rotated without orphaning what came before: the old key stays
// listed, its blobs keep opening, and new blobs are sealed with the new one.
// Legacy blobs carry no id, so they are opened by trying every known key.
//
// ── THE KEYS ───────────────────────────────────────────────────────────────
// The derivation below is LOAD-BEARING FOR EXISTING DATA. Every legacy value
// in the database was sealed with sha256() of whichever of these was set at the
// time it was written. Changing a key's id, its env var, or the derivation
// would make its ciphertext undecryptable.
//
// So: do not rename an id, do not reorder WRITE_PREFERENCE in a way that
// changes which key is CURRENT without a rotation plan, and do not "improve"
// the derivation. See scratchpad/remediation/ENCRYPTION-KEY-MIGRATION-PLAN.md.
//
// FINANCE_ENC_KEY is new and is preferred for new writes. Introducing it does
// NOT orphan anything: it only changes what seals the next value, and every
// older key remains in KEY_SOURCES for reading.
const KEY_SOURCES = [
  { id: "fin", env: "FINANCE_ENC_KEY" },
  { id: "onb", env: "ONBOARDING_ENC_KEY" },
  { id: "nx", env: "NEXTAUTH_SECRET" },
  { id: "auth", env: "AUTH_SECRET" },
] as const;

type KeyId = (typeof KEY_SOURCES)[number]["id"];

const VERSION = "v1";

/**
 * The dev-only fallback.
 *
 * It is a literal in a public repository, so anything sealed with it is sealed
 * with a key the whole world has. In production at least AUTH_SECRET is always
 * set (NextAuth refuses to start without it — see server/auth/config.ts:18), so
 * this branch is unreachable there. `currentKey()` refuses rather than relying
 * on that remaining true.
 */
const DEV_FALLBACK = "anexa-dev-onboarding-key";
const DEV_KEY_ID = "dev";

function derive(secret: string): Buffer {
  return crypto.createHash("sha256").update(secret).digest();
}

/** Every key available to READ with, most-preferred first. */
function readableKeys(): { id: string; key: Buffer }[] {
  const keys: { id: string; key: Buffer }[] = [];
  for (const source of KEY_SOURCES) {
    const value = process.env[source.env];
    if (value) keys.push({ id: source.id, key: derive(value) });
  }
  if (process.env.NODE_ENV !== "production") {
    keys.push({ id: DEV_KEY_ID, key: derive(DEV_FALLBACK) });
  }
  return keys;
}

/** The key NEW values are sealed with: the first one configured. */
function currentKey(): { id: string; key: Buffer } {
  const [first] = readableKeys();
  if (first) return first;
  // Fail closed. Sealing production PII with a published constant is worse than
  // refusing to seal it at all, and this is loud where the silent version was
  // invisible.
  throw new Error(
    "Field encryption is not configured: set one of " +
      KEY_SOURCES.map((s) => s.env).join(", ") +
      ". Refusing to use the development fallback key in production."
  );
}

function keyById(id: string): Buffer | null {
  return readableKeys().find((k) => k.id === id)?.key ?? null;
}

export function encryptField(plain: string): string {
  const { id, key } = currentKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    `${VERSION}.${id}`,
    iv.toString("base64"),
    tag.toString("base64"),
    enc.toString("base64"),
  ].join(":");
}

function open(key: Buffer, ivB: string, tagB: string, encB: string): string | null {
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB, "base64"));
    decipher.setAuthTag(Buffer.from(tagB, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(encB, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

/**
 * Decrypt a stored blob, or null.
 *
 * SIGNATURE DELIBERATELY UNCHANGED. Callers treat `null` as "no key on file"
 * and say so to the user — `settings/solar-lenders/page.tsx:155`,
 * `solar/amos-actions.ts:129` and `solar/lender-submit.ts:154`. Widening the
 * return type would touch the live lender-submission path.
 *
 * A VERSIONED blob names its key, so exactly one key is tried and a failure is
 * unambiguous: that key is missing or has changed.
 *
 * A LEGACY blob names nothing, so every key is tried. That is strictly more
 * permissive than the old behaviour, which derived one key and gave up — a
 * deployment that had set ONBOARDING_ENC_KEY after writing values under
 * AUTH_SECRET could not open its own data, and it presented as "this lender has
 * no API key yet" on a lender whose key was entered months ago.
 *
 * Never logs the blob, the plaintext, the key, or any length derived from them.
 */
export function decryptField(blob: string | null | undefined, label = "field"): string | null {
  if (!blob) return null;
  const parts = blob.split(":");

  if (parts.length === 4) {
    const [stamp, ivB, tagB, encB] = parts;
    const keyId = stamp.startsWith(`${VERSION}.`) ? stamp.slice(VERSION.length + 1) : null;
    const key = keyId ? keyById(keyId) : null;
    if (!key) {
      console.error(
        `[crypto] stored ${label} was sealed with key "${keyId ?? "?"}", which is not configured ` +
          `on this deployment. Set that key's environment variable to read it. ` +
          `Callers will report this as "not configured".`
      );
      return null;
    }
    const plain = open(key, ivB, tagB, encB);
    if (plain === null) {
      console.error(
        `[crypto] stored ${label} names key "${keyId}" but will not open with it — the key's ` +
          `value has changed since this was written.`
      );
    }
    return plain;
  }

  if (parts.length === 3) {
    const [ivB, tagB, encB] = parts;
    for (const { key } of readableKeys()) {
      const plain = open(key, ivB, tagB, encB);
      if (plain !== null) return plain;
    }
    console.error(
      `[crypto] stored ${label} could not be decrypted with any configured key. It was written ` +
        `under a key this deployment no longer has — check FINANCE_ENC_KEY / ONBOARDING_ENC_KEY / ` +
        `AUTH_SECRET. Callers will report this as "not configured".`
    );
    return null;
  }

  console.error(`[crypto] stored ${label} is not a recognised encrypted value.`);
  return null;
}

/**
 * Which key sealed a blob, for operational reporting — never the plaintext.
 * `null` for a legacy blob, which names no key.
 */
export function keyIdOf(blob: string | null | undefined): KeyId | "dev" | null {
  if (!blob) return null;
  const parts = blob.split(":");
  if (parts.length !== 4) return null;
  const stamp = parts[0];
  if (!stamp.startsWith(`${VERSION}.`)) return null;
  return stamp.slice(VERSION.length + 1) as KeyId | "dev";
}

/** True when the value is sealed but not with the key new writes would use. */
export function needsRotation(blob: string | null | undefined): boolean {
  if (!blob) return false;
  const id = keyIdOf(blob);
  if (id === null) return true; // legacy, unversioned
  try {
    return id !== currentKey().id;
  } catch {
    return false;
  }
}

/** Mask all but the last `keep` characters: "•••••6789". */
export function maskTail(value: string | null | undefined, keep = 4): string {
  if (!value) return "—";
  const digits = value.replace(/\s/g, "");
  if (digits.length <= keep) return digits;
  return "•".repeat(Math.max(2, digits.length - keep)) + digits.slice(-keep);
}
