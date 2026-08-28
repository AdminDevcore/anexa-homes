import { describe, it, expect, beforeAll } from "vitest";
import { mintWitness, readWitness } from "../witness";
import { mintPrintSignature } from "../print-signature";

const PROPOSAL = "2307d609-7631-42ea-9814-9379469fc8b4";
const OTHER = "00000000-0000-0000-0000-000000000000";
const REP = "9f0f2f1a-1111-4222-8333-444455556666";

beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret-for-witness-tokens";
});

/**
 * The token is the only thing standing between "the customer signed at the
 * kitchen table with a rep beside them" and anybody with the share link
 * claiming the same. Every one of these is that claim failing to be forged.
 */
describe("in-person witness token", () => {
  it("names the rep who minted it", () => {
    expect(readWitness(mintWitness(PROPOSAL, REP), PROPOSAL)).toBe(REP);
  });

  it("is URL-safe", () => {
    expect(mintWitness(PROPOSAL, REP)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("does not carry across to another proposal", () => {
    // A rep opens an in-person session on one deal and the token leaks. It must
    // not mark a different deal's signature as witnessed.
    expect(readWitness(mintWitness(PROPOSAL, REP), OTHER)).toBeNull();
  });

  it("expires", () => {
    const t = mintWitness(PROPOSAL, REP, 0);
    expect(readWitness(t, PROPOSAL, 3 * 60 * 60 * 1000)).toBe(REP);
    expect(readWitness(t, PROPOSAL, 4 * 60 * 60 * 1000 + 1)).toBeNull();
  });

  it("refuses a tampered payload", () => {
    const raw = Buffer.from(mintWitness(PROPOSAL, REP), "base64url").toString("utf8");
    const [id, , expiry, mac] = raw.split(".");
    const forged = Buffer.from(`${id}.someone-else.${expiry}.${mac}`, "utf8").toString("base64url");
    expect(readWitness(forged, PROPOSAL)).toBeNull();
  });

  it("refuses a print signature presented as a witness", () => {
    // Both are HMACs over a payload with an expiry, signed with the same
    // secret. Domain separation is what stops one being replayed as the other —
    // a token that authorises READING a document must never attribute a WRITE.
    expect(readWitness(mintPrintSignature(PROPOSAL), PROPOSAL)).toBeNull();
  });

  it("treats junk as absent rather than throwing", () => {
    for (const junk of [null, undefined, "", "not-base64!!", "YWJj"]) {
      expect(readWitness(junk, PROPOSAL)).toBeNull();
    }
  });
});
