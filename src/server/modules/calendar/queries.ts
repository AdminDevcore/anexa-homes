import type { Vertical, Prisma } from "@prisma/client";
import type { ActiveVertical } from "@/lib/vertical";
import { prisma } from "@/server/db/client";
import { listScope } from "@/server/rbac/policies";
import type { AccessUser } from "@/server/rbac/guards";

export type CalendarEventType = "appointment" | "adjuster" | "install" | "inspection";

/**
 * Which event types each vertical's calendar may show.
 *
 * Declared rather than inferred. "Adjuster Meeting" is an insurance concept and
 * is ROOFING-ONLY: it was already absent from solar in practice, but only
 * because solar deals happen to have no claims — an accident of data, not a
 * rule. Listing it here makes it structural, so a solar claim appearing
 * tomorrow still cannot put an adjuster meeting on a solar calendar.
 *
 * Solar is exactly Appointment / Installation / Inspection. Roofing keeps the
 * set it already had — inspection is deliberately NOT added to it.
 */
// Keyed on ActiveVertical, not Vertical: the enum still carries the retired
// `others` value for historical rows, and there is no calendar for it.
export const CALENDAR_EVENT_TYPES: Record<ActiveVertical, readonly CalendarEventType[]> = {
  roofing: ["appointment", "adjuster", "install"],
  solar: ["appointment", "install", "inspection"],
};

export function calendarShows(vertical: Vertical, type: CalendarEventType): boolean {
  const allowed = CALENDAR_EVENT_TYPES[vertical as ActiveVertical];
  return allowed ? allowed.includes(type) : false;
}

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
 *  - adjuster     → Claim.adjusterMeetingAt (insurance adjuster meeting) — ROOFING ONLY
 *  - install      → Project.installDate (scheduled install)
 *  - inspection   → Project.inspectionAt (AHJ / utility) — SOLAR ONLY
 *
 * Scoped three ways: by role (reps see their own; admins/managers see all), by
 * the active vertical workspace, and by CALENDAR_EVENT_TYPES, which decides
 * which of the four sources this vertical is even allowed to read.
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

  // Each source is skipped entirely when its type isn't shown in this vertical —
  // so a hidden type costs no query, and can't leak through a later edit here.
  const [appts, adjusters, installs, inspections] = await Promise.all([
    calendarShows(vertical, "appointment")
      ? prisma.lead.findMany({
          where: { AND: [leadScope, { vertical }, { appointmentAt: { gte: from, lte: to } }] },
          select: { id: true, firstName: true, lastName: true, address: true, city: true, appointmentAt: true, assignedRep: { select: { firstName: true, lastName: true } } },
        })
      : [],
    // Adjuster meeting lives on the CLAIM (insurance step), scoped by its lead.
    calendarShows(vertical, "adjuster")
      ? prisma.claim.findMany({
          where: { companyId: user.companyId, adjusterMeetingAt: { gte: from, lte: to }, lead: { is: { AND: [leadScope, { vertical }] } } },
          select: { id: true, adjusterMeetingAt: true, lead: { select: { id: true, firstName: true, lastName: true, assignedRep: { select: { firstName: true, lastName: true } }, project: { select: { projectNumber: true } } } } },
        })
      : [],
    calendarShows(vertical, "install")
      ? prisma.project.findMany({
          where: { AND: [projScope, { lead: { is: { vertical } } }, { installDate: { not: null }, AND: [{ installDate: { gte: from } }, { installDate: { lte: to } }] }] },
          select: { id: true, projectNumber: true, installDate: true, lead: { select: { id: true, firstName: true, lastName: true, assignedRep: { select: { firstName: true, lastName: true } } } } },
        })
      : [],
    calendarShows(vertical, "inspection")
      ? prisma.project.findMany({
          where: { AND: [projScope, { lead: { is: { vertical } } }, { inspectionAt: { not: null }, AND: [{ inspectionAt: { gte: from } }, { inspectionAt: { lte: to } }] }] },
          select: { id: true, projectNumber: true, inspectionAt: true, lead: { select: { id: true, firstName: true, lastName: true, assignedRep: { select: { firstName: true, lastName: true } } } } },
        })
      : [],
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
  for (const p of inspections) {
    events.push({
      id: `insp:${p.id}`,
      type: "inspection",
      date: p.inspectionAt!.toISOString(),
      title: p.lead ? `${p.lead.firstName} ${p.lead.lastName}`.trim() : p.projectNumber,
      subtitle: p.projectNumber,
      rep: repName(p.lead?.assignedRep),
      href: p.lead ? `/portal/leads/${p.lead.id}` : `/portal/projects/${p.id}`,
    });
  }
  return events;
}
