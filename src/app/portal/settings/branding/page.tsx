import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { SettingsScreenHeader } from "@/components/portal/settings-kit/screen-header";
import { BrandingSettings } from "@/components/portal/branding-form";
import { getActiveVertical } from "@/server/auth/vertical";
import { DEFAULT_VERTICAL, VERTICAL_LABEL } from "@/lib/vertical";
import { applyVerticalOverrides } from "@/lib/vertical-settings";

export const metadata = { title: "Branding" };

export default async function BrandingSettingsPage({
  searchParams,
}: {
  /** Which tab is open. Read on the SERVER so the first paint is the right one. */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
  const user = await requireUser();
  if (!can(user, "update", "Settings")) redirect("/portal/settings");

  const [raw, company] = await Promise.all([
    prisma.companySettings.findUnique({ where: { companyId: user.companyId } }),
    prisma.company.findUnique({ where: { id: user.companyId } }),
  ]);

  // Edit the brand for the workspace you are STANDING IN. The form is shown
  // pre-filled with the inherited values, so it is obvious what Solar will look
  // like before anything is overridden — and saving a field you did not touch
  // does not silently pin an inherited value, because the action stores only
  // what differs.
  const vertical = await getActiveVertical(user);
  const settings = applyVerticalOverrides(raw, vertical);
  const isOverride = vertical !== DEFAULT_VERTICAL;
  const overrides = ((raw?.verticalOverrides ?? {}) as Record<string, { brandName?: string }>)[
    vertical
  ];

  return (
    <div className="space-y-6">
      <SettingsScreenHeader
        section="branding"
        description="Your logo, brand colours, the company details a proposal prints, and how money and dates are formatted."
      />
      <BrandingSettings
        workspaceLabel={VERTICAL_LABEL[vertical] ?? undefined}
        isOverride={isOverride}
        initialTab={one(params.tab)}
        branding={{
          // Blank rather than the inherited value ONLY for the brand name, so
          // the placeholder can say what it will inherit. Everything else shows
          // the resolved value, which is what this workspace renders.
          brandName: overrides?.brandName ?? (isOverride ? "" : company?.name ?? ""),
          logoUrl: settings?.logoUrl ?? "",
          faviconUrl: settings?.faviconUrl ?? "",
          primaryColor: settings?.primaryColor ?? "#0B0B0C",
          accentColor: settings?.accentColor ?? "#BFA15F",
          fontFamily: settings?.fontFamily ?? "",
          emailFromName: settings?.emailFromName ?? "",
          recordPrefix: settings?.recordPrefix ?? "",
          supportPhone: settings?.supportPhone ?? "",
          supportEmail: settings?.supportEmail ?? "",
          currencyCode: settings?.currencyCode ?? "USD",
          locale: settings?.locale ?? "en-US",
          customDomain: settings?.customDomain ?? "",
          removePoweredBy: settings?.removePoweredBy ?? false,
        }}
        identity={{
          name: company?.name ?? "",
          phone: company?.phone ?? "",
          email: company?.email ?? "",
          website: company?.website ?? "",
          address: company?.address ?? "",
          city: company?.city ?? "",
          state: company?.state ?? "",
          zip: company?.zip ?? "",
          timezone: company?.timezone ?? "America/Chicago",
        }}
      />
    </div>
  );
}
