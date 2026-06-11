import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { PageHeader } from "@/components/portal/ui";
import { BrandingForm } from "@/components/portal/branding-form";
import { CompanyIdentityForm } from "@/components/portal/company-identity-form";

export const metadata = { title: "Branding" };

export default async function BrandingSettingsPage() {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) redirect("/portal/settings");

  const [settings, company] = await Promise.all([
    prisma.companySettings.findUnique({ where: { companyId: user.companyId } }),
    prisma.company.findUnique({ where: { id: user.companyId } }),
  ]);

  return (
    <div className="space-y-6">
      <Link href="/portal/settings" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to settings
      </Link>
      <PageHeader title="Branding" description="Set your logo, colors, company information, and localization settings used across the portal and documents." />
      <div className="grid gap-6 lg:grid-cols-2">
        <BrandingForm
          initial={{
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
