import type { Vertical, Prisma } from "@prisma/client";
import type { ActiveVertical } from "@/lib/vertical";
import { prisma } from "@/server/db/client";
import { installerProjectFilter, listScope } from "@/server/rbac/policies";
import type { AccessUser } from "@/server/rbac/guards";
import { runInVertical } from "@/server/vertical/context";
import { NOT_CANCELLED } from "@/server/modules/leads/cancelled";

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
  /**
   * Who is going out on THIS visit — the install crew on an install, the
   * inspection crew on an inspection. Empty for appointments and adjuster
   * meetings, which are the rep's own diary and have no crew.
   */
  crew: string[];
  /**
   * Deal detail, or null when this viewer may see the visit but not the deal
   * behind it. An installer named on a job gets the where-and-when; the
   * homeowner's pricing, proposal and documents are not site information. A
   * null href is the difference between "no link" and a link that 404s.
   */
  href: string | null;
  /** Which workspace this event came from — needed once Combined mode mixes them. */
  vertical: ActiveVertical;
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

  /**
   * An installer sees the visits they are ON, not every visit on a job they
   * touch. Being on Tuesday's install is not being on Friday's inspection, and
   * a calendar that showed both would put a date in front of someone who has no
   * reason to be there.
   *
   * ANDed on top of projScope rather than replacing it: projScope is the job
   * boundary (either visit), this narrows to one. Every other role's calendar
   * is unchanged — nobody else is scoped by assignment at all.
   */
  const visitScope = (kind: "install" | "inspection"): Prisma.ProjectWhereInput[] =>
    user.role === "installer" ? [installerProjectFilter(user.userId, kind)] : [];

  /** Names on a visit, in the order they were added. */
  const crewNames = (
    rows: { user: { firstName: string; lastName: string } }[] | undefined
  ): string[] => (rows ?? []).map((a) => `${a.user.firstName} ${a.user.lastName}`.trim());

  // The crew on the visit, not the crew on the job — `where: { kind }` is what
  // keeps the install crew off the inspection and vice versa.
  const crewSelect = (kind: "install" | "inspection") =>
    ({
      where: { kind },
      orderBy: { createdAt: "asc" },
      select: { user: { select: { firstName: true, lastName: true } } },
    }) as const;

  // Each source is skipped entirely when its type isn't shown in this vertical —
  // so a hidden type costs no query, and can't leak through a later edit here.
  //
  // NOT_CANCELLED is on all four, not just the appointment. Installs and
  // inspections are read off the PROJECT, and cancelling a deal never clears
  // the dates already sitting on it — so without this a dead job keeps holding
  // a crew's slot on the calendar, which is the same confusion the Appointments
  // list is being cleaned up to remove.
  const [appts, adjusters, installs, inspections] = await Promise.all([
    calendarShows(vertical, "appointment")
      ? prisma.lead.findMany({
          where: { AND: [leadScope, { vertical }, NOT_CANCELLED, { appointmentAt: { gte: from, lte: to } }] },
          select: { id: true, firstName: true, lastName: true, address: true, city: true, appointmentAt: true, assignedRep: { select: { firstName: true, lastName: true } } },
        })
      : [],
    // Adjuster meeting lives on the CLAIM (insurance step), scoped by its lead.
    calendarShows(vertical, "adjuster")
      ? prisma.claim.findMany({
          where: { companyId: user.companyId, adjusterMeetingAt: { gte: from, lte: to }, lead: { is: { AND: [leadScope, { vertical }, NOT_CANCELLED] } } },
          select: { id: true, adjusterMeetingAt: true, lead: { select: { id: true, firstName: true, lastName: true, assignedRep: { select: { firstName: true, lastName: true } }, project: { select: { projectNumber: true } } } } },
        })
      : [],
    calendarShows(vertical, "install")
      ? prisma.project.findMany({
          where: { AND: [projScope, ...visitScope("install"), { lead: { is: { AND: [{ vertical }, NOT_CANCELLED] } } }, { installDate: { not: null }, AND: [{ installDate: { gte: from } }, { installDate: { lte: to } }] }] },
          select: { id: true, projectNumber: true, installDate: true, assignees: crewSelect("install"), lead: { select: { id: true, firstName: true, lastName: true, address: true, city: true, assignedRep: { select: { firstName: true, lastName: true } } } } },
        })
      : [],
    calendarShows(vertical, "inspection")
      ? prisma.project.findMany({
          where: { AND: [projScope, ...visitScope("inspection"), { lead: { is: { AND: [{ vertical }, NOT_CANCELLED] } } }, { inspectionAt: { not: null }, AND: [{ inspectionAt: { gte: from } }, { inspectionAt: { lte: to } }] }] },
          select: { id: true, projectNumber: true, inspectionAt: true, assignees: crewSelect("inspection"), lead: { select: { id: true, firstName: true, lastName: true, address: true, city: true, assignedRep: { select: { firstName: true, lastName: true } } } } },
        })
      : [],
  ]);

  /**
   * Which of these deals this viewer may actually OPEN.
   *
   * For every role but one, job visibility and deal visibility are the same
   * rule, so the answer is "all of them" and there is nothing to ask. The
   * installer is the exception by design — named on a visit, not admitted to
   * the customer record — so only that role pays for the extra lookup.
   *
   * Asked of the Lead scope rather than assumed from the role, because roofing
   * installers on a standing crew DO reach the deal today and must keep the
   * link they have.
   */
  const jobLeadIds = [...installs, ...inspections].map((p) => p.lead?.id).filter((id): id is string => !!id);
  const openableLeadIds =
    user.role === "installer" && jobLeadIds.length
      ? new Set(
          (
            await prisma.lead.findMany({
              where: { AND: [leadScope, { id: { in: jobLeadIds } }] },
              select: { id: true },
            })
          ).map((l) => l.id)
        )
      : null; // null = no restriction
  const dealHref = (leadId: string | undefined, projectId: string) => {
    if (!leadId) return `/portal/projects/${projectId}`;
    // Not admitted to the customer record — but no longer sent nowhere. The
    // job page holds the three things being on a visit entitles someone to:
    // where it is, when it is, and the slot to invoice it. Before this the
    // answer was `null` and the event had no destination at all, which is
    // exactly the problem the moment the visit also has to be billed.
    if (openableLeadIds && !openableLeadIds.has(leadId)) return `/portal/jobs/${projectId}`;
    return `/portal/leads/${leadId}`;
  };

  const events: CalendarEvent[] = [];
  for (const l of appts) {
    events.push({
      id: `appt:${l.id}`,
      type: "appointment",
      date: l.appointmentAt!.toISOString(),
      title: `${l.firstName} ${l.lastName}`.trim(),
      subtitle: [l.address, l.city].filter(Boolean).join(", ") || null,
      rep: repName(l.assignedRep),
      crew: [],
      href: `/portal/leads/${l.id}`,
      vertical: vertical as ActiveVertical,
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
      crew: [],
      href: `/portal/leads/${c.lead.id}`,
      vertical: vertical as ActiveVertical,
    });
  }
  // The address leads the subtitle on a site visit and the project number
  // follows it. Someone driving to an install needs the street before the job
  // number, and for an installer the address is the only thing on the card that
  // tells them where to be.
  const siteSubtitle = (
    lead: { address: string | null; city: string | null } | null,
    projectNumber: string
  ) => [lead?.address, lead?.city].filter(Boolean).join(", ") || projectNumber;

  for (const p of installs) {
    events.push({
      id: `inst:${p.id}`,
      type: "install",
      date: p.installDate!.toISOString(),
      title: p.lead ? `${p.lead.firstName} ${p.lead.lastName}`.trim() : p.projectNumber,
      subtitle: siteSubtitle(p.lead, p.projectNumber),
      rep: repName(p.lead?.assignedRep),
      crew: crewNames(p.assignees),
      href: dealHref(p.lead?.id, p.id),
      vertical: vertical as ActiveVertical,
    });
  }
  for (const p of inspections) {
    events.push({
      id: `insp:${p.id}`,
      type: "inspection",
      date: p.inspectionAt!.toISOString(),
      title: p.lead ? `${p.lead.firstName} ${p.lead.lastName}`.trim() : p.projectNumber,
      subtitle: siteSubtitle(p.lead, p.projectNumber),
      rep: repName(p.lead?.assignedRep),
      crew: crewNames(p.assignees),
      href: dealHref(p.lead?.id, p.id),
      vertical: vertical as ActiveVertical,
    });
  }
  return events;
}

