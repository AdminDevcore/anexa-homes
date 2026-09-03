"use server";

import { headers } from "next/headers";
import { getPublicSolarProposal } from "./proposal-public";
import { qualifyOnProposal, type QualifyResult } from "./proposal-qualify";

/**
 * The customer's Qualify button. No session: the share token is the
 * authorization, exactly like the signing flow next to it.
 *
 * The token buys ONE thing — the right to act on the proposal it names. Which
 * lender, which key, which amount and which term are all re-read from that
 * deal on the server. The browser supplies a single fact, and it is the one
 * Anexa does not store: whether the applicant lives in the house.
 */
export async function qualifyOnProposalAction(input: {
  token: string;
  ownerOccupied: boolean;
}): Promise<QualifyResult> {
  const proposal = await getPublicSolarProposal(input.token);
  // Deliberately the same sentence a bad token gets: a page that distinguishes
  // "no such proposal" from "exists but not sent" is a page you can probe.
  if (!proposal) return { ok: false, error: "This proposal is no longer available." };

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  return qualifyOnProposal(proposal, { ownerOccupied: input.ownerOccupied, ip });
}
