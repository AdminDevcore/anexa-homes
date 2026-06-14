import { prisma } from "@/server/db/client";
import { brandingForCompany } from "@/server/branding/resolve";
import type { EmailBrand } from "./email-templates";

/** Branded email identity for a company: logo, accent, and footer contact info. */
export async function emailBrandFor(companyId: string): Promise<{ brand: EmailBrand; fromName: string }> {
  const [branding, company] = await Promise.all([
    brandingForCompany(companyId),
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
      companyName: company?.name ?? branding.companyName,
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
