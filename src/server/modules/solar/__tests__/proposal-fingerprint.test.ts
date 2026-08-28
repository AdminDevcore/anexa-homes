import { describe, it, expect } from "vitest";
import { groupFingerprint, snapshotFingerprint } from "../proposal-signature";

/**
 * The fingerprint is the certificate's answer to "is this the same document
 * that was signed". It is only worth printing if it depends on the CONTENT and
 * on nothing else.
 */
describe("snapshot fingerprint", () => {
  it("does not depend on key order", () => {
    // Prisma hands JSON back with no ordering guarantee. A hash that moved
    // because the same object came out of the database in a different sequence
    // would read as a tampered document on a proposal nobody touched.
    const a = { customer: { name: "A", address: "1 Way" }, price: 2800000 };
    const b = { price: 2800000, customer: { address: "1 Way", name: "A" } };
    expect(snapshotFingerprint(a)).toBe(snapshotFingerprint(b));
  });

  it("changes when a figure changes", () => {
    const a = { price: 2800000 };
    const b = { price: 2800001 };
    expect(snapshotFingerprint(a)).not.toBe(snapshotFingerprint(b));
  });

  it("keeps array order significant", () => {
    // The payment menu is an ordered list — the first option is the one quoted.
    expect(snapshotFingerprint({ options: ["a", "b"] })).not.toBe(
      snapshotFingerprint({ options: ["b", "a"] })
    );
  });

  it("distinguishes a missing key from a null one", () => {
    expect(snapshotFingerprint({ lender: null })).not.toBe(snapshotFingerprint({}));
  });

  it("is 64 hex characters, grouped for reading off paper", () => {
    const hex = snapshotFingerprint({ any: "thing" });
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
    expect(groupFingerprint(hex).split(" ")).toHaveLength(8);
  });
});
