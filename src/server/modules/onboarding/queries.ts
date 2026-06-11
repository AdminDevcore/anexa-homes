import { prisma } from "@/server/db/client";
import { maskTail } from "@/server/lib/crypto";

export type OnboardingView = {
  completedAt: string | null;
  legalFirstName: string | null;
  legalMiddleName: string | null;
  legalLastName: string | null;
  dateOfBirth: string | null;
  ssnMasked: string | null; // ••••1234 (never the full value)
  address: string | null; city: string | null; state: string | null; zip: string | null;
  bankName: string | null;
  routingNumber: string | null;
  accountMasked: string | null;
  accountType: string | null;
  taxClassification: string | null;
  businessName: string | null;
  einMasked: string | null;
  signatureName: string | null;
  idPhotoFileId: string | null;
  ssnCardFileId: string | null;
  voidedCheckFileId: string | null;
};

function toView(o: NonNullable<Awaited<ReturnType<typeof raw>>>): OnboardingView {
  return {
    completedAt: o.completedAt ? o.completedAt.toISOString() : null,
    legalFirstName: o.legalFirstName, legalMiddleName: o.legalMiddleName, legalLastName: o.legalLastName,
    dateOfBirth: o.dateOfBirth ? o.dateOfBirth.toISOString() : null,
    ssnMasked: o.ssnLast4 ? maskTail(`*****${o.ssnLast4}`, 4) : null,
    address: o.address, city: o.city, state: o.state, zip: o.zip,
    bankName: o.bankName, routingNumber: o.routingNumber,
    accountMasked: o.accountLast4 ? maskTail(`****${o.accountLast4}`, 4) : null,
    accountType: o.accountType,
    taxClassification: o.taxClassification, businessName: o.businessName,
    einMasked: o.einLast4 ? maskTail(`*****${o.einLast4}`, 4) : null,
    signatureName: o.signatureName,
    idPhotoFileId: o.idPhotoFileId, ssnCardFileId: o.ssnCardFileId, voidedCheckFileId: o.voidedCheckFileId,
  };
}

function raw(userId: string) {
  return prisma.userOnboarding.findUnique({ where: { userId } });
}

/** The current user's own onboarding record (for the wizard / their own view). */
export async function getMyOnboarding(userId: string): Promise<OnboardingView | null> {
  const o = await raw(userId);
  return o ? toView(o) : null;
}

/** A team member's onboarding for the profile page (masked; viewer is already RBAC-gated). */
export async function getUserOnboarding(companyId: string, userId: string): Promise<OnboardingView | null> {
  const u = await prisma.user.findFirst({ where: { id: userId, companyId }, select: { id: true } });
  if (!u) return null;
  const o = await raw(userId);
  return o ? toView(o) : null;
}

/** True if the user still needs to complete onboarding (drives the post-login redirect). */
export async function needsOnboarding(userId: string): Promise<boolean> {
  const o = await prisma.userOnboarding.findUnique({ where: { userId }, select: { completedAt: true } });
  return !o?.completedAt;
}
