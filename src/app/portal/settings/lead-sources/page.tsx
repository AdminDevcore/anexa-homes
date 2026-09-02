import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { getLeadSourcesForSettings } from "@/server/modules/settings/queries";
import { SettingsScreenHeader } from "@/components/portal/settings-kit/screen-header";
import { LeadSourcesManager } from "@/components/portal/lead-sources-manager";

export const metadata = { title: "Lead Sources" };

export default async function LeadSourcesSettingsPage() {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) redirect("/portal/settings");

  const items = await getLeadSourcesForSettings(user.companyId);

  return (
    <div className="space-y-6">
      <SettingsScreenHeader
        section="lead_sources"
        description="Customize the “Source” options reps choose when booking a lead — add, rename, reorder, or retire channels."
      />
      <LeadSourcesManager items={items} />
    </div>
  );
}
