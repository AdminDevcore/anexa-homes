import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { PORTAL_NAV } from "@/lib/nav";
import { roleLabel } from "@/lib/roles";
import { PortalShell } from "@/components/portal/portal-shell";
import { needsOnboarding } from "@/server/modules/onboarding/queries";
import { currentBranding } from "@/server/branding/resolve";
import { getActiveVertical, userVerticals } from "@/server/auth/vertical";
import { solarVerticalEnabled } from "@/server/vertical/flag";
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

  const allowedHrefs = PORTAL_NAV.filter(
    (item) =>
      can(user, "read", item.resource) &&
      // `roles`, where an item has one, narrows further — it never widens.
      (!item.roles || item.roles.includes(user.role))
  ).map((item) => item.href);

  const branding = await currentBranding();

  // With the flag off there is exactly one workspace and no switcher to show,
  // so the shell renders precisely as it did before this work.
  const multiVertical = solarVerticalEnabled();
  const availableVerticals = multiVertical ? userVerticals(user) : [];

  // Always resolved — it is a cookie read, and the settings menu in the sidebar
  // needs to know which workspace's sections to list whether or not there is a
  // switcher to show. `vertical` stays null with the flag off so the header
  // renders exactly as it did before this work.
  const settingsVertical = await getActiveVertical(user);
  const vertical = multiVertical ? settingsVertical : null;

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
        vertical={vertical}
        availableVerticals={availableVerticals}
        settingsVertical={settingsVertical}
      >
        {children}
      </PortalShell>
    </BrandingProvider>
  );
}
