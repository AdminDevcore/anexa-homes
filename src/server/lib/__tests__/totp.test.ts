import { describe, it, expect } from "vitest";
import {
  base32Encode,
  base32Decode,
  generateSecret,
  hotp,
  totp,
  verifyTotp,
  otpauthUri,
  generateRecoveryCodes,
  hashRecoveryCode,
} from "../totp";

/**
 * TOTP, CHECKED AGAINST THE RFCs RATHER THAN AGAINST ITSELF.
 *
 * This is the whole reason it was safe to write the algorithm here instead of
 * taking a dependency. Every number below comes from RFC 4226 Appendix D or
 * RFC 6238 Appendix B — published, frozen, and produced by implementations that
 * have nothing to do with this one. A test that merely round-tripped our own
 * output would prove only that we are consistently wrong.
 */

/** The canonical test secret: ASCII "12345678901234567890". */
const RFC_SECRET_ASCII = "12345678901234567890";
const RFC_SECRET_B32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("base32", () => {
  /**
   * Checked against a known-good constant, NOT by round-tripping our encoder
   * through our decoder — two matching bugs would cancel out and pass.
   */
  it("encodes the RFC secret to the expected base32", () => {
    expect(base32Encode(Buffer.from(RFC_SECRET_ASCII, "ascii"))).toBe(RFC_SECRET_B32);
  });

  it("decodes it back to the original bytes", () => {
    expect(base32Decode(RFC_SECRET_B32).toString("ascii")).toBe(RFC_SECRET_ASCII);
  });

  /** A user retyping a printed secret should not be punished for the spacing
   * that was added to make it readable. */
  it("tolerates spacing, hyphens, padding and lower case", () => {
    expect(base32Decode("gezd gnbv-gy3t qojq").toString("ascii")).toBe("1234567890");
  });

  it("refuses a character that is not in the alphabet", () => {
    expect(() => base32Decode("GEZD1NBV")).toThrow();
  });

  it("round-trips arbitrary lengths, including partial groups", () => {
    for (const n of [1, 2, 3, 4, 5, 6, 7, 10, 20]) {
      const buf = Buffer.from(Array.from({ length: n }, (_, i) => (i * 37 + 11) & 0xff));
      expect(base32Decode(base32Encode(buf))).toEqual(buf);
    }
  });
});

describe("HOTP — RFC 4226 Appendix D", () => {
  const EXPECTED = [
    "755224", "287082", "359152", "969429", "338314",
    "254676", "287922", "162583", "399871", "520489",
  ];

  it.each(EXPECTED.map((code, counter) => [counter, code]))(
    "counter %i produces %s",
    (counter, code) => {
      expect(hotp(Buffer.from(RFC_SECRET_ASCII, "ascii"), BigInt(counter))).toBe(code);
    }
  );
});

describe("TOTP — RFC 6238 Appendix B (SHA-1, 8 digits)", () => {
  const VECTORS: [number, string][] = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    // PAST THE 32-BIT SECOND BOUNDARY. An implementation that keeps the counter
    // in a 32-bit integer agrees with every row above this one and is wrong
    // from here on — which is a bug that ships and then waits.
    [20000000000, "65353130"],
  ];

  it.each(VECTORS)("T=%i produces %s", (seconds, code) => {
    expect(totp(RFC_SECRET_B32, { at: seconds * 1000, digits: 8 })).toBe(code);
  });
});

