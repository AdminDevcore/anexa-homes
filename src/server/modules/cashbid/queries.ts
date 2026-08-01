import type { CashBidStatus } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { brandingForRecord } from "@/server/branding/resolve";
import { bidAmounts } from "./money";
import { runUnscoped } from "@/server/vertical/context";

export type CashBidRow = {
  id: string;
  token: string;
  kind: string;
  workDescription: string;
  totalCents: number;
  depositPercent: number;
  deductibleCents: number;
  status: CashBidStatus;
  signerName: string | null;
  signedAt: string | null;
  createdAt: string;
};

export async function getCashBidsForLead(companyId: string, leadId: string): Promise<CashBidRow[]> {
  const bids = await prisma.cashBid.findMany({ where: { companyId, leadId }, orderBy: { createdAt: "desc" } });
  return bids.map((b) => ({
    id: b.id,
    token: b.token,
    kind: b.kind,
    workDescription: b.workDescription,
    totalCents: b.totalCents,
    depositPercent: b.depositPercent,
    deductibleCents: b.deductibleCents,
    status: b.status,
    signerName: b.signerName,
    signedAt: b.signedAt?.toISOString() ?? null,
    createdAt: b.createdAt.toISOString(),
  }));
}

export type PublicCashBid = {
  token: string;
  status: CashBidStatus;
  kind: string;
  workDescription: string;
  totalCents: number;
  depositPercent: number;
  depositCents: number;
  balanceCents: number;
  deductibleCents: number;
  carrier: string | null;
  claimNumber: string | null;
  warrantyWorkmanshipYears: number;
  warrantyManufacturerYears: number;
  signatureMode: string;
  signerName: string | null;
  signedAt: string | null;
  createdAt: string;
  homeownerName: string;
  propertyAddress: string;
  company: {
    name: string;
    logoUrl: string | null;
    supportPhone: string | null;
    supportEmail: string | null;
    currencyCode: string;
    locale: string;
    primaryColor: string;
  };
};

/** The public one-page bid for the homeowner (token-gated, unauthenticated). */
export async function getCashBidByToken(token: string): Promise<PublicCashBid | null> {
  return runUnscoped(
    "public token page: the unguessable token is the authorization and identifies exactly one row, whose vertical is not known until it is read",
    () => loadCashBidByToken(token)
  );
}

async function loadCashBidByToken(token: string): Promise<PublicCashBid | null> {
  const b = await prisma.cashBid.findUnique({ where: { token } });
  if (!b) return null;
  const lead = await prisma.lead.findUnique({
    where: { id: b.leadId },
    select: { firstName: true, lastName: true, address: true, city: true, state: true, zip: true },
  });
  // The signature page is opened by the customer with no session — brand it
  // from the BID's vertical, never from an ambient workspace.
  const branding = await brandingForRecord(b.companyId, b.vertical);
  const amt = bidAmounts(b.totalCents, b.depositPercent);
  const addr = [lead?.address, [lead?.city, lead?.state].filter(Boolean).join(", "), lead?.zip]
    .filter(Boolean)
    .join(" · ");
  return {
    token: b.token,
    status: b.status,
    kind: b.kind,
    workDescription: b.workDescription,
    totalCents: amt.totalCents,
    depositPercent: amt.depositPercent,
    depositCents: amt.depositCents,
    balanceCents: amt.balanceCents,
    deductibleCents: b.deductibleCents,
    carrier: b.carrier,
    claimNumber: b.claimNumber,
    warrantyWorkmanshipYears: b.warrantyWorkmanshipYears,
    warrantyManufacturerYears: b.warrantyManufacturerYears,
    signatureMode: b.signatureMode,
    signerName: b.signerName,
    signedAt: b.signedAt?.toISOString() ?? null,
    createdAt: b.createdAt.toISOString(),
    homeownerName: lead ? `${lead.firstName} ${lead.lastName}`.trim() : "Homeowner",
    propertyAddress: addr,
    company: {
      name: branding.companyName,
      logoUrl: branding.logoUrl,
      supportPhone: branding.supportPhone,
      supportEmail: branding.supportEmail,
      currencyCode: branding.currencyCode,
      locale: branding.locale,
      primaryColor: branding.primaryColor,
    },
  };
}
