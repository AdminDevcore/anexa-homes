"use server";

import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { runInVertical, asActiveVertical } from "@/server/vertical/context";
import { checkDealWithLender, type LenderCheckResult } from "./lender-submit";

/**
 * LOOKING AT WHAT THE LENDER IS BEING TOLD.
 *
 * A separate module from `lender-submit` for the reason that file states about
 * itself: every export of a "use server" module is a callable endpoint, and the
 * submission logic is shared middle ground that establishes no authorization of
 * its own. This is the door — it resolves the session, checks the permission,
 * and hands `lender-submit` a companyId it resolved itself.
 *
 * SAME PERMISSION AS SENDING. Somebody who may not put a price in front of an
 * underwriter has no business reading the application either: the payload
 * carries the household's name, address, telephone number and the amount they
 * are asking to borrow.
 */

const denied = { ok: false as const, error: "Not allowed." };

/**
 * Ask the lender whether this deal would be accepted, without sending it.
 *
 * Their endpoint writes nothing — no application, no credit file, no email and
 * no text to the household — so this is safe to press as often as anybody
 * likes. That is the entire value: every refusal it surfaces is one a customer
 * never watches happen.
 */
export async function checkDealWithLenderAction(leadId: string): Promise<LenderCheckResult> {
  const user = await requireUser();
  if (!can(user, "update", "Lead") || !can(user, "update", "Proposal")) return denied;

  const lead = await prisma.lead.findFirst({
    where: { id: leadId, companyId: user.companyId },
    select: { id: true, vertical: true },
  });
  if (!lead) return { ok: false, error: "Deal not found." };

  // In the DEAL'S vertical, not the caller's. `SolarDesign` is a scoped model,
  // so an admin sitting in the roofing workspace would otherwise read no design
  // at all and be told this deal has no direct submission.
  return runInVertical(asActiveVertical(lead.vertical), () =>
    checkDealWithLender(leadId, user.companyId, user.fullName),
  );
}

export type SubmissionLogRow = {
  id: string;
  at: string;
  ok: boolean;
  lenderName: string;
  externalId: string;
  status: number | null;
  code: string | null;
  message: string | null;
  referenceNumber: string | null;
  /** Which figure produced the amount on this attempt. */
  amountBasis: string | null;
  actorName: string | null;
  request: unknown;
};

/**
 * Every attempt on this deal, newest first.
 *
 * Capped rather than paged: this is a diagnostic on one deal, and the worst
 * real case — six retries against a partner returning 500 — fits comfortably.
 */
export async function readSubmissionLogAction(leadId: string): Promise<SubmissionLogRow[]> {
  const user = await requireUser();
  if (!can(user, "update", "Lead") || !can(user, "update", "Proposal")) return [];

  const rows = await prisma.solarLenderSubmission.findMany({
    where: { leadId, companyId: user.companyId },
    orderBy: { createdAt: "desc" },
    take: 25,
  });

  return rows.map((r) => ({
    id: r.id,
    at: r.createdAt.toISOString(),
    ok: r.ok,
    lenderName: r.lenderName,
    externalId: r.externalId,
    status: r.status,
    code: r.code,
    message: r.message,
    referenceNumber: r.referenceNumber,
    amountBasis: r.amountBasis,
    actorName: r.actorName,
    request: r.request,
  }));
}
