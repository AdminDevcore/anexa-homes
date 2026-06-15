import { describe, it, expect } from "vitest";
import { deriveInitials, mapAdoptedToFields } from "../esign-signature";

describe("deriveInitials", () => {
  it("returns first + last initials uppercased", () => {
    expect(deriveInitials("Mustafa Joulani")).toBe("MJ");
  });
  it("handles a single name", () => {
    expect(deriveInitials("Cher")).toBe("C");
  });
  it("uses the first and last token for three-part names", () => {
    expect(deriveInitials("John Q Public")).toBe("JP");
  });
  it("trims and collapses extra whitespace", () => {
    expect(deriveInitials("  mary   jane  ")).toBe("MJ");
  });
  it("returns empty string for blank input", () => {
    expect(deriveInitials("   ")).toBe("");
  });
});

describe("mapAdoptedToFields", () => {
  const fields = [
    { id: "sig1", type: "signature" },
    { id: "ini1", type: "initials" },
    { id: "ini2", type: "initials" },
    { id: "txt", type: "text" },
  ];
  const adopted = { signature: "data:image/sig", initials: "data:image/ini" };

  it("assigns the signature image to signature fields and the initials image to initials fields", () => {
    const out = mapAdoptedToFields(fields, adopted);
    expect(out.sig1).toBe("data:image/sig");
    expect(out.ini1).toBe("data:image/ini");
    expect(out.ini2).toBe("data:image/ini");
  });

  // Regression: the original bug put the full signature into initials fields.
  it("never puts the full signature into an initials field", () => {
    const out = mapAdoptedToFields(fields, adopted);
    expect(out.ini1).not.toBe(adopted.signature);
    expect(out.ini2).not.toBe(adopted.signature);
  });

  it("ignores fields that aren't signature or initials", () => {
    const out = mapAdoptedToFields(fields, adopted);
    expect(out.txt).toBeUndefined();
  });
});
