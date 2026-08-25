"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import type { AssignmentKind, ProjectStatus, ServiceType, Priority } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { rawUnscoped } from "@/server/vertical/context";
import { getActiveVertical } from "@/server/auth/vertical";
import { can } from "@/server/rbac/guards";
import { isAdmin } from "@/server/rbac/matrix";
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
  if (!can(user, "read", "Project")) return fail("Not allowed.");
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

// --------------------------- Full edit (admin) ------------------------------

const dateStr = z.string().optional().or(z.literal(""));
const text = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));

const editSchema = z.object({
  projectId: z.string().uuid(),
  projectNumber: z.string().trim().min(1, "Job number is required.").max(40),
  status: z.enum(STATUSES),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  // Full ServiceType enum, retired products included — see the note in
  // leads/manage.ts. Selectable options are narrowed in the UI.
  serviceType: z.enum(["roofing", "storm_restoration", "solar", "hvac", "water_filtration", "windows", "other"]),
  address: text(200),
  city: text(80),
  state: text(40),
  zip: text(20),
  roofingType: text(80),
  materialSelection: text(120),
  pitch: text(40),
  tearOffLayers: z.coerce.number().int().min(0).max(20).nullable().optional(),
  contractValueCents: z.coerce.number().int().min(0),
  supplementCents: z.coerce.number().int().min(0),
  deductibleCents: z.coerce.number().int().min(0),
  depreciationCents: z.coerce.number().int().min(0),
  repGetsSupplement: z.boolean(),
  repGetsDepreciation: z.boolean(),
  companyProvidedLead: z.boolean(),
  scheduledStart: dateStr,
  scheduledEnd: dateStr,
  installDate: dateStr,
  inspectionAt: dateStr,
  adjusterMeetingAt: dateStr,
  completedAt: dateStr,
  notes: text(5000),
});

/** Admin/super-admin only: edit any field on a project (job) directly. */
export async function updateProjectAction(input: z.infer<typeof editSchema>) {
  const user = await requireUser();
  if (!isAdmin(user.role)) return fail("Only admins can edit job details.");
  const parsed = editSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Please check the form.");
  const d = parsed.data;
  if (!(await projectInScope(user, d.projectId))) return fail("Project not found.");
  const toDate = (s?: string) => (s ? new Date(s) : null);

  try {
    const updated = await prisma.project.update({
      where: { id: d.projectId },
      data: {
        projectNumber: d.projectNumber,
        status: d.status as ProjectStatus,
        priority: d.priority as Priority,
        serviceType: d.serviceType as ServiceType,
        address: d.address || null,
        city: d.city || null,
        state: d.state || null,
        zip: d.zip || null,
        roofingType: d.roofingType || null,
        materialSelection: d.materialSelection || null,
        pitch: d.pitch || null,
        tearOffLayers: d.tearOffLayers ?? null,
        contractValue: d.contractValueCents,
        supplementCents: d.supplementCents,
        deductibleCents: d.deductibleCents,
        depreciationCents: d.depreciationCents,
        repGetsSupplement: d.repGetsSupplement,
        repGetsDepreciation: d.repGetsDepreciation,
        companyProvidedLead: d.companyProvidedLead,
        scheduledStart: toDate(d.scheduledStart),
        scheduledEnd: toDate(d.scheduledEnd),
        installDate: toDate(d.installDate),
        // Omitted by callers that do not show the field (roofing), so a save
        // there leaves the column alone instead of clearing it.
        ...(d.inspectionAt !== undefined ? { inspectionAt: toDate(d.inspectionAt) } : {}),
        adjusterMeetingAt: toDate(d.adjusterMeetingAt),
        completedAt: toDate(d.completedAt),
        notes: d.notes || null,
      },
      select: { leadId: true },
    });
    await prisma.activityLog.create({
      data: {
        companyId: user.companyId,
        type: "note",
        message: `${user.fullName} edited the job details`,
        actorId: user.userId,
        projectId: d.projectId,
      },
    });
    revalidatePath(`/portal/leads/${updated.leadId}`);
    revalidatePath(`/portal/projects/${d.projectId}`);
    return ok();
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return fail("That job number is already used by another project.");
    }
    throw e;
  }
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

