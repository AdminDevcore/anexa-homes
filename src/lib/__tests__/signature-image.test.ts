import { describe, it, expect } from "vitest";
import { isSignatureImage, SIGNATURE_MAX_CHARS } from "../signature-image";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";

/**
 * The signature arrives at a PUBLIC endpoint whose only authorization is the
 * share token, and it is rendered straight back into the rep's portal, the
 * customer's page and the lender's PDF. Everything here is that value failing
 * to be something other than a picture.
 */
describe("signature image", () => {
  it("accepts what the pads produce", () => {
    expect(isSignatureImage(PNG)).toBe(true);
    expect(isSignatureImage("data:image/jpeg;base64,/9j/4AAQSkZJRg==")).toBe(true);
  });

  it("refuses an SVG", () => {
    // The whole reason the check exists: an SVG is a document, not a raster, and
    // it can carry a <script> element into every page that renders it back.
    const svg =
      "data:image/svg+xml;base64," +
      Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>").toString("base64");
    expect(isSignatureImage(svg)).toBe(false);
  });

  it("refuses anything that is not a data URL", () => {
    for (const v of [
      "",
      null,
      undefined,
      "javascript:alert(1)",
      "https://example.com/signature.png",
      "<img src=x onerror=alert(1)>",
    ]) {
      expect(isSignatureImage(v)).toBe(false);
    }
  });

  it("refuses a payload with anything but base64 after the comma", () => {
    expect(isSignatureImage('data:image/png;base64,abc"><script>')).toBe(false);
  });

  it("refuses one too large to be a signature", () => {
    expect(isSignatureImage(`data:image/png;base64,${"A".repeat(SIGNATURE_MAX_CHARS)}`)).toBe(false);
  });
});