/**
 * The calendar entry point: events for one or more workspaces.
 *
 * Every read goes through here, including the single-workspace case, and that is
 * deliberate. getCalendarEvents() passes `{ vertical }` into a SCOPED query, so
 * it only returns anything when the AMBIENT workspace matches the one asked for.
 * That held while the calendar could only ever show the active workspace. The
 * moment a mode switcher let someone stand in Roofing and ask for Solar, calling
 * it directly produced `vertical = 'roofing' AND vertical = 'solar'` — a query
 * that cannot match a row, returning an empty calendar rather than an error.
 *
 * Wrapping each pass in runInVertical makes the requested workspace the ambient
 * one, so the two always agree by construction. Routing the single case through
 * the same path costs one array allocation and removes the trap entirely; the
 * alternative is a private helper that is correct only if every future caller
 * remembers to wrap it.
 *
 * N scoped passes rather than one widened `vertical IN (...)` query is also the
 * point: each workspace has its own event vocabulary (adjuster meetings are
 * roofing-only, AHJ inspections solar-only), so a single query would have to
 * re-derive per row which sources were legal for it. Per-pass, CALENDAR_EVENT_TYPES
 * handles that for free.
 *
 * Callers must pass a list already checked against the user's grants — see
 * resolveCalendarMode().
 */
export async function getCalendarEventsForWorkspaces(
  user: AccessUser,
  verticals: readonly ActiveVertical[],
  from: Date,
  to: Date
): Promise<CalendarEvent[]> {
  const perWorkspace = await Promise.all(
    verticals.map((v) => runInVertical(v, () => getCalendarEvents(user, v, from, to)))
  );
  // Sorted here rather than in the client: concatenating two already-sorted
  // lists without re-sorting is the classic way a combined view ends up
  // interleaving wrongly at day boundaries.
  return perWorkspace.flat().sort((a, b) => a.date.localeCompare(b.date));
}
