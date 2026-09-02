import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { getActiveVertical } from "@/server/auth/vertical";
import { can } from "@/server/rbac/guards";
import { getAppointmentDispositions } from "@/server/modules/settings/queries";
import { SettingsScreenHeader } from "@/components/portal/settings-kit/screen-header";
import { AppointmentDispositionsManager } from "@/components/portal/appointment-dispositions-manager";

export const metadata = { title: "Appointment Outcomes" };

export default async function AppointmentOutcomesSettingsPage() {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) redirect("/portal/settings");

  const items = await getAppointmentDispositions(user.companyId, await getActiveVertical(user));

  return (
    <div className="space-y-6">
      <SettingsScreenHeader
        section="appointment_outcomes"
        description="Customize the outcomes a rep can record when running an appointment, their wording, and order."
      />
      <AppointmentDispositionsManager items={items} />
    </div>
  );
}
