import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { listScope } from "@/server/rbac/policies";
import { getActiveVertical } from "@/server/auth/vertical";
import { worksAcrossVerticals } from "@/server/vertical/visibility";
import { VERTICAL_LABEL } from "@/lib/vertical";
import { STAFF_ROLES } from "@/server/rbac/matrix";
import { PageHeader } from "@/components/portal/ui";
import { TasksClient } from "@/components/portal/tasks-client";
import { addressSearchText } from "@/lib/address";

export const metadata = { title: "Tasks" };

export default async function TasksPage() {
  const user = await requireUser();
  if (!can(user, "read", "Task")) redirect("/portal/dashboard");

  const scope = listScope(user, "Task") as Prisma.TaskWhereInput;
  const canAssign = can(user, "assign", "Task");
  const vertical = await getActiveVertical(user);

  // NOTE: no `{ vertical }` clause here on purpose. Task is a SCOPED_OPTIONAL
  // model, so the isolation extension already narrows this to "the active
  // workspace OR company-level". Adding the filter back by hand would intersect
  // with that and delete every Company task from the list — the exact bug this
  // model class exists to avoid. Workspace filtering belongs to the context, not
  // to the page.
  const [tasks, assignees] = await Promise.all([
    prisma.task.findMany({
      where: scope,
      orderBy: [{ status: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }],
      include: {
        assignee: { select: { firstName: true, lastName: true } },
        createdBy: { select: { firstName: true, lastName: true } },
        lead: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            address: true,
            city: true,
            state: true,
            zip: true,
          },
        },
      },
    }),
    canAssign
      ? prisma.user.findMany({
          where: { companyId: user.companyId, role: { in: STAFF_ROLES }, status: "active" },
          orderBy: { firstName: "asc" },
          select: { id: true, firstName: true, lastName: true },
        })
      : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="Tasks" description="Follow-ups assigned to you and your team." />
      <TasksClient
        meId={user.userId}
        tasks={tasks.map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          dueAt: t.dueAt ? t.dueAt.toISOString() : null,
          createdAt: t.createdAt.toISOString(),
          completedAt: t.completedAt ? t.completedAt.toISOString() : null,
          completedBy: t.completedByName,
          assignee: t.assignee ? `${t.assignee.firstName} ${t.assignee.lastName}` : null,
          assigneeId: t.assigneeId,
          assignedBy: t.createdBy ? `${t.createdBy.firstName} ${t.createdBy.lastName}` : null,
          createdById: t.createdById,
          leadId: t.leadId,
          leadName: t.lead ? `${t.lead.firstName} ${t.lead.lastName}` : null,
          // Searchable only — the job chip shows the customer's name, but the
          // task is just as often remembered by the house it belongs to.
          leadAddress: t.lead ? addressSearchText(t.lead) || null : null,
          vertical: t.vertical,
        }))}
        assignees={assignees.map((a) => ({ id: a.id, name: `${a.firstName} ${a.lastName}` }))}
        canAssign={canAssign}
        canCreate={can(user, "create", "Task")}
        canManage={can(user, "update", "Task")}
        workspaceLabel={VERTICAL_LABEL[vertical]}
        multiWorkspace={worksAcrossVerticals(user)}
      />
    </div>
  );
}
