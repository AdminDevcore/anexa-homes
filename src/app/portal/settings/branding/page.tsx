import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { PageHeader } from "@/components/portal/ui";
import { BrandingForm } from "@/components/portal/branding-form";
import { getActiveVertical } from "@/server/auth/vertical";
import { DEFAULT_VERTICAL, VERTICAL_LABEL } from "@/lib/vertical";
import { applyVerticalOverrides } from "@/lib/vertical-settings";
import { CompanyIdentityForm } from "@/components/portal/company-identity-form";

export const metadata = { title: "Branding" };

export default async function BrandingSettingsPage() {
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
      <Link href="/portal/settings" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to settings
      </Link>
      <PageHeader title="Branding" description="Set your logo, colors, company information, and localization settings used across the portal and documents." />
      <div className="grid gap-6 lg:grid-cols-2">
        <BrandingForm
          workspaceLabel={VERTICAL_LABEL[vertical] ?? undefined}
          isOverride={isOverride}
          initial={{
            // Blank rather than the inherited value ONLY for the brand name, so
            // the placeholder can say what it will inherit. Everything else
            // shows the resolved value, which is what this workspace renders.
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
        />
        <CompanyIdentityForm
          initial={{
            name: company?.name ?? "",
            phone: company?.phone ?? "",
            email: company?.email ?? "",
            address: company?.address ?? "",
            city: company?.city ?? "",
            state: company?.state ?? "",
            zip: company?.zip ?? "",
            timezone: company?.timezone ?? "America/Chicago",
          }}
        />
      </div>
    </div>
  );
}
