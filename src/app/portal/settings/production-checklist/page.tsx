import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { getQcChecklistTemplate } from "@/server/modules/settings/queries";
import { updateQcChecklistTemplateAction } from "@/server/modules/settings/actions";
import { PageHeader } from "@/components/portal/ui";
import { ListSettingsManager } from "@/components/portal/list-settings-manager";

export const metadata = { title: "Production Checklist" };

export default async function ProductionChecklistSettingsPage() {
  const user = await requireUser("/portal/settings/production-checklist");
  if (!can(user, "update", "Settings")) redirect("/portal/settings");

  const items = await getQcChecklistTemplate(user.companyId);

  return (
    <div className="space-y-6">
      <Link href="/portal/settings" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to settings
      </Link>
      <PageHeader
        title="Production Checklist"
        description="The QC checklist applied to every new job. Edit it here so production is consistent across jobs."
      />
      <ListSettingsManager items={items} save={updateQcChecklistTemplateAction} addLabel="Add item" placeholder="e.g. Magnetic nail sweep complete" />
    </div>
  );
}
