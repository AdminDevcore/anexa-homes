import { NextResponse } from "next/server";
import type { Prisma, Vertical } from "@prisma/client";
import { getSessionUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { listScope } from "@/server/rbac/policies";
import { prisma } from "@/server/db/client";
import { addressContains } from "@/lib/address";
import { runUnscoped } from "@/server/vertical/context";
import { permittedVerticalOnly, worksAcrossVerticals } from "@/server/vertical/visibility";
import { NOT_CANCELLED } from "@/server/modules/leads/cancelled";

type Item = {
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
  /** Which workspace this record lives in; null for company-wide records (people). */
  vertical: Vertical | null;
};

const EMPTY = { leads: [], projects: [], team: [], showWorkspace: false };

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json(EMPTY, { status: 401 });
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (!q) return NextResponse.json(EMPTY);

  const contains = { contains: q, mode: "insensitive" as const };
  const leadScope = listScope(user, "Lead") as Prisma.LeadWhereInput;
  const projScope = listScope(user, "Project") as Prisma.ProjectWhereInput;

  // Search spans every workspace this person is GRANTED, not just the one they
  // happen to have open. Someone who works both sides should not have to guess
  // which workspace a deal is in before they can find it — that is the whole
  // point of a global search, and "executives may search across all workspaces"
  // needs no special case because their grant list already is all of them.
  //
  // runUnscoped lifts the extension's active-workspace filter; the explicit
  // permittedVerticalOnly then puts the PERMISSION boundary back. Dropping the
  // second half would turn this into a company-wide leak, so they belong
  // together in one expression and never apart.
  const workspace = permittedVerticalOnly(user);

  const [leads, projects, team] = await runUnscoped(
    "global search: every workspace this user is granted",
    () =>
      Promise.all([
        can(user, "read", "Lead")
          ? prisma.lead.findMany({
              where: {
                AND: [
                  leadScope,
                  workspace,
                  // Cancelled deals stay out of ⌘K. They remain reachable from
                  // the Appointments "Cancelled" chip and the Pipeline board's
                  // Cancelled column — this narrows the reflex lookup, it does
                  // not orphan the record.
                  NOT_CANCELLED,
                  {
                    OR: [
                      { firstName: contains },
                      { lastName: contains },
                      { email: contains },
                      { phone: contains },
                      ...addressContains(q),
                    ],
                  },
                ],
              },
              orderBy: { updatedAt: "desc" },
              take: 6,
              select: {
                id: true,
                firstName: true,
                lastName: true,
                address: true,
                city: true,
                state: true,
                vertical: true,
              },
            })
          : Promise.resolve([]),
        can(user, "read", "Project")
          ? prisma.project.findMany({
              where: {
                AND: [
                  projScope,
                  workspace,
                  {
                    OR: [
                      { projectNumber: contains },
                      ...addressContains(q),
                      {
                        lead: {
                          is: {
                            OR: [{ firstName: contains }, { lastName: contains }, ...addressContains(q)],
                          },
                        },
                      },
                    ],
                  },
                ],
              },
              orderBy: { updatedAt: "desc" },
              take: 5,
              select: {
                id: true,
                projectNumber: true,
                leadId: true,
                vertical: true,
                lead: { select: { firstName: true, lastName: true } },
              },
            })
          : Promise.resolve([]),
        // People are company-wide — one roster, one login per person — so this
        // one is deliberately not workspace-filtered.
        can(user, "read", "User")
          ? prisma.user.findMany({
              where: {
                companyId: user.companyId,
                role: { not: "customer" },
                OR: [{ firstName: contains }, { lastName: contains }, { email: contains }],
              },
              orderBy: { firstName: "asc" },
              take: 5,
              select: { id: true, firstName: true, lastName: true, email: true, title: true },
            })
          : Promise.resolve([]),
      ])
  );

  return NextResponse.json({
    leads: leads.map((l): Item => ({
      id: l.id,
      title: `${l.firstName} ${l.lastName}`.trim(),
      subtitle: [l.address, [l.city, l.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ") || null,
      href: `/portal/leads/${l.id}`,
      vertical: l.vertical,
    })),
    projects: projects.map((p): Item => ({
      id: p.id,
      title: p.projectNumber,
      subtitle: p.lead ? `${p.lead.firstName} ${p.lead.lastName}`.trim() : null,
      href: p.leadId ? `/portal/leads/${p.leadId}` : `/portal/projects/${p.id}`,
      vertical: p.vertical,
    })),
    team: team.map((u): Item => ({
      id: u.id,
      title: `${u.firstName} ${u.lastName}`.trim(),
      subtitle: u.title ?? u.email,
      href: `/portal/team/${u.id}`,
      vertical: null,
    })),
    showWorkspace: worksAcrossVerticals(user),
  });
}
