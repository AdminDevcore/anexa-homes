"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma, TaskStatus } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { listScope } from "@/server/rbac/policies";
import { getActiveIndustry } from "@/server/auth/industry";
import { fireEvent } from "@/server/modules/notifications/engine";

function fail(error: string) {
  return { ok: false as const, error };
}

const createSchema = z.object({
  title: z.string().min(1).max(160),
  assigneeId: z.string().uuid().optional().or(z.literal("")),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  dueAt: z.string().optional().or(z.literal("")),
  leadId: z.string().uuid().optional().or(z.literal("")),
});

export async function createTaskAction(input: z.infer<typeof createSchema>) {
  const user = await requireUser();
  if (!can(user, "create", "Task")) return fail("Not allowed.");
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return fail("Title is required.");
  const d = parsed.data;

  // If linking to a lead, confirm it's visible to this user (and inherit its industry).
  let leadId: string | null = null;
  let leadIndustry: Prisma.TaskCreateInput["industry"] | null = null;
  if (d.leadId) {
    const scope = listScope(user, "Lead") as Prisma.LeadWhereInput;
    const lead = await prisma.lead.findFirst({ where: { AND: [{ id: d.leadId }, scope] }, select: { id: true, industry: true } });
    if (!lead) return fail("Lead not found or access denied.");
    leadId = lead.id;
    leadIndustry = lead.industry;
  }
  // For a deal-linked follow-up, enforce who may be tagged (mirrors the deal page list):
  //  management/office roles always; the deal's OWN rep (not other reps); installers only if
  //  on the crew assigned to this job; never canvassers.
  if (leadId && d.assigneeId && d.assigneeId !== user.userId) {
    const assignee = await prisma.user.findFirst({
      where: { id: d.assigneeId, companyId: user.companyId, status: "active" },
      select: { id: true, role: true },
    });
    if (!assignee) return fail("Assignee not found.");
    const ALWAYS_TAGGABLE = new Set(["super_admin", "admin", "manager", "accounting", "marketing"]);
    let allowed = ALWAYS_TAGGABLE.has(assignee.role);
    if (!allowed && assignee.role === "sales_rep") {
      const l = await prisma.lead.findUnique({ where: { id: leadId }, select: { assignedRepId: true } });
      allowed = !!l && l.assignedRepId === assignee.id;
    }
    if (!allowed && assignee.role === "installer") {
      const onCrew = await prisma.crewMember.count({
        where: { userId: assignee.id, crew: { assignments: { some: { project: { leadId } } } } },
      });
      allowed = onCrew > 0;
    }
    if (!allowed) return fail("That person can't be tagged on a follow-up for this deal.");
  }

  // A lead-linked task lives in that deal's industry; a standalone task in the active workspace.
  const industry = leadIndustry ?? (await getActiveIndustry(user));

  const task = await prisma.task.create({
    data: {
      companyId: user.companyId,
      title: d.title,
      priority: d.priority,
      industry,
      assigneeId: d.assigneeId || user.userId,
      createdById: user.userId,
      dueAt: d.dueAt ? new Date(d.dueAt) : null,
      leadId,
    },
  });
  if (task.assigneeId && task.assigneeId !== user.userId) {
    await fireEvent({ companyId: user.companyId, event: "task_assigned", actorId: user.userId, taskId: task.id });
  }
  revalidatePath("/portal/tasks");
  if (leadId) revalidatePath(`/portal/leads/${leadId}`);
  return { ok: true as const };
}

export async function setTaskStatusAction(id: string, status: TaskStatus) {
  const user = await requireUser();
  if (!can(user, "update", "Task")) return fail("Not allowed.");
  const scope = listScope(user, "Task") as Prisma.TaskWhereInput;
  const task = await prisma.task.findFirst({ where: { AND: [{ id }, scope] }, select: { id: true } });
  if (!task) return fail("Task not found.");
  const done = status === "done";
  await prisma.task.update({
    where: { id },
    data: {
      status,
      // Stamp who/when on completion; clear it when reopened (keeps durations accurate).
      ...(done
        ? { completedAt: new Date(), completedById: user.userId, completedByName: user.fullName }
        : { completedAt: null, completedById: null, completedByName: null }),
    },
  });
  revalidatePath("/portal/tasks");
  return { ok: true as const };
}

export async function deleteTaskAction(id: string) {
  const user = await requireUser();
  if (!can(user, "update", "Task")) return fail("Not allowed.");
  const task = await prisma.task.findFirst({ where: { id, companyId: user.companyId }, select: { id: true } });
  if (!task) return fail("Task not found.");
  await prisma.task.delete({ where: { id } });
  revalidatePath("/portal/tasks");
  return { ok: true as const };
}
