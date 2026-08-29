import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { getActiveVertical } from "@/server/auth/vertical";
import { can } from "@/server/rbac/guards";
import { PageHeader } from "@/components/portal/ui";
import { listBackupProfiles, listRebates } from "@/server/modules/solar/storage";
import {
  BackupProfileManager,
  RebateManager,
} from "@/components/portal/solar-storage-settings";

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
      <Link
        href="/portal/settings"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Settings
      </Link>

      <PageHeader
        title="Storage"
        description="What a battery is asked to carry, and whose money comes off the price."
      />

      <BackupProfileManager rows={profiles} canEdit={canEdit} />
      <RebateManager rows={rebates} canEdit={canEdit} />
    </div>
  );
}
