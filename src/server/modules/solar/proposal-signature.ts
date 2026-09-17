import crypto from "node:crypto";
import { prisma } from "@/server/db/client";
import { runUnscoped } from "@/server/vertical/context";
import { readProposalSnapshot } from "@/lib/solar-proposal";
import {
  publicAuditDetail,
  type ProposalAuditEvent,
  type ProposalCertificate,
  type ProposalSignature,
} from "@/lib/proposal-signature";

/**
 * Reading the signature off a proposal row, and building the record that proves
 * it.
 *
 * NOT a "use server" module and deliberately not part of proposal-public.ts:
 * three different doors onto this document need the same answer — the
 * customer's link, the internal preview and the headless renderer that files
 * the PDF — and each of them resolves the proposal a different way. Only the
 * mapping is shared.
 */

/**
 * The columns every caller needs to render an executed document. Spread into a
 * `select` so a page cannot render the block having forgotten one field and
 * quietly print a signature with no date under it.
 */
export const SIGNATURE_SELECT = {
  signatureData: true,
  signatureType: true,
  signerName: true,
  signerEmail: true,
  signedAt: true,
  consentAt: true,
  signedVia: true,
  signedHostId: true,
} as const;

type SignatureRow = {
  signatureData: string | null;
  signatureType: "typed" | "drawn" | null;
  signerName: string | null;
  signerEmail: string | null;
  signedAt: Date | null;
  consentAt: Date | null;
  signedVia: string | null;
  signedHostId: string | null;
};

/**
 * The signature on a proposal, or null if it has not been signed.
 *
 * `signedAt` is the ONLY thing that decides. Proposals accepted before
 * signatures were captured have a timestamp and nothing else, and they are
 * signed — the block renders the name and the date and says the mark was not
 * captured, rather than pretending the acceptance never happened.
 */
export function signatureFrom(row: SignatureRow, hostName: string | null = null): ProposalSignature | null {
  if (!row.signedAt) return null;
  return {
    name: row.signerName ?? "",
    email: row.signerEmail,
    mark: row.signatureData,
    method: row.signatureType,
    signedAt: row.signedAt.toISOString(),
    consentAt: row.consentAt?.toISOString() ?? null,
    via: row.signedVia === "in_person" ? "in_person" : row.signedVia === "remote" ? "remote" : null,
    hostName,
  };
}

/** The rep who hosted an in-person signing, by name. Null for a remote one. */
export async function hostNameFor(companyId: string, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const u = await prisma.user.findFirst({
    where: { companyId, id: userId },
    select: { firstName: true, lastName: true },
  });
  if (!u) return null;
  return [u.firstName, u.lastName].filter(Boolean).join(" ") || null;
}

/**
 * SHA-256 of the frozen snapshot, hex.
 *
 * Over the CANONICAL JSON — keys sorted at every level — because
 * `JSON.stringify` preserves insertion order, and a snapshot read back through
 * Prisma is not guaranteed to hand its keys over in the order they were
 * written. A fingerprint that changes because the database returned the same
 * object with its properties in a different sequence proves nothing at all.
 */
export function snapshotFingerprint(snapshot: unknown): string {
  return crypto.createHash("sha256").update(canonical(snapshot)).digest("hex");
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
    .join(",")}}`;
}

/** Format a fingerprint the way a person has to read one off paper. */
export function groupFingerprint(hex: string): string {
  return (hex.match(/.{1,8}/g) ?? [hex]).join(" ");
}

/**
 * The full signing record for one proposal, or null if it is not signed.
 *
 * Unscoped for the same reason the public read is: this runs for the customer's
 * anonymous link and for the headless renderer, neither of which has a
 * workspace. The proposal id is the authority — every caller has already proven
 * its right to that one row through a share token or a print signature.
 */
export async function certificateFor(proposalId: string): Promise<ProposalCertificate | null> {
  const proposal = await runUnscoped(
    "proposal certificate: resolve the signing record for a document already authorised",
    () =>
      prisma.solarProposal.findUnique({
        where: { id: proposalId },
        select: {
          companyId: true,
          version: true,
          snapshot: true,
          signedIp: true,
          signedUserAgent: true,
          ...SIGNATURE_SELECT,
          events: {
            orderBy: { createdAt: "asc" },
            select: { type: true, createdAt: true, actorName: true, ip: true, detail: true },
          },
        },
      })
  );
  if (!proposal?.signedAt) return null;

  const signature = signatureFrom(
    proposal,
    await hostNameFor(proposal.companyId, proposal.signedHostId)
  );
  if (!signature) return null;

  const snapshot = readProposalSnapshot(proposal.snapshot)!;
  /**
   * REDACTED HERE, at the one place a certificate is built.
   *
   * These details are written for us and read by the customer: the trail is
   * printed on the sheet bound into the homeowner's own PDF. `publicAuditDetail`
   * drops the segments that name a figure — chiefly the lender adjustment
   * ladder on `generated`, which quoted the household's price against the
   * lender's contract value and so told the customer what was carried above
   * their price. Stripped on the server, before the record crosses into a
   * client document or a Server Action's reply, so the number is not merely
   * unrendered but absent.
   */
  const events: ProposalAuditEvent[] = proposal.events.map((e) => ({
    type: e.type,
    at: e.createdAt.toISOString(),
    actor: e.actorName,
    ip: e.ip,
    detail: publicAuditDetail(e.detail),
  }));

  return {
    signature,
    documentTitle: `Solar proposal v${proposal.version} · ${snapshot.reference}`,
    customerName: snapshot.customer.name,
    propertyAddress: snapshot.customer.address || null,
    companyName: snapshot.company.name,
    fingerprint: snapshotFingerprint(proposal.snapshot),
    ip: proposal.signedIp,
    userAgent: proposal.signedUserAgent,
    events,
  };
}
