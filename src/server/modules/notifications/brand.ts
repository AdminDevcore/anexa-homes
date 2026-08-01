import type { Vertical } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { brandingForCompany } from "@/server/branding/resolve";
import type { EmailBrand } from "./email-templates";

/**
 * Branded email identity for a company: logo, accent, and footer contact info.
 *
 * Pass the VERTICAL OF THE RECORD the email is about — the deal, proposal or
 * document it concerns — not the sender's workspace. Mail is the one surface
 * where the two most obviously diverge: a job runs from cron with no session at
 * all, and an admin sitting in Solar can trigger a roofing customer's email.
 * Omitting it keeps the company (Roofing) identity, which is what every
 * pre-existing caller sent before this argument existed.
 */
export async function emailBrandFor(
  companyId: string,
  vertical?: Vertical | null
): Promise<{ brand: EmailBrand; fromName: string }> {
  const [branding, company] = await Promise.all([
    brandingForCompany(companyId, vertical),
    prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true, phone: true, email: true, address: true, city: true, state: true, zip: true },
    }),
  ]);
  const addr = [company?.address, [company?.city, company?.state].filter(Boolean).join(", "), company?.zip]
    .filter(Boolean)
    .join(", ");
  return {
    fromName: branding.emailFromName ?? branding.companyName,
    brand: {
      // branding.companyName already carries the vertical's brand name when one
      // is set, so it wins; the raw company name is only the fallback.
      companyName: branding.companyName || company?.name || "",
      accentColor: branding.accentColor,
      logoUrl: branding.logoUrl,
      appUrl: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
      contact: {
        phone: company?.phone ?? branding.supportPhone,
        email: company?.email ?? branding.supportEmail,
        address: addr || null,
      },
    },
  };
}
