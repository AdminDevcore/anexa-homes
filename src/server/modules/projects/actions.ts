"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma, ProjectStatus } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { listScope } from "@/server/rbac/policies";
import { fireEvent } from "@/server/modules/notifications/engine";
import { getQcChecklistTemplate } from "@/server/modules/settings/queries";

import { brandingForCompany } from "@/server/branding/resolve";
function fail(error: string) {
  return { ok: false as const, error };
}
function ok() {
  return { ok: true as const };
}

async function projectInScope(user: Awaited<ReturnType<typeof requireUser>>, projectId: string) {
  const scope = listScope(user, "Project") as Prisma.ProjectWhereInput;
  return prisma.project.findFirst({ where: { AND: [{ id: projectId }, scope] }, select: { id: true } });
}

// --------------------------- Daily reports ----------------------------------

const reportSchema = z.object({
  projectId: z.string().uuid(),
  date: z.string(),
  squaresCompleted: z.number().min(0).default(0),
  crewSize: z.number().int().min(0).default(0),
  weather: z.string().max(80).optional().or(z.literal("")),
  summary: z.string().max(2000).optional().or(z.literal("")),
});

export async function submitDailyReportAction(input: z.infer<typeof reportSchema>) {
  const user = await requireUser();
  if (user.role === "customer" || !can(user, "read", "Project")) return fail("Not allowed.");
  const parsed = reportSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid report.");
  if (!(await projectInScope(user, parsed.data.projectId))) return fail("Project not found.");

  await prisma.dailyReport.create({
    data: {
      companyId: user.companyId,
      projectId: parsed.data.projectId,
      reportedById: user.userId,
      date: new Date(parsed.data.date),
      squaresCompleted: parsed.data.squaresCompleted,
      crewSize: parsed.data.crewSize,
      weather: parsed.data.weather || null,
      summary: parsed.data.summary || null,
    },
  });
  await fireEvent({ companyId: user.companyId, event: "daily_report_submitted", actorId: user.userId, projectId: parsed.data.projectId });
  revalidatePath(`/portal/projects/${parsed.data.projectId}`);
  return ok();
}

// --------------------------- Status -----------------------------------------

const STATUSES = ["not_started", "in_production", "on_hold", "qc", "completed", "closed", "cancelled"] as const;

export async function updateProjectStatusAction(projectId: string, status: string) {
  const user = await requireUser();
  if (!can(user, "update", "Project")) return fail("Not allowed.");
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) return fail("Invalid status.");
  if (!(await projectInScope(user, projectId))) return fail("Project not found.");

  await prisma.project.update({ where: { id: projectId }, data: { status: status as ProjectStatus } });
  await prisma.activityLog.create({
    data: {
      companyId: user.companyId,
      type: "status_change",
      message: `${user.fullName} set project status to ${status.replace(/_/g, " ")}`,
      actorId: user.userId,
      projectId,
    },
  });
  await fireEvent({ companyId: user.companyId, event: "project_status_changed", actorId: user.userId, projectId, status });
  revalidatePath(`/portal/projects/${projectId}`);
  return ok();
}

// --------------------------- QC checklist -----------------------------------

export async function toggleQcItemAction(projectId: string, index: number, done: boolean) {
  const user = await requireUser();
  if (!can(user, "update", "Project")) return fail("Not allowed.");
  if (!(await projectInScope(user, projectId))) return fail("Project not found.");

  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { qcChecklist: true } });
  const list = (project?.qcChecklist as { label: string; done: boolean }[]) ?? [];
  if (!list[index]) return fail("Item not found.");
  list[index].done = done;
  await prisma.project.update({ where: { id: projectId }, data: { qcChecklist: list as Prisma.InputJsonValue } });
  revalidatePath(`/portal/projects/${projectId}`);
  return ok();
}

// --------------------------- Crew assignment --------------------------------

export async function assignCrewAction(projectId: string, crewId: string) {
  const user = await requireUser();
  if (!can(user, "assign", "Crew") && !can(user, "update", "Project")) return fail("Not allowed.");
  if (!(await projectInScope(user, projectId))) return fail("Project not found.");

  const crew = await prisma.crew.findFirst({ where: { id: crewId, companyId: user.companyId }, select: { id: true } });
  if (!crew) return fail("Crew not found.");

  const existing = await prisma.projectCrew.findUnique({
    where: { projectId_crewId: { projectId, crewId } },
  });
  if (existing) return fail("Crew already assigned.");

  await prisma.projectCrew.create({ data: { projectId, crewId } });
  revalidatePath(`/portal/projects/${projectId}`);
  return ok();
}

export async function unassignCrewAction(projectCrewId: string) {
  const user = await requireUser();
  if (!can(user, "assign", "Crew") && !can(user, "update", "Project")) return fail("Not allowed.");
  const pc = await prisma.projectCrew.findFirst({
    where: { id: projectCrewId, project: { companyId: user.companyId } },
    select: { id: true, projectId: true },
  });
  if (!pc) return fail("Assignment not found.");
  await prisma.projectCrew.delete({ where: { id: projectCrewId } });
  revalidatePath(`/portal/projects/${pc.projectId}`);
  return ok();
}

// ------------------- Start production (deal -> production container) ---------

/**
 * Ensures a deal (lead) has its production container (Project). Creates one 1:1
 * from the lead if missing. This is what "Start production" calls — the deal
 * stays the single record; the project just holds crew/QC/daily/photos.
 */
export async function ensureProjectForLeadAction(
  leadId: string
): Promise<{ ok: true; projectId: string } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can(user, "create", "Project") && !can(user, "update", "Project")) {
    return fail("You don't have permission to start production.");
  }

  const leadScope = listScope(user, "Lead") as Prisma.LeadWhereInput;
  const lead = await prisma.lead.findFirst({
    where: { AND: [{ id: leadId }, leadScope] },
    include: { project: { select: { id: true } } },
  });
  if (!lead) return fail("Deal not found.");
  if (lead.project) return { ok: true, projectId: lead.project.id };

  const count = await prisma.project.count({ where: { companyId: user.companyId } });
  const { recordPrefix } = await brandingForCompany(user.companyId);
  const project = await prisma.project.create({
    data: {
      companyId: user.companyId,
      leadId: lead.id,
      projectNumber: `${recordPrefix}${1000 + count + 1}`,
      status: "not_started",
      serviceType: lead.serviceType,
      priority: lead.priority,
      address: lead.address,
      city: lead.city,
      state: lead.state,
      zip: lead.zip,
      // The insurance-approved claim price is the real contract; fall back to the
      // rep's estimate if it hasn't been entered yet.
      contractValue: lead.claimPrice ?? lead.value,
      // Seed the QC checklist from the company's customizable template.
      qcChecklist: (await getQcChecklistTemplate(user.companyId)).map((label) => ({ label, done: false })),
    },
    select: { id: true },
  });

  revalidatePath(`/portal/leads/${leadId}`);
  return { ok: true, projectId: project.id };
}
