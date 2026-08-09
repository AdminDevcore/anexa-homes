import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { getActiveVertical } from "@/server/auth/vertical";
import { visibleVerticals, worksAcrossVerticals } from "@/server/vertical/visibility";
import { VERTICAL_LABEL } from "@/lib/vertical";
import { PageHeader } from "@/components/portal/ui";
import { WorkCalendar, type CalendarModeOption } from "@/components/portal/work-calendar";
import { CALENDAR_EVENT_TYPES, type CalendarEventType } from "@/server/modules/calendar/queries";

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

  const allowed = visibleVerticals(user);
  const canCombine = worksAcrossVerticals(user);

  // One option per workspace the user is granted, plus Combined. Each carries
  // its own chip set, because the event vocabulary differs per workspace and
  // Combined therefore needs the UNION rather than either one's list.
  const modes: CalendarModeOption[] = canCombine
    ? [
        ...allowed.map((v) => ({
          value: v,
          label: VERTICAL_LABEL[v],
          types: [...CALENDAR_EVENT_TYPES[v]] as CalendarEventType[],
        })),
        {
          value: "combined",
          label: "Combined",
          types: [
            ...new Set(allowed.flatMap((v) => CALENDAR_EVENT_TYPES[v])),
          ] as CalendarEventType[],
        },
      ]
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Calendar"
        description={
          canCombine
            ? "Your appointments, installs, and meetings — one workspace at a time, or combined."
            : DESCRIPTION[vertical] ?? DESCRIPTION.roofing
        }
      />
      <WorkCalendar
        types={types}
        modes={modes}
        initialMode={vertical}
        showWorkspace={canCombine}
        activeVertical={vertical}
      />
    </div>
  );
}
