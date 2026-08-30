/**
 * The customer's signature as the DOCUMENT sees it.
 *
 * Serialisable, no Dates and no Prisma types, because it crosses from a server
 * page into a "use client" document and is handed back out of a Server Action
 * the moment somebody signs — the same shape either way, so the execution block
 * that appears after signing is the one that will be there on reload.
 */
export type ProposalSignature = {
  /** The name the signer typed, verbatim. */
  name: string;
  /** Where the link was delivered, for the certificate. */
  email: string | null;
  /**
   * The mark, as a PNG data URL.
   *
   * NULL is a real and permanent state, not a loading one: proposals accepted
   * before signatures were captured have a `signedAt` and no mark, and the
   * execution block says so in words rather than showing an empty box.
   */
  mark: string | null;
  method: "typed" | "drawn" | null;
  /** ISO timestamps. */
  signedAt: string;
  consentAt: string | null;
  /** How the signature was taken. See SolarProposal.signedVia. */
  via: "remote" | "in_person" | null;
  /** The rep who hosted an in-person signing, for the certificate. */
  hostName: string | null;
};

/** One line of the audit trail on the certificate page. */
export type ProposalAuditEvent = {
  type: string;
  at: string;
  actor: string | null;
  ip: string | null;
  detail: string | null;
};

/**
 * Everything the certificate page prints.
 *
 * A separate type from the signature because the DOCUMENT needs the signature
 * and only the certificate needs the trail — a customer's screen should not
 * carry an IP address and a hash it has no use for until it is printed.
 */
export type ProposalCertificate = {
  signature: ProposalSignature;
  /** e.g. "Solar proposal v12". */
  documentTitle: string;
  customerName: string;
  propertyAddress: string | null;
  companyName: string;
  /**
   * SHA-256 of the frozen snapshot, hex, as the tamper check.
   *
   * The snapshot IS the document — every figure the customer saw is read from
   * it and nothing is recomputed at render time — so a hash of it is a hash of
   * what was signed. Re-running it against the stored snapshot answers "is this
   * the same proposal" without trusting the PDF, which is the question a lender
   * or a court actually asks of a signed copy.
   */
  fingerprint: string;
  ip: string | null;
  userAgent: string | null;
  events: ProposalAuditEvent[];
};

/** How each audit event reads on the certificate. */
export const AUDIT_LABELS: Record<string, string> = {
  generated: "Proposal generated",
  sent: "Sent to the customer",
  viewed: "Opened by the customer",
  in_person_opened: "Opened for in-person signing",
  signed: "Signed by the customer",
  superseded: "Replaced by a newer version",
  approved: "Approved as the final proposal",
  unapproved: "Approval withdrawn",
  repriced: "Re-priced",
};

export function auditLabel(type: string): string {
  return AUDIT_LABELS[type] ?? type.replace(/_/g, " ");
}

/**
 * One line of the trail as the CUSTOMER'S copy is allowed to print it.
 *
 * WHY THIS EXISTS. The certificate is bound into the proposal PDF the
 * homeowner downloads, so every word of the audit trail is customer-facing —
 * but the details themselves are written for us. The `generated` line records
 * WHICH LENDER SETTING was applied to the document: the partner programme, the
 * lender's contract value and the household's own obligation, so that a change
 * made in Settings a fortnight later can be read against the documents
 * generated either side of it. Printed verbatim, that line told the homeowner
 * the size of the adjustment carried above their price — a figure that appears
 * nowhere on the document they signed, and whose whole point is that the
 * customer is quoted their price whole.
 *
 * The rule is the general one rather than a patch for that one sentence: a
 * segment of an audit detail that names an amount is an internal note and does
 * not go on the customer's sheet. The document above the certificate is where
 * money is quoted, and it is the only place money is quoted. What survives is
 * the part that describes the EVENT — the version, the product, whether the
 * live link moved — which is what a trail is for.
 *
 * Applied where the certificate is assembled, on the server, so a redacted
 * detail is never sent to the browser in the first place.
 */
export function publicAuditDetail(detail: string | null): string | null {
  if (!detail) return null;
  const kept = detail.split(" · ").filter((segment) => !segment.includes("$"));
  return kept.length > 0 ? kept.join(" · ") : null;
}
