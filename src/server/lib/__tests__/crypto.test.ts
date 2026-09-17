import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "crypto";
import { encryptField, decryptField, maskTail, keyIdOf, needsRotation } from "../crypto";

/**
 * These tests pin the properties that protect DATA AT REST:
 *
 *   1. every value already in the database still opens — including values
 *      sealed before key versioning existed;
 *   2. a new value names the key that sealed it, so a key can ROTATE without
 *      orphaning what came before;
 *   3. a value that will NOT open is reported, not swallowed.
 *
 * The "known ciphertext" cases are the important ones. They are sealed here
 * with the exact derivation a previous deployment used — sha256 of the raw env
 * value, AES-256-GCM, "iv:tag:ct" base64 — so any future change to the key
 * derivation fails this test instead of silently orphaning production PII and
 * lender keys.
 *
 * ── ONE BEHAVIOUR DELIBERATELY REVERSED ─────────────────────────────────────
 * This file used to assert that introducing a higher-priority key made values
 * written under a lower-priority one return NULL ("AUTH_SECRET no longer
 * wins"). That is precisely the hazard crypto.ts's own header warns about:
 * setting ONBOARDING_ENC_KEY on a deployment whose data was written under
 * AUTH_SECRET silently orphaned every stored secret, and it surfaced to an
 * admin as "this lender has no API key yet" on a lender configured months ago.
 *
 * A legacy blob names no key, so it is now opened by trying every configured
 * key. Write-preference is unchanged — the first configured key still seals new
 * values — but reading no longer depends on which key happens to be first.
 */

/** Every env var that can hold a key, including the new finance one. */
const KEY_VARS = [
  "FINANCE_ENC_KEY",
  "ONBOARDING_ENC_KEY",
  "NEXTAUTH_SECRET",
  "AUTH_SECRET",
] as const;

