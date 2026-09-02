import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { getActiveVertical } from "@/server/auth/vertical";
import { stormEnabled } from "@/lib/vertical-features";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { SettingsScreenHeader } from "@/components/portal/settings-kit/screen-header";
import { StormCoverageSettings } from "@/components/portal/storm-coverage-settings";
import { OwnerDataRefreshPanel } from "@/components/portal/owner-data-refresh-panel";
import { CountyRecordsImport } from "@/components/portal/county-records-import";
import { getOwnerEnrichmentStats } from "@/server/modules/canvassing/queries";
import { skipTraceEnabled } from "@/server/modules/skiptrace/provider";

export async function generateMetadata() {
  const user = await requireUser("/portal/settings/storm-coverage");
  return {
    title: stormEnabled(await getActiveVertical(user)) ? "Storm & Homeowner Data" : "Homeowner Data",
  };
}

export default async function StormCoveragePage() {
  const user = await requireUser("/portal/settings/storm-coverage");
  if (!can(user, "update", "StormIntelligence")) redirect("/portal/settings");

  // Owner re-verify and county records are ordinary canvassing tooling and stay
  // in every workspace. The storm search area is the only roofing-specific panel
  // here, so solar gets the page without it rather than losing the page.
  const vertical = await getActiveVertical(user);
  const storm = stormEnabled(vertical);

  const [s, enrichStats] = await Promise.all([
    storm
      ? prisma.companySettings.findUnique({
          where: { companyId: user.companyId },
          select: { stormCenterLat: true, stormCenterLng: true, stormRadiusMiles: true },
        })
      : null,
    getOwnerEnrichmentStats(user.companyId),
  ]);
  const hasCenter = s?.stormCenterLat != null && s?.stormCenterLng != null;

  return (
    <div className="space-y-6">
      <SettingsScreenHeader
        section="storm_homeowner"
        vertical={vertical}
        title={storm ? "Storm & Homeowner Data" : "Homeowner Data"}
        description={
          storm
            ? "Control where the Field Map pulls storm reports, and re-verify homeowner data across every house."
            : "Re-verify homeowner data across every house, and import county records."
        }
      />
      {storm && (
        <StormCoverageSettings
          initial={{
            centerLat: s?.stormCenterLat ?? null,
            centerLng: s?.stormCenterLng ?? null,
            radiusMiles: s?.stormRadiusMiles ?? 100,
            isDefault: !hasCenter,
          }}
        />
      )}
      <OwnerDataRefreshPanel stats={enrichStats} enabled={skipTraceEnabled()} />
      <CountyRecordsImport />
    </div>
  );
}
