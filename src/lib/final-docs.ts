/**
 * The closeout packet — the paperwork a homeowner signs once the install is
 * finished.
 *
 * A packet is not a new kind of record. It is whichever contract templates
 * carry `finalPacket`, sent as ONE envelope: one email, one signing link, one
 * signature, one merged PDF. So everything here is arrangement of data the
 * e-sign engine already stores, and nothing in this file touches a database.
 *
 * The status a deal shows is read back the same way — by asking which envelope
 * on this deal was built from a packet template. That is deliberately blind to
 * WHO sent it: a rep tapping the button and a Settings → Automations rule
 * firing `send_for_signature` produce the same row, so the deal shows one
 * status rather than two that can disagree.
 */

/** A template in the packet, in the order it prints. */
export type FinalDocsTemplate = { id: string; name: string };

/** An envelope on the deal, as much of it as the status line needs. */
export type FinalDocsPackage = {
  id: string;
  templateId: string | null;
  status: string;
  signedFileId: string | null;
  sentAt: string | null;
  completedAt: string | null;
};

export type FinalDocsState =
  | { kind: "none" }
  | {
      kind: "sent" | "viewed" | "partially_signed" | "signed" | "declined" | "voided" | "expired";
      packageId: string;
      /** The date the label reads. Send date until something later happened. */
      at: string | null;
      signedFileId: string | null;
    };

/**
 * The one envelope the deal reports on: the newest package built from a packet
 * template.
 *
 * Newest, not "first unfinished". Final docs get re-sent — a corrected
 * certificate, an address fixed after the fact — and the answer to "did the
 * customer sign?" is always about the copy that went out last. Callers pass
 * packages already ordered newest-first (`createdAt desc`, which is how the
 * deal page loads them); this does not re-sort, so a caller handing them over
 * in another order gets that order's first match.
 */
export function resolveFinalDocs(
  packages: FinalDocsPackage[],
  packetTemplateIds: string[],
): FinalDocsState {
  const packet = new Set(packetTemplateIds);
  const found = packages.find((p) => p.templateId && packet.has(p.templateId));
  if (!found) return { kind: "none" };

  const kind = stateKind(found.status);
  if (!kind) return { kind: "none" };

  return {
    kind,
    packageId: found.id,
    at: found.completedAt ?? found.sentAt,
    signedFileId: found.signedFileId,
  };
}

/**
 * A `draft` package has been created but never sent, so it is not evidence of
 * anything the customer has seen — the deal keeps reading "Not sent" until a
 * link actually goes out. Every other status maps straight across, except
 * `completed`, which this vocabulary calls what the installer calls it.
 */
function stateKind(status: string): Exclude<FinalDocsState, { kind: "none" }>["kind"] | null {
  switch (status) {
    case "completed":
      return "signed";
    case "sent":
    case "viewed":
    case "partially_signed":
    case "declined":
    case "voided":
    case "expired":
      return status;
    default:
      return null;
  }
}

/** What the chip beside the button reads. */
export function finalDocsLabel(kind: FinalDocsState["kind"]): string {
  switch (kind) {
    case "none":
      return "Not sent";
    case "sent":
      return "Sent";
    case "viewed":
      return "Viewed";
    case "partially_signed":
      return "Partially signed";
    case "signed":
      return "Signed";
    case "declined":
      return "Declined";
    case "voided":
      return "Voided";
    case "expired":
      return "Expired";
  }
}

/**
 * Whether this state still has a signature outstanding — the question both the
 * Resend button and the button's own wording ("Send again") are asking.
 */
export function isAwaitingSignature(kind: FinalDocsState["kind"]): boolean {
  return kind === "sent" || kind === "viewed" || kind === "partially_signed";
}