describe("verifying a code", () => {
  const AT = 1_700_000_000_000;

  it("accepts the current code and reports which step it was", () => {
    const code = totp(RFC_SECRET_B32, { at: AT });
    const step = verifyTotp(RFC_SECRET_B32, code, { at: AT });
    expect(step).toBe(BigInt(Math.floor(AT / 1000 / 30)));
  });

  /** Phones drift. One step either side is the accepted compromise. */
  it("accepts a code from one step either side", () => {
    const previous = totp(RFC_SECRET_B32, { at: AT - 30_000 });
    const next = totp(RFC_SECRET_B32, { at: AT + 30_000 });
    expect(verifyTotp(RFC_SECRET_B32, previous, { at: AT })).not.toBeNull();
    expect(verifyTotp(RFC_SECRET_B32, next, { at: AT })).not.toBeNull();
  });

  it("refuses a code two steps away", () => {
    const stale = totp(RFC_SECRET_B32, { at: AT - 90_000 });
    expect(verifyTotp(RFC_SECRET_B32, stale, { at: AT })).toBeNull();
  });

  /**
   * THE PROPERTY THE RETURN TYPE EXISTS FOR. The same code verifies twice
   * within its window, so a caller that treats verification as a boolean has a
   * replayable second factor. Returning the step is what lets the caller store
   * it and refuse a repeat.
   */
  it("returns the SAME step for a replayed code, so a caller can detect it", () => {
    const code = totp(RFC_SECRET_B32, { at: AT });
    const first = verifyTotp(RFC_SECRET_B32, code, { at: AT });
    const second = verifyTotp(RFC_SECRET_B32, code, { at: AT + 5_000 });
    expect(first).not.toBeNull();
    expect(second).toBe(first);
  });

  it("refuses a wrong code, a short code and an empty one", () => {
    expect(verifyTotp(RFC_SECRET_B32, "000000", { at: AT, window: 0 })).toBeNull();
    expect(verifyTotp(RFC_SECRET_B32, "123", { at: AT })).toBeNull();
    expect(verifyTotp(RFC_SECRET_B32, "", { at: AT })).toBeNull();
  });

  /** A length mismatch must return null rather than throwing out of
   * `timingSafeEqual` — an exception would leak what the comparison hides. */
  it("does not throw on a code of the wrong length", () => {
    expect(() => verifyTotp(RFC_SECRET_B32, "1234567890123", { at: AT })).not.toThrow();
  });

  it("ignores the spacing authenticator apps display", () => {
    const code = totp(RFC_SECRET_B32, { at: AT });
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
    expect(verifyTotp(RFC_SECRET_B32, spaced, { at: AT })).not.toBeNull();
  });

  it("refuses a code from a different secret", () => {
    const other = generateSecret();
    const code = totp(other, { at: AT });
    expect(verifyTotp(RFC_SECRET_B32, code, { at: AT })).toBeNull();
  });
});

describe("secrets", () => {
  it("generates a 160-bit secret by default", () => {
    expect(base32Decode(generateSecret())).toHaveLength(20);
  });

  it("does not repeat itself", () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateSecret()));
    expect(seen.size).toBe(50);
  });

  it("produces a URI an authenticator can read", () => {
    const uri = otpauthUri({ secret: RFC_SECRET_B32, account: "ola@example.com", issuer: "Anexa" });
    expect(uri.startsWith("otpauth://totp/Anexa%3Aola%40example.com?")).toBe(true);
    const params = new URLSearchParams(uri.split("?")[1]);
    expect(params.get("secret")).toBe(RFC_SECRET_B32);
    // Both spellings of the issuer, because different apps read different ones.
    expect(params.get("issuer")).toBe("Anexa");
    expect(params.get("period")).toBe("30");
  });
});

describe("recovery codes", () => {
  it("returns the plain codes once, with their hashes", () => {
    const { plain, hashes } = generateRecoveryCodes();
    expect(plain).toHaveLength(10);
    expect(hashes).toHaveLength(10);
    expect(new Set(plain).size).toBe(10);
  });

  /** They are written on paper, so they must be assumed to leak from the
   * user's side. What we store must not be the code itself. */
  it("stores a hash that is not the code", () => {
    const { plain, hashes } = generateRecoveryCodes(1);
    expect(hashes[0]).not.toContain(plain[0].replace("-", ""));
    expect(hashes[0]).toHaveLength(64);
    expect(hashRecoveryCode(plain[0])).toBe(hashes[0]);
  });

  /** Handwritten and retyped: case, spacing and the hyphen must not matter. */
  it("hashes the same code the same way however it is typed back", () => {
    const { plain, hashes } = generateRecoveryCodes(1);
    const typed = plain[0].toLowerCase().replace("-", " ");
    expect(hashRecoveryCode(typed)).toBe(hashes[0]);
  });

  /** No I, L, O or U — the characters a person misreads off paper. */
  it("avoids characters that are misread by hand", () => {
    const { plain } = generateRecoveryCodes(40);
    expect(plain.join("")).not.toMatch(/[ILOU]/);
  });
});
