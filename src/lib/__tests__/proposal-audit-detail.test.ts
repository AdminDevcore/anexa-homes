import { describe, it, expect } from "vitest";
import { publicAuditDetail } from "../proposal-signature";

/**
 * The certificate of electronic signature is bound into the PDF the HOMEOWNER
 * downloads, and it prints the document history verbatim. The details in that
 * history are written for us — the `generated` line records which lender
 * setting was applied, contract value and all — so the customer's copy of the
 * trail was quoting them a number that appears nowhere on the document they
 * signed.
 */
describe("public audit detail", () => {
  it("drops the lender ladder from the generated line", () => {
    expect(
      publicAuditDetail(
        "v26 · loan · Participate Tax Program $70,000 · contract $128,080 · customer $58,080"
      )
    ).toBe("v26 · loan");
  });

  it("keeps the part of the line that describes the event", () => {
    expect(publicAuditDetail("v26 · loan · Participate Tax Program $70,000 · live link kept")).toBe(
      "v26 · loan · live link kept"
    );
  });

  it("leaves a detail that names no money exactly as written", () => {
    for (const detail of [
      "the customer signed this version — replaced v21",
      "opened on a representative's device for in-person signing",
      "email + text · existing link kept",
      "replaced by v27 · live link moved",
    ]) {
      expect(publicAuditDetail(detail)).toBe(detail);
    }
  });

  it("prints the label alone rather than an empty dash when nothing survives", () => {
    expect(publicAuditDetail("Participate Tax Program $70,000")).toBeNull();
    expect(publicAuditDetail(null)).toBeNull();
    expect(publicAuditDetail("")).toBeNull();
  });
});
