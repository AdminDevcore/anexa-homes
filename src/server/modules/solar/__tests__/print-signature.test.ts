import { describe, it, expect, beforeAll } from "vitest";
import { mintPrintSignature, readPrintSignature } from "../print-signature";

const ID = "2307d609-7631-42ea-9814-9379469fc8b4";

beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret-for-print-signatures";
});

describe("print signature", () => {
  it("round-trips the proposal id it was minted for", () => {
    expect(readPrintSignature(mintPrintSignature(ID))).toBe(ID);
  });

  it("is one URL-safe path segment", () => {
    // It goes in a path, not a query string. A "+" or "/" from ordinary base64
    // would be re-interpreted by the router before any handler saw it.
    expect(mintPrintSignature(ID)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("does not name a different proposal", () => {
    const other = "00000000-0000-0000-0000-000000000000";
    expect(readPrintSignature(mintPrintSignature(ID))).not.toBe(other);
  });

  it("expires", () => {
    const sig = mintPrintSignature(ID, 0);
    expect(readPrintSignature(sig, 4 * 60 * 1000)).toBe(ID);
    expect(readPrintSignature(sig, 5 * 60 * 1000 + 1)).toBeNull();
  });

  it("rejects a signature whose expiry has been pushed out", () => {
    // The obvious forgery: decode, move the clock, re-encode. The MAC covers
    // the expiry, so it must not survive.
    const raw = Buffer.from(mintPrintSignature(ID, 0), "base64url").toString("utf8");
    const [id, , sig] = raw.split(".");
    const forged = Buffer.from(`${id}.${9e15}.${sig}`, "utf8").toString("base64url");
    expect(readPrintSignature(forged, 1000)).toBeNull();
  });

  it("rejects a signature repointed at another proposal", () => {
    const raw = Buffer.from(mintPrintSignature(ID), "base64url").toString("utf8");
    const [, expiry, sig] = raw.split(".");
    const forged = Buffer.from(
      `11111111-1111-1111-1111-111111111111.${expiry}.${sig}`,
      "utf8",
    ).toString("base64url");
    expect(readPrintSignature(forged)).toBeNull();
  });

  it("rejects a signature signed with a different secret", () => {
    const sig = mintPrintSignature(ID);
    process.env.AUTH_SECRET = "a-completely-different-secret";
    try {
      expect(readPrintSignature(sig)).toBeNull();
    } finally {
      process.env.AUTH_SECRET = "test-secret-for-print-signatures";
    }
  });

  it("rejects junk without throwing", () => {
    for (const junk of ["", "  ", "not-base64url!!", "Zm9v", "YS5iLmM", "a.b.c.d"]) {
      expect(readPrintSignature(junk)).toBeNull();
    }
  });

  it("refuses to mint when there is no secret to sign with", () => {
    const saved = process.env.AUTH_SECRET;
    delete process.env.AUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    try {
      // A constant fallback here would make every proposal's print URL
      // guessable by anyone holding a copy of this repository.
      expect(() => mintPrintSignature(ID)).toThrow(/AUTH_SECRET/);
    } finally {
      process.env.AUTH_SECRET = saved;
    }
  });
});