// --------------------- Visit assignees (people, not crews) -------------------

/**
 * Everything the deal page has to re-render after a crew change: the job's own
 * URL, and the DEAL, which is where the crew is actually shown. Only the first
 * was revalidated before, and `/portal/projects/[id]` is a redirect stub — so
 * the server cache behind the deal kept serving the old crew and the UI got
 * away with it purely because the client also calls router.refresh().
 */
async function revalidateCrew(projectId: string) {
  const p = await prisma.project.findUnique({ where: { id: projectId }, select: { leadId: true } });
  revalidatePath(`/portal/projects/${projectId}`);
  if (p) revalidatePath(`/portal/leads/${p.leadId}`);
}

const KIND_LABEL: Record<AssignmentKind, string> = {
  install: "install",
  inspection: "inspection",
};

/**
 * Who is going out — on ONE of the job's two scheduled visits.
 *
 * People rather than crews: `Crew` exists in the schema but nothing outside
 * roofing's seeded three has ever created one, so the crew dropdown hid itself
 * on every job and installs were staffed nowhere. The office knows the names on
 * the day; this records them.
 *
 * `kind` is what makes the record answer the question that was actually being
 * asked. An install crew and the inspection crew that follows them are usually
 * different people, and a row that only says "on this job" cannot be shown
 * against its own date or filtered onto the right person's calendar.
 *
 * Authorisation deliberately matches crew assignment — whoever could put a crew
 * on a job can put a person on it. Nothing here is a new privilege.
 */
export async function assignInstallerAction(
  projectId: string,
  userId: string,
  role?: string,
  kind: AssignmentKind = "install"
) {
  const user = await requireUser();
  if (!can(user, "assign", "Crew") && !can(user, "update", "Project")) return fail("Not allowed.");
  if (!(await projectInScope(user, projectId))) return fail("Project not found.");

  // Same company only: a userId from anywhere else must not become an
  // assignment, and the FK alone would happily accept one.
  const member = await prisma.user.findFirst({
    where: { id: userId, companyId: user.companyId },
    select: { id: true },
  });
  if (!member) return fail("That person is not on your team.");

  // Scoped to the visit, not the job: the same installer being on both the
  // install and the inspection is normal, and refusing the second one would be
  // the bug rather than the guard.
  const existing = await prisma.projectAssignee.findUnique({
    where: { projectId_userId_kind: { projectId, userId, kind } },
    select: { id: true },
  });
  if (existing) return fail(`Already on this ${KIND_LABEL[kind]}.`);

  await prisma.projectAssignee.create({
    data: { companyId: user.companyId, projectId, userId, kind, role: role?.trim() || null },
  });
  await revalidateCrew(projectId);
  return ok();
}

/** Change what someone is doing on the visit, without removing them. */
export async function setInstallerRoleAction(assigneeId: string, role: string) {
  const user = await requireUser();
  if (!can(user, "assign", "Crew") && !can(user, "update", "Project")) return fail("Not allowed.");
  const row = await prisma.projectAssignee.findFirst({
    where: { id: assigneeId, companyId: user.companyId },
    select: { id: true, projectId: true },
  });
  if (!row) return fail("Assignment not found.");
  await prisma.projectAssignee.update({
    where: { id: assigneeId },
    data: { role: role.trim().slice(0, 60) || null },
  });
  await revalidateCrew(row.projectId);
  return ok();
}

