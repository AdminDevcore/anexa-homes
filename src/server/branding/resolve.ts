import { cache } from "react";
import { prisma } from "@/server/db/client";
import { getSessionUser } from "@/server/auth/session";
import { resolveBranding, DEFAULT_BRANDING, type Branding } from "./defaults";

const SELECT = {
  recordPrefix: true,
  supportPhone: true,
  supportEmail: true,
  currencyCode: true,
  locale: true,
  logoUrl: true,
  faviconUrl: true,
  primaryColor: true,
  accentColor: true,
  fontFamily: true,
  emailFromName: true,
  customDomain: true,
  removePoweredBy: true,
} as const;

/** Resolve branding for a specific company id. */
export async function brandingForCompany(companyId: string): Promise<Branding> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { name: true, timezone: true, settings: { select: SELECT } },
  });
  if (!company) {
    return resolveBranding({ company: { name: "" }, settings: null });
  }
  return resolveBranding({
    company: { name: company.name, timezone: company.timezone },
    settings: company.settings,
  });
}

/** Branding for the logged-in user's company. Request-cached so repeated calls are free. */
export const currentBranding = cache(async (): Promise<Branding> => {
  const user = await getSessionUser();
  if (!user) {
    return resolveBranding({ company: { name: "" }, settings: null });
  }
  return brandingForCompany(user.companyId);
});

/** Pre-auth branding by hostname (custom domain). Falls back to neutral defaults. */
export const brandingForHost = cache(async (hostname: string | null): Promise<Branding | null> => {
  if (!hostname) return null;
  const host = hostname.split(":")[0].toLowerCase();
  const settings = await prisma.companySettings.findFirst({
    where: { customDomain: host },
    select: { ...SELECT, company: { select: { name: true, timezone: true } } },
  });
  if (!settings) return null;
  return resolveBranding({
    company: { name: settings.company.name, timezone: settings.company.timezone },
    settings,
  });
});

export { DEFAULT_BRANDING };
