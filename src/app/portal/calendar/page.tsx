import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { PageHeader } from "@/components/portal/ui";
import { WorkCalendar } from "@/components/portal/work-calendar";

export const metadata = { title: "Calendar" };

export default async function CalendarPage() {
  const user = await requireUser();
  if (!can(user, "read", "Project")) redirect("/portal/dashboard");
  return (
    <div className="space-y-6">
      <PageHeader
        title="Calendar"
        description="Your appointments, adjuster meetings, and install dates."
      />
      <WorkCalendar />
    </div>
  );
}
