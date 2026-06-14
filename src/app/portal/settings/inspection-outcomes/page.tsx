import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { getInspectionOutcomes } from "@/server/modules/settings/queries";
import { updateInspectionOutcomesAction } from "@/server/modules/settings/actions";
import { PageHeader } from "@/components/portal/ui";
import { ListSettingsManager } from "@/components/portal/list-settings-manager";

export const metadata = { title: "Inspection Outcomes" };

export default async function InspectionOutcomesSettingsPage() {
  const user = await requireUser("/portal/settings/inspection-outcomes");
  if (!can(user, "update", "Settings")) redirect("/portal/settings");

  const items = await getInspectionOutcomes(user.companyId);

  return (
    <div className="space-y-6">
      <Link href="/portal/settings" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to settings
      </Link>
      <PageHeader
        title="Inspection Outcomes"
        description="Customize the outcomes recorded after a roof inspection / adjuster meeting, and their order."
      />
      <ListSettingsManager items={items} save={updateInspectionOutcomesAction} addLabel="Add outcome" placeholder="e.g. Approved — full replacement" />
    </div>
  );
}
