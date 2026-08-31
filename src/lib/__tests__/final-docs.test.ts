import { describe, it, expect } from "vitest";
import {
  resolveFinalDocs,
  finalDocsLabel,
  isAwaitingSignature,
  type FinalDocsPackage,
} from "@/lib/final-docs";

/**
 * WHAT THE INSTALLER READS BESIDE THE BUTTON.
 *
 * The status is a read of the e-signature envelope, not a second column
 * somebody has to remember to update — which is the whole reason a rule firing
 * from Settings → Automations lights the same line as the button.
 */

const PACKET = ["t-cert", "t-attest"];

const pkg = (over: Partial<FinalDocsPackage> = {}): FinalDocsPackage => ({
  id: "p1",
  templateId: "t-cert",
  status: "sent",
  signedFileId: null,
  sentAt: "2026-08-30T10:00:00.000Z",
  completedAt: null,
  ...over,
});

describe("resolveFinalDocs", () => {
  it("reads nothing when the deal has no packages", () => {
    expect(resolveFinalDocs([], PACKET)).toEqual({ kind: "none" });
  });

  it("reads nothing when no template is in the packet", () => {
    expect(resolveFinalDocs([pkg()], [])).toEqual({ kind: "none" });
  });

  it("ignores envelopes built from a template outside the packet", () => {
    const contract = pkg({ id: "p-contract", templateId: "t-sales-contract" });
    expect(resolveFinalDocs([contract], PACKET)).toEqual({ kind: "none" });
  });

  it("matches any packet template, not just the first", () => {
    const state = resolveFinalDocs([pkg({ templateId: "t-attest" })], PACKET);
    expect(state.kind).toBe("sent");
  });

  it("calls a completed envelope signed, and dates it from completion", () => {
    const state = resolveFinalDocs(
      [pkg({ status: "completed", completedAt: "2026-08-31T09:00:00.000Z", signedFileId: "f1" })],
      PACKET,
    );
    expect(state).toMatchObject({
      kind: "signed",
      at: "2026-08-31T09:00:00.000Z",
      signedFileId: "f1",
    });
  });

  it("dates an unsigned envelope from when it was sent", () => {
    const state = resolveFinalDocs([pkg()], PACKET);
    expect(state).toMatchObject({ kind: "sent", at: "2026-08-30T10:00:00.000Z" });
  });

  it.each(["viewed", "partially_signed", "declined", "voided", "expired"])(
    "carries %s through unchanged",
    (status) => {
      expect(resolveFinalDocs([pkg({ status })], PACKET).kind).toBe(status);
    },
  );

  it("treats a draft as never sent — nobody has seen it", () => {
    expect(resolveFinalDocs([pkg({ status: "draft" })], PACKET)).toEqual({ kind: "none" });
  });

  it("answers about the copy that went out last", () => {
    // Newest-first, which is the order the deal page loads them in.
    const state = resolveFinalDocs(
      [pkg({ id: "p2", status: "sent" }), pkg({ id: "p1", status: "completed" })],
      PACKET,
    );
    expect(state).toMatchObject({ kind: "sent", packageId: "p2" });
  });

  it("skips a non-packet envelope to find the packet one behind it", () => {
    const state = resolveFinalDocs(
      [pkg({ id: "p-other", templateId: "t-sales-contract" }), pkg({ id: "p-packet" })],
      PACKET,
    );
    expect(state).toMatchObject({ kind: "sent", packageId: "p-packet" });
  });

  it("ignores an envelope with no template at all", () => {
    expect(resolveFinalDocs([pkg({ templateId: null })], PACKET)).toEqual({ kind: "none" });
  });
});

describe("what the chip says", () => {
  it("says Not sent before anything goes out", () => {
    expect(finalDocsLabel("none")).toBe("Not sent");
  });

  it("says Signed rather than Completed — the installer's word", () => {
    expect(finalDocsLabel("signed")).toBe("Signed");
  });
});

describe("isAwaitingSignature", () => {
  it("is true only while a signature is still outstanding", () => {
    expect(isAwaitingSignature("sent")).toBe(true);
    expect(isAwaitingSignature("viewed")).toBe(true);
    expect(isAwaitingSignature("partially_signed")).toBe(true);
  });

  it("is false once it is signed, or once it can never be", () => {
    for (const kind of ["none", "signed", "declined", "voided", "expired"] as const) {
      expect(isAwaitingSignature(kind)).toBe(false);
    }
  });
});