export async function unassignInstallerAction(assigneeId: string) {
  const user = await requireUser();
  if (!can(user, "assign", "Crew") && !can(user, "update", "Project")) return fail("Not allowed.");
  const row = await prisma.projectAssignee.findFirst({
    where: { id: assigneeId, companyId: user.companyId },
    select: { id: true, projectId: true },
  });
  if (!row) return fail("Assignment not found.");
  await prisma.projectAssignee.delete({ where: { id: assigneeId } });
  await revalidateCrew(row.projectId);
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

  const { recordPrefix } = await brandingForCompany(user.companyId);
  const qcChecklist = (
    await getQcChecklistTemplate(user.companyId, await getActiveVertical(user))
  ).map((label) => ({ label, done: false }));

  /**
   * The next free project number for this COMPANY.
   *
   * Read unscoped, and that is the whole bug this replaces. The number is
   * unique per company across every workspace, but `Project` is a vertical-
   * scoped model — so counting it while acting in Solar counted only the SOLAR
   * projects. With none of those, the number generated was the first one, which
   * a roofing project has had since the day the company started. Starting
   * production on a solar deal therefore failed on a unique constraint every
   * single time, and the button simply span forever.
   *
   * Highest-so-far rather than a count, so a deleted project cannot hand its
   * old number to the next job either.
   */
  const nextNumber = async () => {
    // RAW, and that is deliberate twice over. The vertical extension rewrites
    // model queries, so `prisma.project.findMany` sees only the workspace being
    // acted in — and `runUnscoped` cannot be relied on to lift that here,
    // because `next dev` loads the async-local context module twice and the
    // copy holding the escape hatch is not the copy the extension reads. A raw
    // query goes past the extension entirely, in dev and in production alike.
    const rows = await rawUnscoped(
      "project number is unique per COMPANY across every workspace, so the highest one has to be read across all of them",
      // Reviewed exception. The rule exists to stop raw SQL leaking one
      // vertical's rows into another; the only column read here is a number
      // that is deliberately shared across all of them.
      () =>
        // eslint-disable-next-line no-restricted-syntax
        prisma.$queryRaw<{ projectNumber: string }[]>`
          SELECT "projectNumber" FROM "projects" WHERE "companyId" = ${user.companyId}
        `
    );

    // Parsed here rather than in SQL. A `regexp_replace(...)::bigint` needs a
    // backslash class, and a backslash in a template literal is eaten by
    // JavaScript before Postgres ever sees it — which turned the pattern into
    // "strip the letter D" and left "AH-1001" being cast to a bigint.
    const highest = rows.reduce((max, r) => {
      const digits = r.projectNumber.match(/(\d+)\s*$/);
      const n = digits ? Number(digits[1]) : 0;
      return Number.isFinite(n) && n > max ? n : max;
    }, 1000);
    return highest + 1;
  };

  // Two people starting production in the same second would still collide on
  // the unique index, so the number is re-derived and retried rather than
  // failing the second one.
  let project: { id: string } | null = null;
  for (let attempt = 0; attempt < 5 && !project; attempt++) {
    try {
      project = await prisma.project.create({
        data: {
          companyId: user.companyId,
          leadId: lead.id,
          projectNumber: `${recordPrefix}${(await nextNumber()) + attempt}`,
          status: "not_started",
          serviceType: lead.serviceType,
          priority: lead.priority,
          address: lead.address,
          city: lead.city,
          state: lead.state,
          zip: lead.zip,
          // The insurance-approved claim price is the real contract; fall back
          // to the rep's estimate if it hasn't been entered yet.
          contractValue: lead.claimPrice ?? lead.value,
          // Seed the QC checklist from the company's customizable template.
          qcChecklist,
        },
        select: { id: true },
      });
    } catch (err) {
      const code = (err as { code?: string }).code;
      // P2002 is the unique index doing its job. Anything else is not ours.
      if (code !== "P2002") throw err;
    }
  }
  if (!project) return fail("Could not allocate a project number — try again.");

  revalidatePath(`/portal/leads/${leadId}`);
  return { ok: true, projectId: project.id };
}
