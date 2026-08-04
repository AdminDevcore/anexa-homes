import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { getActiveVertical } from "@/server/auth/vertical";
import { can } from "@/server/rbac/guards";
import { getInspectionOutcomes } from "@/server/modules/settings/queries";
import { updateInspectionOutcomesAction } from "@/server/modules/settings/actions";
import { PageHeader } from "@/components/portal/ui";
import { ListSettingsManager } from "@/components/portal/list-settings-manager";

export async function generateMetadata() {
  const user = await requireUser("/portal/settings/inspection-outcomes");
  return {
    title: (await getActiveVertical(user)) === "solar" ? "Site Survey Outcomes" : "Inspection Outcomes",
  };
}

export default async function InspectionOutcomesSettingsPage() {
  const user = await requireUser("/portal/settings/inspection-outcomes");
  if (!can(user, "update", "Settings")) redirect("/portal/settings");

  const vertical = await getActiveVertical(user);
  const items = await getInspectionOutcomes(user.companyId, vertical);

  // Same stored list, same page — different visit. Roofing meets an adjuster on
  // a roof; solar runs a site survey that gates engineering. The wording follows
  // the deal page, which already labels this field per vertical.
  const isSolar = vertical === "solar";

  return (
    <div className="space-y-6">
      <Link href="/portal/settings" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to settings
      </Link>
      <PageHeader
        title={isSolar ? "Site Survey Outcomes" : "Inspection Outcomes"}
        description={
          isSolar
            ? "Customize the outcomes recorded after a site survey, and their order."
            : "Customize the outcomes recorded after a roof inspection / adjuster meeting, and their order."
        }
      />
      <ListSettingsManager
        items={items}
        save={updateInspectionOutcomesAction}
        addLabel="Add outcome"
        placeholder={isSolar ? "e.g. Main panel upgrade required" : "e.g. Approved — full replacement"}
      />
    </div>
  );
}
