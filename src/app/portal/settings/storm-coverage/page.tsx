import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { PageHeader } from "@/components/portal/ui";
import { StormCoverageSettings } from "@/components/portal/storm-coverage-settings";

export const metadata = { title: "Storm Coverage" };

export default async function StormCoveragePage() {
  const user = await requireUser("/portal/settings/storm-coverage");
  if (!can(user, "update", "StormIntelligence")) redirect("/portal/settings");

  const s = await prisma.companySettings.findUnique({
    where: { companyId: user.companyId },
    select: { stormCenterLat: true, stormCenterLng: true, stormRadiusMiles: true },
  });
  const hasCenter = s?.stormCenterLat != null && s?.stormCenterLng != null;

  return (
    <div className="space-y-6">
      <Link href="/portal/settings" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to settings
      </Link>
      <PageHeader
        title="Storm Coverage"
        description="Set the search area (center + radius) for the Field Map's storm intelligence — where NOAA/SPC storm reports are pulled and matched to houses."
      />
      <StormCoverageSettings
        initial={{
          centerLat: s?.stormCenterLat ?? null,
          centerLng: s?.stormCenterLng ?? null,
          radiusMiles: s?.stormRadiusMiles ?? 100,
          isDefault: !hasCenter,
        }}
      />
    </div>
  );
}
