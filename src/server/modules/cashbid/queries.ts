import type { CashBidStatus } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { brandingForCompany } from "@/server/branding/resolve";
import { bidAmounts } from "./money";

export type CashBidRow = {
  id: string;
  token: string;
  workDescription: string;
  totalCents: number;
  depositPercent: number;
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
    workDescription: b.workDescription,
    totalCents: b.totalCents,
    depositPercent: b.depositPercent,
    status: b.status,
    signerName: b.signerName,
    signedAt: b.signedAt?.toISOString() ?? null,
    createdAt: b.createdAt.toISOString(),
  }));
}

export type PublicCashBid = {
  token: string;
  status: CashBidStatus;
  workDescription: string;
  totalCents: number;
  depositPercent: number;
  depositCents: number;
  balanceCents: number;
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
  const b = await prisma.cashBid.findUnique({ where: { token } });
  if (!b) return null;
  const lead = await prisma.lead.findUnique({
    where: { id: b.leadId },
    select: { firstName: true, lastName: true, address: true, city: true, state: true, zip: true },
  });
  const branding = await brandingForCompany(b.companyId);
  const amt = bidAmounts(b.totalCents, b.depositPercent);
  const addr = [lead?.address, [lead?.city, lead?.state].filter(Boolean).join(", "), lead?.zip]
    .filter(Boolean)
    .join(" · ");
  return {
    token: b.token,
    status: b.status,
    workDescription: b.workDescription,
    totalCents: amt.totalCents,
    depositPercent: amt.depositPercent,
    depositCents: amt.depositCents,
    balanceCents: amt.balanceCents,
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
