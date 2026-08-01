import { cache } from "react";
import type { Vertical } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { getSessionUser } from "@/server/auth/session";
import { getActiveVertical } from "@/server/auth/vertical";
import { applyVerticalOverrides } from "@/lib/vertical-settings";
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
  verticalOverrides: true,
} as const;

/**
 * Resolve branding for a company, optionally as a specific vertical.
 *
 * Anexa runs two brands from one entity: Roofing is Anexa Homes, Solar is Prime
 * Solar. Passing no vertical yields the company (Roofing) values — which is
 * exactly what every pre-existing caller gets, so their output is unchanged.
 */
export async function brandingForCompany(
  companyId: string,
  vertical?: Vertical | null
): Promise<Branding> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { name: true, timezone: true, settings: { select: SELECT } },
  });
  if (!company) {
    return resolveBranding({ company: { name: "" }, settings: null });
  }
  return resolveBranding({
    company: { name: company.name, timezone: company.timezone },
    settings: applyVerticalOverrides(company.settings, vertical),
  });
}

/**
 * Branding for a CUSTOMER-FACING record, resolved from the record's own
 * vertical.
 *
 * This is the important one. Everything a customer sees — a proposal, a
 * contract, an e-sign page, an outbound email — must be branded by the DEAL it
 * belongs to, never by whoever happens to be logged in. An anonymous visitor
 * opening a solar proposal has no session and no workspace cookie at all, and a
 * roofing contract must still say Anexa Homes when the admin who sent it is
 * sitting in the Solar workspace.
 *
 * Taking the vertical as a REQUIRED argument is the point: there is no ambient
 * fallback available to get wrong.
 */
export async function brandingForRecord(
  companyId: string,
  vertical: Vertical
): Promise<Branding> {
  return brandingForCompany(companyId, vertical);
}

/**
 * Branding for the logged-in user's company, in THEIR active workspace.
 *
 * Staff UI only. Never use this for anything a customer sees — that is what
 * brandingForRecord is for. Request-cached so repeated calls are free.
 */
export const currentBranding = cache(async (): Promise<Branding> => {
  const user = await getSessionUser();
  if (!user) {
    return resolveBranding({ company: { name: "" }, settings: null });
  }
  const vertical = await getActiveVertical(user);
  return brandingForCompany(user.companyId, vertical);
});

/**
 * Pre-auth branding by hostname (custom domain). Falls back to neutral defaults.
 *
 * `customDomain` is per-vertical now, so a host may be configured either on the
 * base column (the company / Roofing domain) or inside a vertical's overrides
 * (Prime Solar's own domain). The base column is checked FIRST, by exactly the
 * indexed query this always used, so the existing roofing domain resolves
 * identically; the override lookup only runs when that misses.
 */
export const brandingForHost = cache(async (hostname: string | null): Promise<Branding | null> => {
  if (!hostname) return null;
  const host = hostname.split(":")[0].toLowerCase();

  const onBase = await prisma.companySettings.findFirst({
    where: { customDomain: host },
    select: { ...SELECT, company: { select: { name: true, timezone: true } } },
  });
  if (onBase) {
    return resolveBranding({
      company: { name: onBase.company.name, timezone: onBase.company.timezone },
      settings: onBase,
    });
  }

  // A vertical-specific domain lives inside the overrides JSON, so it cannot be
  // matched by the indexed column lookup above.
  const match = await prisma.companySettings.findFirst({
    where: {
      OR: (["roofing", "solar"] as const).map((v) => ({
        verticalOverrides: { path: [v, "customDomain"], equals: host },
      })),
    },
    select: { ...SELECT, company: { select: { name: true, timezone: true } } },
  });
  if (!match) return null;

  const overrides = (match.verticalOverrides ?? {}) as Record<string, { customDomain?: string }>;
  const vertical = (["roofing", "solar"] as const).find(
    (v) => overrides[v]?.customDomain === host
  );
  return resolveBranding({
    company: { name: match.company.name, timezone: match.company.timezone },
    settings: applyVerticalOverrides(match, vertical ?? null),
  });
});

export { DEFAULT_BRANDING };
