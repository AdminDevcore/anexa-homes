import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { PORTAL_NAV } from "@/lib/nav";
import { roleLabel } from "@/lib/roles";
import { PortalShell } from "@/components/portal/portal-shell";
import { getActiveIndustry, userIndustries } from "@/server/auth/industry";
import { needsOnboarding } from "@/server/modules/onboarding/queries";
import { currentBranding } from "@/server/branding/resolve";
import { BrandingProvider } from "@/components/portal/branding-provider";

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

  const industries = userIndustries(user);
  const activeIndustry = await getActiveIndustry(user);
  const branding = await currentBranding();

  return (
    <BrandingProvider branding={branding}>
      <PortalShell
        user={{
          name: user.fullName,
          email: user.email ?? "",
          roleLabel: roleLabel(user.role),
        }}
        allowedHrefs={allowedHrefs}
        activeIndustry={activeIndustry}
        industries={industries}
        branding={branding}
      >
        {children}
      </PortalShell>
    </BrandingProvider>
  );
}
