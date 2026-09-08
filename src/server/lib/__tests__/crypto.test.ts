import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "crypto";
import { encryptField, decryptField, maskTail } from "../crypto";

/**
 * These tests exist to pin the two properties that protect DATA AT REST:
 *
 *   1. the ciphertext format and key derivation are unchanged, so every value
 *      already in the database still opens;
 *   2. a value that will NOT open is reported, not swallowed.
 *
 * The "known ciphertext" case is the important one. It is sealed here with the
 * exact derivation the shipped code uses — sha256 of the raw env value, AES-256-GCM,
 * "iv:tag:ct" base64 — so any future change to `key()` or to the blob format
 * fails this test instead of silently orphaning production PII and lender keys.
 */

const KEY_VARS = ["ONBOARDING_ENC_KEY", "NEXTAUTH_SECRET", "AUTH_SECRET"] as const;

/** Seal a value the way a previous deployment would have, given a raw secret. */
function sealWith(secret: string, plain: string): string {
  const key = crypto.createHash("sha256").update(secret).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    enc.toString("base64"),
  ].join(":");
}

// `vi.stubEnv` rather than assigning `process.env.*` directly: NODE_ENV is typed
// read-only by the Next.js ambient types, and stubbing is undone for every key
// at once by `vi.unstubAllEnvs()` so one case cannot leak into the next.
describe("field encryption", () => {
  beforeEach(() => {
    // Start every case from "no key configured at all", whatever the developer
    // happens to have in their .env.
    for (const v of KEY_VARS) vi.stubEnv(v, "");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("round-trips a value", () => {
    vi.stubEnv("AUTH_SECRET", "some-auth-secret");
    const blob = encryptField("123-45-6789");
    expect(blob).not.toContain("123-45-6789");
    expect(decryptField(blob)).toBe("123-45-6789");
  });

  it("produces the documented iv:tag:ciphertext base64 shape", () => {
    vi.stubEnv("AUTH_SECRET", "some-auth-secret");
    const parts = encryptField("x").split(":");
    expect(parts).toHaveLength(3);
    // 12-byte IV and 16-byte GCM tag, base64-encoded.
    expect(Buffer.from(parts[0], "base64")).toHaveLength(12);
    expect(Buffer.from(parts[1], "base64")).toHaveLength(16);
  });

  it("opens a blob sealed by a previous deployment under AUTH_SECRET", () => {
    // The compatibility guarantee, stated as a test: data written before this
    // pass must still open after it.
    const legacy = sealWith("prod-auth-secret", "ak_live_lender_key");
    vi.stubEnv("AUTH_SECRET", "prod-auth-secret");
    expect(decryptField(legacy)).toBe("ak_live_lender_key");
  });

  it("prefers ONBOARDING_ENC_KEY, then NEXTAUTH_SECRET, then AUTH_SECRET", () => {
    const underOnboarding = sealWith("k-onboarding", "v");
    const underNextauth = sealWith("k-nextauth", "v");
    const underAuth = sealWith("k-auth", "v");

    vi.stubEnv("AUTH_SECRET", "k-auth");
    expect(decryptField(underAuth)).toBe("v");

    vi.stubEnv("NEXTAUTH_SECRET", "k-nextauth");
    expect(decryptField(underNextauth)).toBe("v");
    expect(decryptField(underAuth)).toBeNull(); // AUTH_SECRET no longer wins

    vi.stubEnv("ONBOARDING_ENC_KEY", "k-onboarding");
    expect(decryptField(underOnboarding)).toBe("v");
    expect(decryptField(underNextauth)).toBeNull();
  });

  it("returns null WITHOUT logging for an absent value", () => {
    vi.stubEnv("AUTH_SECRET", "s");
    expect(decryptField(null)).toBeNull();
    expect(decryptField(undefined)).toBeNull();
    expect(decryptField("")).toBeNull();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("logs when a PRESENT blob will not open — the key-moved case", () => {
    const sealedElsewhere = sealWith("the-old-key", "ak_live_lender_key");
    vi.stubEnv("AUTH_SECRET", "a-different-key");

    expect(decryptField(sealedElsewhere, "SolarLender.apiKeyEncrypted")).toBeNull();
    expect(console.error).toHaveBeenCalledTimes(1);

    const logged = (console.error as unknown as { mock: { calls: string[][] } }).mock.calls[0][0];
    expect(logged).toContain("SolarLender.apiKeyEncrypted");
    // …and it must never leak the material itself.
    expect(logged).not.toContain("ak_live_lender_key");
    expect(logged).not.toContain("the-old-key");
    expect(logged).not.toContain("a-different-key");
    expect(logged).not.toContain(sealedElsewhere);
  });

  it("refuses the published dev fallback key in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => encryptField("x")).toThrow(/not configured/i);
  });

  it("still uses the dev fallback outside production, so local dev works unconfigured", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(decryptField(encryptField("x"))).toBe("x");
  });
});

describe("maskTail", () => {
  it("keeps only the tail", () => {
    expect(maskTail("123456789")).toBe("•••••6789");
    expect(maskTail(null)).toBe("—");
    expect(maskTail("12", 4)).toBe("12");
  });
});