/** Seal a value the way a PREVIOUS deployment would have: unversioned, 3 parts. */
function sealLegacy(secret: string, plain: string): string {
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
    // happens to have in their .env. FINANCE_ENC_KEY is in this list for that
    // reason: a real one in .env would otherwise change what these cases seal.
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

  it("stamps a new blob with the key that sealed it: v1.<keyId>:iv:tag:ct", () => {
    vi.stubEnv("AUTH_SECRET", "some-auth-secret");
    const parts = encryptField("x").split(":");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("v1.auth");
    // 12-byte IV and 16-byte GCM tag, base64-encoded — unchanged from legacy.
    expect(Buffer.from(parts[1], "base64")).toHaveLength(12);
    expect(Buffer.from(parts[2], "base64")).toHaveLength(16);
  });

  it("seals with FINANCE_ENC_KEY when it is set — the new preferred key", () => {
    vi.stubEnv("AUTH_SECRET", "some-auth-secret");
    vi.stubEnv("FINANCE_ENC_KEY", "the-finance-key");
    const blob = encryptField("plaid-access-token");
    expect(keyIdOf(blob)).toBe("fin");
    expect(decryptField(blob)).toBe("plaid-access-token");
  });

  it("opens a blob sealed by a previous deployment under AUTH_SECRET", () => {
    // The compatibility guarantee, stated as a test: data written before key
    // versioning existed must still open after it.
    const legacy = sealLegacy("prod-auth-secret", "ak_live_lender_key");
    vi.stubEnv("AUTH_SECRET", "prod-auth-secret");
    expect(decryptField(legacy)).toBe("ak_live_lender_key");
    expect(keyIdOf(legacy)).toBeNull(); // it names no key
  });

  it("ROTATES: introducing FINANCE_ENC_KEY orphans nothing already stored", () => {
    // This is the whole point of versioning. Values exist under each older key;
    // the new key arrives; every one of them must still open, and new writes
    // must use the new key.
    const underAuth = sealLegacy("k-auth", "a");
    const underNextauth = sealLegacy("k-nextauth", "n");
    const underOnboarding = sealLegacy("k-onboarding", "o");

    vi.stubEnv("AUTH_SECRET", "k-auth");
    vi.stubEnv("NEXTAUTH_SECRET", "k-nextauth");
    vi.stubEnv("ONBOARDING_ENC_KEY", "k-onboarding");
    vi.stubEnv("FINANCE_ENC_KEY", "k-finance");

    expect(decryptField(underAuth)).toBe("a");
    expect(decryptField(underNextauth)).toBe("n");
    expect(decryptField(underOnboarding)).toBe("o");
    expect(keyIdOf(encryptField("fresh"))).toBe("fin");
  });

  it("no longer orphans a lower-priority key's data when a higher one appears", () => {
    /**
     * The behaviour this file used to assert in reverse. Setting a
     * higher-priority key made older values read as NULL, which callers report
     * as "not configured" — a lender whose API key was entered months ago
     * presenting as never having had one.
     */
    const underAuth = sealLegacy("k-auth", "v");

    vi.stubEnv("AUTH_SECRET", "k-auth");
    expect(decryptField(underAuth)).toBe("v");

    vi.stubEnv("ONBOARDING_ENC_KEY", "k-onboarding");
    expect(decryptField(underAuth)).toBe("v"); // still readable — was null before
    expect(console.error).not.toHaveBeenCalled();
  });

  it("keeps the WRITE preference: the first configured key seals new values", () => {
    vi.stubEnv("AUTH_SECRET", "k-auth");
    expect(keyIdOf(encryptField("x"))).toBe("auth");

    vi.stubEnv("NEXTAUTH_SECRET", "k-nextauth");
    expect(keyIdOf(encryptField("x"))).toBe("nx");

    vi.stubEnv("ONBOARDING_ENC_KEY", "k-onboarding");
    expect(keyIdOf(encryptField("x"))).toBe("onb");

    vi.stubEnv("FINANCE_ENC_KEY", "k-finance");
    expect(keyIdOf(encryptField("x"))).toBe("fin");
  });

  it("reports a versioned blob whose named key is not configured here", () => {
    vi.stubEnv("FINANCE_ENC_KEY", "k-finance");
    const sealed = encryptField("plaid-access-token");
    expect(keyIdOf(sealed)).toBe("fin");

    // The finance key is withdrawn; another key remains. Unlike a legacy blob,
    // this one NAMES its key, so the failure is unambiguous rather than a guess.
    vi.stubEnv("FINANCE_ENC_KEY", "");
    vi.stubEnv("AUTH_SECRET", "k-auth");
    expect(decryptField(sealed, "BankConnection.accessToken")).toBeNull();
    expect(console.error).toHaveBeenCalledTimes(1);
    const logged = (console.error as unknown as { mock: { calls: string[][] } }).mock.calls[0][0];
    expect(logged).toContain("BankConnection.accessToken");
    expect(logged).toContain("fin");
    expect(logged).not.toContain("plaid-access-token");
    expect(logged).not.toContain("k-finance");
  });

  it("returns null WITHOUT logging for an absent value", () => {
    vi.stubEnv("AUTH_SECRET", "s");
    expect(decryptField(null)).toBeNull();
    expect(decryptField(undefined)).toBeNull();
    expect(decryptField("")).toBeNull();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("logs when a PRESENT legacy blob will not open under ANY key", () => {
    const sealedElsewhere = sealLegacy("the-old-key", "ak_live_lender_key");
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

  it("does not treat a malformed value as encrypted", () => {
    vi.stubEnv("AUTH_SECRET", "s");
    expect(decryptField("not-a-blob")).toBeNull();
    expect(console.error).toHaveBeenCalledTimes(1);
  });
});

describe("needsRotation", () => {
  beforeEach(() => {
    for (const v of KEY_VARS) vi.stubEnv(v, "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("flags a legacy blob, and anything not sealed with the current key", () => {
    vi.stubEnv("AUTH_SECRET", "k-auth");
    const legacy = sealLegacy("k-auth", "v");
    expect(needsRotation(legacy)).toBe(true); // unversioned

    const current = encryptField("v");
    expect(needsRotation(current)).toBe(false);

    // A newer key arrives; what was current becomes stale.
    vi.stubEnv("FINANCE_ENC_KEY", "k-finance");
    expect(needsRotation(current)).toBe(true);
    expect(needsRotation(encryptField("v"))).toBe(false);
  });

  it("says nothing needs rotating when there is no value", () => {
    expect(needsRotation(null)).toBe(false);
    expect(needsRotation("")).toBe(false);
  });
});

describe("maskTail", () => {
  it("keeps only the tail", () => {
    expect(maskTail("123456789")).toBe("•••••6789");
    expect(maskTail(null)).toBe("—");
    expect(maskTail("12", 4)).toBe("12");
  });
});
