import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { PORTAL_NAV } from "@/lib/nav";
import { roleLabel } from "@/lib/roles";
import { PortalShell } from "@/components/portal/portal-shell";
import { needsOnboarding } from "@/server/modules/onboarding/queries";
import { currentBranding } from "@/server/branding/resolve";
import { BrandingProvider } from "@/components/portal/branding-provider";

export async function generateMetadata(): Promise<Metadata> {
  const branding = await currentBranding();
  return {
    title: {
      default: branding.companyName,
      template: `%s · ${branding.companyName}`,
    },
    icons: branding.faviconUrl
      ? [{ rel: "icon", url: branding.faviconUrl }]
      : undefined,
  };
}

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser("/portal/dashboard");

  // New invited users complete onboarding before entering the portal.
  if (await needsOnboarding(user.userId)) redirect("/onboarding");

  const allowedHrefs = PORTAL_NAV.filter((item) =>
    can(user, "read", item.resource)
  ).map((item) => item.href);

  const branding = await currentBranding();

  return (
    <BrandingProvider branding={branding}>
      {branding.fontFamily && (
        <style>{`:root{--tenant-font:${JSON.stringify(branding.fontFamily)};} .portal-root{font-family:var(--tenant-font),var(--font-sans),sans-serif;}`}</style>
      )}
      <PortalShell
        user={{
          name: user.fullName,
          email: user.email ?? "",
          roleLabel: roleLabel(user.role),
        }}
        allowedHrefs={allowedHrefs}
        branding={branding}
      >
        {children}
      </PortalShell>
    </BrandingProvider>
  );
}
