import type { Vertical, Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { listScope } from "@/server/rbac/policies";
import type { AccessUser } from "@/server/rbac/guards";

export type CalendarEventType = "appointment" | "adjuster" | "install";

export type CalendarEvent = {
  id: string;
  type: CalendarEventType;
  date: string; // ISO
  title: string; // customer / deal
  subtitle: string | null; // address or project #
  rep: string | null;
  href: string; // deal detail
};

/**
 * Every dated item the user should see on their calendar, within [from, to]:
 *  - appointment  → Lead.appointmentAt (the appointment tab)
 *  - adjuster     → Project.adjusterMeetingAt (insurance adjuster meeting)
 *  - install      → Project.installDate (scheduled install)
 * Scoped by role (reps see their own; admins/managers see all) and by the active
 * vertical workspace.
 */
export async function getCalendarEvents(
  user: AccessUser,
  vertical: Vertical,
  from: Date,
  to: Date
): Promise<CalendarEvent[]> {
  const leadScope = listScope(user, "Lead") as Prisma.LeadWhereInput;
  const projScope = listScope(user, "Project") as Prisma.ProjectWhereInput;
  const repName = (r: { firstName: string; lastName: string } | null | undefined) =>
    r ? `${r.firstName} ${r.lastName}`.trim() : null;

  const [appts, adjusters, installs] = await Promise.all([
    prisma.lead.findMany({
      where: { AND: [leadScope, { vertical }, { appointmentAt: { gte: from, lte: to } }] },
      select: { id: true, firstName: true, lastName: true, address: true, city: true, appointmentAt: true, assignedRep: { select: { firstName: true, lastName: true } } },
    }),
    // Adjuster meeting lives on the CLAIM (insurance step), scoped by its lead.
    prisma.claim.findMany({
      where: { companyId: user.companyId, adjusterMeetingAt: { gte: from, lte: to }, lead: { is: { AND: [leadScope, { vertical }] } } },
      select: { id: true, adjusterMeetingAt: true, lead: { select: { id: true, firstName: true, lastName: true, assignedRep: { select: { firstName: true, lastName: true } }, project: { select: { projectNumber: true } } } } },
    }),
    prisma.project.findMany({
      where: { AND: [projScope, { lead: { is: { vertical } } }, { installDate: { not: null }, AND: [{ installDate: { gte: from } }, { installDate: { lte: to } }] }] },
      select: { id: true, projectNumber: true, installDate: true, lead: { select: { id: true, firstName: true, lastName: true, assignedRep: { select: { firstName: true, lastName: true } } } } },
    }),
  ]);

  const events: CalendarEvent[] = [];
  for (const l of appts) {
    events.push({
      id: `appt:${l.id}`,
      type: "appointment",
      date: l.appointmentAt!.toISOString(),
      title: `${l.firstName} ${l.lastName}`.trim(),
      subtitle: [l.address, l.city].filter(Boolean).join(", ") || null,
      rep: repName(l.assignedRep),
      href: `/portal/leads/${l.id}`,
    });
  }
  for (const c of adjusters) {
    if (!c.lead) continue;
    events.push({
      id: `adj:${c.id}`,
      type: "adjuster",
      date: c.adjusterMeetingAt!.toISOString(),
      title: `${c.lead.firstName} ${c.lead.lastName}`.trim(),
      subtitle: c.lead.project?.projectNumber ?? "Adjuster meeting",
      rep: repName(c.lead.assignedRep),
      href: `/portal/leads/${c.lead.id}`,
    });
  }
  for (const p of installs) {
    events.push({
      id: `inst:${p.id}`,
      type: "install",
      date: p.installDate!.toISOString(),
      title: p.lead ? `${p.lead.firstName} ${p.lead.lastName}`.trim() : p.projectNumber,
      subtitle: p.projectNumber,
      rep: repName(p.lead?.assignedRep),
      href: p.lead ? `/portal/leads/${p.lead.id}` : `/portal/projects/${p.id}`,
    });
  }
  return events;
}
