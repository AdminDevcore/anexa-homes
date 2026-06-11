import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { getSessionUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { listScope } from "@/server/rbac/policies";
import { prisma } from "@/server/db/client";

type Item = { id: string; title: string; subtitle: string | null; href: string };

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ leads: [], projects: [], team: [] }, { status: 401 });
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (!q) return NextResponse.json({ leads: [], projects: [], team: [] });

  const contains = { contains: q, mode: "insensitive" as const };
  const leadScope = listScope(user, "Lead") as Prisma.LeadWhereInput;
  const projScope = listScope(user, "Project") as Prisma.ProjectWhereInput;

  const [leads, projects, team] = await Promise.all([
    can(user, "read", "Lead")
      ? prisma.lead.findMany({
          where: { AND: [leadScope, { OR: [{ firstName: contains }, { lastName: contains }, { email: contains }, { phone: contains }, { address: contains }] }] },
          orderBy: { updatedAt: "desc" },
          take: 6,
          select: { id: true, firstName: true, lastName: true, address: true, city: true, state: true },
        })
      : Promise.resolve([]),
    can(user, "read", "Project")
      ? prisma.project.findMany({
          where: { AND: [projScope, { OR: [{ projectNumber: contains }, { address: contains }, { lead: { is: { OR: [{ firstName: contains }, { lastName: contains }] } } }] }] },
          orderBy: { updatedAt: "desc" },
          take: 5,
          select: { id: true, projectNumber: true, leadId: true, lead: { select: { firstName: true, lastName: true } } },
        })
      : Promise.resolve([]),
    can(user, "read", "User")
      ? prisma.user.findMany({
          where: { companyId: user.companyId, role: { not: "customer" }, OR: [{ firstName: contains }, { lastName: contains }, { email: contains }] },
          orderBy: { firstName: "asc" },
          take: 5,
          select: { id: true, firstName: true, lastName: true, email: true, title: true },
        })
      : Promise.resolve([]),
  ]);

  return NextResponse.json({
    leads: leads.map((l): Item => ({
      id: l.id,
      title: `${l.firstName} ${l.lastName}`.trim(),
      subtitle: [l.address, [l.city, l.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ") || null,
      href: `/portal/leads/${l.id}`,
    })),
    projects: projects.map((p): Item => ({
      id: p.id,
      title: p.projectNumber,
      subtitle: p.lead ? `${p.lead.firstName} ${p.lead.lastName}`.trim() : null,
      href: p.leadId ? `/portal/leads/${p.leadId}` : `/portal/projects/${p.id}`,
    })),
    team: team.map((u): Item => ({
      id: u.id,
      title: `${u.firstName} ${u.lastName}`.trim(),
      subtitle: u.title ?? u.email,
      href: `/portal/team/${u.id}`,
    })),
  });
}
