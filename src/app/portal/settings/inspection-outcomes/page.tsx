import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { getActiveVertical } from "@/server/auth/vertical";
import { can } from "@/server/rbac/guards";
import { getInspectionOutcomes } from "@/server/modules/settings/queries";
import { updateInspectionOutcomesAction } from "@/server/modules/settings/actions";
import { SettingsScreenHeader } from "@/components/portal/settings-kit/screen-header";
import { ListSettingsManager } from "@/components/portal/list-settings-manager";

export const metadata = { title: "Inspection Outcomes" };

export default async function InspectionOutcomesSettingsPage() {
  const user = await requireUser("/portal/settings/inspection-outcomes");
  if (!can(user, "update", "Settings")) redirect("/portal/settings");

  // Roofing's list. This page was once offered to solar too, as "Site Survey
  // Outcomes" — but solar's visit ends at the appointment status, so the deal
  // page has no picker to spend the list on. The hub already hides the card;
  // the redirect closes the URL, because the outcomes are stored per vertical
  // and a solar session editing them would be filling in a list nothing reads.
  const vertical = await getActiveVertical(user);
  if (vertical === "solar") redirect("/portal/settings");

  const items = await getInspectionOutcomes(user.companyId, vertical);

  return (
    <div className="space-y-6">
      <SettingsScreenHeader
        section="inspection_outcomes"
        description="Customize the outcomes recorded after a roof inspection / adjuster meeting, and their order."
      />
      <ListSettingsManager
        title="Outcomes"
        description="The outcomes a rep records after a roof inspection or an adjuster meeting, in the order they are offered. Renaming one keeps every inspection already recorded against it."
        items={items}
        save={updateInspectionOutcomesAction}
        addLabel="Add outcome"
        placeholder="e.g. Approved — full replacement"
      />
    </div>
  );
}
