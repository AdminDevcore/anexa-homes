import { describe, it, expect } from "vitest";
import { isPdfMime } from "../knowledge";

describe("isPdfMime", () => {
  it("is true for application/pdf", () => {
    expect(isPdfMime("application/pdf")).toBe(true);
  });

  it("is true with a charset suffix and odd casing", () => {
    expect(isPdfMime("Application/PDF; charset=binary")).toBe(true);
  });

  it("is false for non-pdf types", () => {
    expect(isPdfMime("image/png")).toBe(false);
    expect(isPdfMime("application/vnd.ms-powerpoint")).toBe(false);
  });

  it("is false for null/undefined/empty", () => {
    expect(isPdfMime(null)).toBe(false);
    expect(isPdfMime(undefined)).toBe(false);
    expect(isPdfMime("")).toBe(false);
  });
});
