"use server";

import { after } from "next/server";
import { headers } from "next/headers";
import { acceptSolarProposal } from "./proposal-public";
import { kickSignedProposalFiling } from "./signed-filing-kick";
import type { ProposalCertificate } from "@/lib/proposal-signature";

/**
 * Customer-facing signature. No session: the share token is the authorization,
 * exactly like the other public token flows.
 *
 * The IP and the user agent are taken from the REQUEST and never from the
 * payload. They are the only two facts in the signing record the signer cannot
 * choose, which is what makes them worth recording at all.
 */
export async function signSolarProposalAction(input: {
  token: string;
  name: string;
  signature: string;
  signatureType: "typed" | "drawn";
  consentAtMs: number | null;
  /** Present only when a rep opened this session on their own device. */
  witness?: string | null;
}): Promise<{ ok: boolean; error?: string; certificate?: ProposalCertificate }> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const { proposalId, ...result } = await acceptSolarProposal(input.token, {
    name: input.name,
    signature: input.signature,
    signatureType: input.signatureType,
    consentAtMs: input.consentAtMs,
    witness: input.witness ?? null,
    ip,
    userAgent: h.get("user-agent"),
  });

  // The signed PDF is filed into the deal's Proposal folder as part of signing,
  // once the customer already has their certificate — see signed-filing-kick.ts.
  if (result.ok && proposalId) after(() => kickSignedProposalFiling(proposalId));

  return result;
}
