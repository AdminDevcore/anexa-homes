"use server";

import { headers } from "next/headers";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { qualifyOnProposalAsRep } from "./proposal-qualify-rep";
import type { QualifyResult } from "./proposal-qualify";

/**
 * The rep's Qualify button, pressed from inside the portal preview.
 *
 * The counterpart to `qualifyOnProposalAction`, and the only difference that
 * matters is the authorization: there the share token IS the authorization,
 * here it is the session. The company is resolved from `requireUser()` and is
 * never accepted as an argument — see the server-action boundary guard. The
 * browser supplies the proposal it is looking at and the one fact Anexa does
 * not store, and the server proves ownership of the first before believing
 * anything about the second.
 *
 * The permission is the same pair the preview's own re-price bar is gated on.
 * Somebody who may not change what this deal is priced at may not send that
 * price to an underwriter either.
 */
export async function qualifyFromPortalAction(input: {
  proposalId: string;
  ownerOccupied: boolean;
}): Promise<QualifyResult> {
  const user = await requireUser();
  if (!can(user, "update", "Proposal") || !can(user, "update", "Lead")) {
    return {
      ok: false,
      error: "You do not have permission to start an application on this deal.",
      retryable: false,
    };
  }

  // Scoped to the session's own company, which is what turns a proposal id
  // typed by a caller into a row this user is allowed to act on.
  const proposal = await prisma.solarProposal.findFirst({
    where: { id: input.proposalId, companyId: user.companyId },
    select: {
      id: true,
      leadId: true,
      companyId: true,
      version: true,
      supersededAt: true,
      lead: { select: { vertical: true } },
    },
  });
  if (!proposal) {
    return { ok: false, error: "That proposal is not on this company's books.", retryable: false };
  }

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  return qualifyOnProposalAsRep(
    proposal,
    { fullName: user.fullName },
    { ownerOccupied: input.ownerOccupied, ip },
  );
}
