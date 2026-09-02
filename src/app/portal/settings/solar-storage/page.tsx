import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { getActiveVertical } from "@/server/auth/vertical";
import { can } from "@/server/rbac/guards";
import { SettingsScreenHeader } from "@/components/portal/settings-kit/screen-header";
import { listBackupProfiles, listRebates } from "@/server/modules/solar/storage";
import { SolarStorageSettings } from "@/components/portal/solar-storage-settings";

export const dynamic = "force-dynamic";

export const metadata = { title: "Storage" };

/**
 * The two company lists behind a battery quote.
 *
 * A storage deal argues from backup hours rather than from production, and
 * those hours are derived from the load profiles here — a company with none
 * cannot state an hours figure at all. Rebates sit beside them because both
 * exist only once a deal can carry a battery.
 */
export default async function SolarStorageSettingsPage() {
  const user = await requireUser("/portal/settings/solar-storage");
  if (!can(user, "read", "Settings")) redirect("/portal/dashboard");
  if ((await getActiveVertical(user)) !== "solar") redirect("/portal/settings");

  // Retired rows included: the screen has to be able to show and revive one.
  const [profiles, rebates] = await Promise.all([
    listBackupProfiles(user.companyId, false),
    listRebates(user.companyId, false),
  ]);

  const canEdit = can(user, "update", "Settings");

  return (
    <div className="space-y-6">

      <SettingsScreenHeader
        section="solar_storage"
        description="What a battery is asked to carry, and whose money comes off the price."
      />

      <SolarStorageSettings profiles={profiles} rebates={rebates} canEdit={canEdit} />
    </div>
  );
}
