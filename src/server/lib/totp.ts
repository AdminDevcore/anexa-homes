import crypto from "node:crypto";

/**
 * TOTP (RFC 6238) over HOTP (RFC 4226), on node's crypto alone.
 *
 * HAND-WRITTEN RATHER THAN A DEPENDENCY, deliberately. The algorithm is about
 * forty lines, it is frozen by two RFCs that cannot change under us, and it is
 * verifiable against published test vectors — so the usual argument for taking a
 * library (someone else has got the edge cases right) is settled here by the
 * vectors instead. Against that, this code guards access to money movement, and
 * a transitive dependency in that position is a supply-chain surface for a
 * problem we can otherwise close completely.
 *
 * The tests check RFC 4226's HOTP vectors and RFC 6238's SHA-1 TOTP vectors,
 * including `T = 20000000000`, which is past the 32-bit second boundary and is
 * where a naive implementation using a 32-bit counter silently diverges.
 *
 * ── VERIFY RETURNS THE STEP, NOT A BOOLEAN ──────────────────────────────────
 * This is the part that matters for security rather than correctness. A code is
 * valid for a whole 30-second window, so an attacker who observes one — over a
 * shoulder, in a screen share, from a phished prompt — can replay it until the
 * window closes. Returning the matched counter lets the caller record which
 * step was consumed and refuse it thereafter. A boolean cannot express that, and
 * an interface that cannot express it invites the vulnerable implementation.
 */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 base32, unpadded — the encoding every authenticator app expects. */
export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  // Padding and spacing are stripped: authenticator apps and printed backup
  // sheets group the secret for legibility, and a user retyping one should not
  // be told it is invalid because of a space.
  const clean = input.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error("That is not a valid authenticator secret.");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A fresh 20-byte (160-bit) secret, the size RFC 4226 specifies for SHA-1. */
export function generateSecret(bytes = 20): string {
  return base32Encode(crypto.randomBytes(bytes));
}

/**
 * HOTP. The counter is a BigInt written as 8 bytes big-endian.
 *
 * `writeBigUInt64BE`, not two 32-bit halves: the time steps in RFC 6238's later
 * vectors exceed what a 32-bit counter holds, and getting that wrong produces
 * codes that are correct for twenty years and then quietly are not.
 */
export function hotp(secret: Buffer, counter: bigint, digits = 6): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(counter);

  const mac = crypto.createHmac("sha1", secret).update(buf).digest();
  // Dynamic truncation, RFC 4226 §5.3.
  const offset = mac[mac.length - 1] & 0x0f;
  const binary =
    ((mac[offset] & 0x7f) << 24) |
    ((mac[offset + 1] & 0xff) << 16) |
    ((mac[offset + 2] & 0xff) << 8) |
    (mac[offset + 3] & 0xff);

  return String(binary % 10 ** digits).padStart(digits, "0");
}

export type TotpOptions = {
  /** Unix milliseconds. Defaults to now. */
  at?: number;
  /** Seconds per step. 30 is the universal default; do not change it. */
  step?: number;
  digits?: number;
};

export function counterFor(atMs: number, step: number): bigint {
  return BigInt(Math.floor(atMs / 1000 / step));
}

export function totp(secretBase32: string, opts: TotpOptions = {}): string {
  const { at = Date.now(), step = 30, digits = 6 } = opts;
  return hotp(base32Decode(secretBase32), counterFor(at, step), digits);
}

/**
 * Check a code, and say WHICH step matched.
 *
 * `window` is how many steps either side are accepted, for clock drift between
 * the phone and this server. One step (±30s) is the usual compromise: wider
 * accepts more codes at once, which both weakens the factor and widens the
 * replay window the caller then has to defend against.
 *
 * Returns the matched counter, or null. Never a boolean — see the header.
 */
export function verifyTotp(
  secretBase32: string,
  token: string,
  opts: TotpOptions & { window?: number } = {}
): bigint | null {
  const { at = Date.now(), step = 30, digits = 6, window = 1 } = opts;

  const cleaned = token.replace(/\s/g, "");
  // Length is checked before any comparison: `timingSafeEqual` throws on a
  // length mismatch, and letting that throw would leak through an exception
  // what the comparison is careful not to leak through timing.
  if (cleaned.length !== digits) return null;

  const secret = base32Decode(secretBase32);
  const centre = counterFor(at, step);

  for (let drift = -window; drift <= window; drift++) {
    const counter = centre + BigInt(drift);
    // `BigInt(0)`, not the `0n` literal: this project compiles below ES2020,
    // where the literal syntax is a type error even though BigInt itself works.
    if (counter < BigInt(0)) continue;
    const expected = hotp(secret, counter, digits);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(cleaned))) {
      return counter;
    }
  }
  return null;
}

/**
 * The `otpauth://` URI an authenticator app scans.
 *
 * The issuer appears twice — as a path prefix and as a parameter — because
 * different apps read different ones, and an app that reads neither files the
 * entry under a bare email address with no hint of which system it opens.
 */
export function otpauthUri(args: { secret: string; account: string; issuer: string }): string {
  const label = encodeURIComponent(`${args.issuer}:${args.account}`);
  const params = new URLSearchParams({
    secret: args.secret,
    issuer: args.issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/**
 * Recovery codes: what gets someone back in when the phone is gone.
 *
 * Returned in plain text ONCE, and stored only as SHA-256 hashes. Plain storage
 * would make the recovery list a second password file — and unlike a password
 * it is written down on paper, so it must be assumed to leak from the user's
 * side, never from ours.
 *
 * Plain SHA-256 rather than a slow KDF is correct HERE and nowhere near a
 * password: these are 40 bits of server-generated randomness, not something a
 * human chose, so there is no dictionary to run and nothing for a work factor
 * to buy.
 */
export function generateRecoveryCodes(count = 10): { plain: string[]; hashes: string[] } {
  const plain: string[] = [];
  for (let i = 0; i < count; i++) {
    // Ten bytes, so the code below is ten characters and carries 50 bits of
    // randomness. Five would produce "ABCDE-" — a trailing hyphen with nothing
    // after it, and a quarter of the entropy.
    // Crockford-ish: no I, L, O, U, so a handwritten code cannot be misread.
    const raw = crypto.randomBytes(10);
    let code = "";
    for (const byte of raw) code += "0123456789ABCDEFGHJKMNPQRSTVWXYZ"[byte & 31];
    plain.push(`${code.slice(0, 5)}-${code.slice(5)}`);
  }
  return { plain, hashes: plain.map(hashRecoveryCode) };
}

export function hashRecoveryCode(code: string): string {
  const normalised = code.toUpperCase().replace(/[\s-]/g, "");
  return crypto.createHash("sha256").update(normalised).digest("hex");
}
