"use server";

import { headers } from "next/headers";
import { acceptSolarProposal } from "./proposal-public";

/**
 * Customer-facing accept. No session: the share token is the authorization,
 * exactly like the other public token flows.
 */
export async function acceptSolarProposalAction(token: string, name: string) {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  return acceptSolarProposal(token, { name, ip });
}
