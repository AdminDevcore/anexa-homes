import type { Prisma, TaskStatus } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { listScope } from "@/server/rbac/policies";
import { refuseUnless, resolveDeal } from "../access";
import { NOT_SET, formatDateTime } from "../format";
import { defineTool, z } from "./define";
import { resolvePeople } from "./people";

const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
  cancelled: "Cancelled",
};

export const listTasks = defineTool({
  name: "list_tasks",
  kind: "read",
  description:
    "Tasks and follow-ups the user can see, optionally by assignee, status or deal. Defaults to open tasks (to do or in progress).",
  input: z.object({
    assignee: z.string().trim().min(1).max(60).optional().describe("\"me\", or part of a person's name."),
    status: z
      .enum(["open", "todo", "in_progress", "done", "cancelled"])
      .optional()
      .describe("\"open\" means to do or in progress. Defaults to open."),
    deal_id: z.guid().optional().describe("Only tasks on this deal."),
  }),
  async run(ctx, { assignee, status, deal_id }) {
    const refused = refuseUnless(ctx.user, "read", "Task", "see tasks");
    if (refused) return refused;

    let leadId: string | null = null;
    if (deal_id) {
      const deal = await resolveDeal(ctx, deal_id);
      if (!deal.ok) return deal;
      leadId = deal.leadId;
    }

    let assigneeIds: string[] | null = null;
    if (assignee) {
      const people = await resolvePeople(ctx, assignee);
      if (people.length === 0) return { ok: false, reason: "invalid", message: `I don't know anyone called "${assignee}".` };
      assigneeIds = people.map((p) => p.id);
    }

    const wanted = status ?? "open";
    // The Tasks page's own scope. Task is workspace-optional, so the isolation
    // extension adds "this workspace or company-wide" on top.
    const scope = listScope(ctx.user, "Task") as Prisma.TaskWhereInput;
    const tasks = await prisma.task.findMany({
      where: {
        AND: [
          scope,
          wanted === "open" ? { status: { in: ["todo", "in_progress"] } } : { status: wanted },
          assigneeIds ? { assigneeId: { in: assigneeIds } } : {},
          leadId ? { leadId } : {},
        ],
      },
      orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      take: 26,
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        dueAt: true,
        lead: { select: { id: true, firstName: true, lastName: true } },
        assignee: { select: { firstName: true, lastName: true } },
      },
    });

    return {
      ok: true,
      leadId,
      data: {
        tasks: tasks.slice(0, 25).map((t) => ({
          task_id: t.id,
          title: t.title,
          status: STATUS_LABEL[t.status],
          priority: t.priority,
          due: formatDateTime(t.dueAt, ctx.timeZone),
          deal: t.lead ? `${t.lead.firstName} ${t.lead.lastName}`.trim() : NOT_SET,
          assignee: t.assignee ? `${t.assignee.firstName} ${t.assignee.lastName}`.trim() : NOT_SET,
        })),
        more_tasks: tasks.length > 25,
      },
    };
  },
});
