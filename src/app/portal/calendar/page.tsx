import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { getActiveVertical } from "@/server/auth/vertical";
import { PageHeader } from "@/components/portal/ui";
import { WorkCalendar } from "@/components/portal/work-calendar";
import { CALENDAR_EVENT_TYPES } from "@/server/modules/calendar/queries";

export const metadata = { title: "Calendar" };

// The chips and the copy both follow the active vertical, so solar never even
// names "adjuster meetings" — a roofing/insurance concept.
const DESCRIPTION: Record<string, string> = {
  roofing: "Your appointments, adjuster meetings, and install dates.",
  solar: "Your appointments, installs, and inspections.",
};

export default async function CalendarPage() {
  const user = await requireUser();
  if (!can(user, "read", "Project")) redirect("/portal/dashboard");
  const vertical = await getActiveVertical(user);
  const types = [...(CALENDAR_EVENT_TYPES[vertical] ?? [])];
  return (
    <div className="space-y-6">
      <PageHeader
        title="Calendar"
        description={DESCRIPTION[vertical] ?? DESCRIPTION.roofing}
      />
      <WorkCalendar types={types} />
    </div>
  );
}
