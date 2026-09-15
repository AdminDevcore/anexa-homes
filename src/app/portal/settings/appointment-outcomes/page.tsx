import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { getActiveVertical } from "@/server/auth/vertical";
import { can } from "@/server/rbac/guards";
import { getAppointmentDispositions } from "@/server/modules/settings/queries";
import { SettingsScreenHeader } from "@/components/portal/settings-kit/screen-header";
import { AppointmentDispositionsManager } from "@/components/portal/appointment-dispositions-manager";
import { DEFAULT_APPOINTMENT_DISPOSITIONS, DEFAULT_SOLAR_APPOINTMENT_DISPOSITIONS } from "@/lib/dispositions";

export const metadata = { title: "Appointment Outcomes" };

export default async function AppointmentOutcomesSettingsPage() {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) redirect("/portal/settings");

  const vertical = await getActiveVertical(user);
  const items = await getAppointmentDispositions(user.companyId, vertical);
  const solar = vertical === "solar";

  return (
    <div className="space-y-6">
      <SettingsScreenHeader
        section="appointment_outcomes"
        description="Customize the outcomes a rep can record when running an appointment, their wording, and order."
      />
      <AppointmentDispositionsManager
        items={items}
        showCategories={solar}
        defaults={solar ? DEFAULT_SOLAR_APPOINTMENT_DISPOSITIONS : DEFAULT_APPOINTMENT_DISPOSITIONS}
      />
    </div>
  );
}
