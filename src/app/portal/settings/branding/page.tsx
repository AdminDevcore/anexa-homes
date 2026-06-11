import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { PageHeader } from "@/components/portal/ui";
import { BrandingForm } from "@/components/portal/branding-form";

export const metadata = { title: "Branding" };

export default async function BrandingSettingsPage() {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) redirect("/portal/settings");

  const settings = await prisma.companySettings.findUnique({ where: { companyId: user.companyId } });

  return (
    <div className="space-y-6">
      <Link href="/portal/settings" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to settings
      </Link>
      <PageHeader title="Branding" description="Set your logo and brand colors used across the portal and documents." />
      <BrandingForm
        initial={{
          logoUrl: settings?.logoUrl ?? "",
          primaryColor: settings?.primaryColor ?? "#0B0B0C",
          accentColor: settings?.accentColor ?? "#BFA15F",
        }}
      />
    </div>
  );
}
