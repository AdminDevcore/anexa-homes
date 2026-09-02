import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { getActiveVertical } from "@/server/auth/vertical";
import { can } from "@/server/rbac/guards";
import { getQcChecklistTemplate } from "@/server/modules/settings/queries";
import { updateQcChecklistTemplateAction } from "@/server/modules/settings/actions";
import { SettingsScreenHeader } from "@/components/portal/settings-kit/screen-header";
import { ListSettingsManager } from "@/components/portal/list-settings-manager";

export const metadata = { title: "Production Checklist" };

export default async function ProductionChecklistSettingsPage() {
  const user = await requireUser("/portal/settings/production-checklist");
  if (!can(user, "update", "Settings")) redirect("/portal/settings");

  const items = await getQcChecklistTemplate(user.companyId, await getActiveVertical(user));

  return (
    <div className="space-y-6">
      <SettingsScreenHeader
        section="production_checklist"
        description="The QC checklist applied to every new job. Edit it here so production is consistent across jobs."
      />
      <ListSettingsManager
        title="Steps"
        description="Applied to every new job as it is created. Editing it here changes what future jobs are checked against — jobs already running keep the checklist they were created with."
        items={items} save={updateQcChecklistTemplateAction} addLabel="Add item" placeholder="e.g. Magnetic nail sweep complete" />
    </div>
  );
}
