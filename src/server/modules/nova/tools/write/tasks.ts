import { prisma } from "@/server/db/client";
import { createTaskAction } from "@/server/modules/tasks/actions";
import { refuseUnless, resolveDeal } from "../../access";
import type { NovaCtx, ToolResult } from "../../types";
import { defineWriteTool, z } from "../define";
import { isSelf, resolvePeople } from "../people";
import { DAY, DEAL_GONE, dayWords, justNow, personName } from "./common";

type Assignee = { ok: true; id: string | null; name: string };

/**
 * Who a task goes to. Anyone may give one to themselves; handing one to
 * someone else needs Task:assign — the grant the Tasks page and the deal's
 * follow-ups card check before they show an assignee picker at all. A caller
 * without it is refused before any name is looked up, so the answer reveals
 * nothing about who works here.
 */
async function resolveAssignee(
  ctx: NovaCtx,
  said: string | undefined,
  doing: string
): Promise<Assignee | Extract<ToolResult, { ok: false }>> {
  if (!said || isSelf(ctx, said)) return { ok: true, id: null, name: "you" };
  const refused = refuseUnless(ctx.user, "assign", "Task", doing);
  if (refused) return refused;
  const people = await resolvePeople(ctx, said, { activeOnly: true });
  if (people.length === 0) {
    return { ok: false, reason: "invalid", message: `I don't know an active teammate called "${said}".` };
  }
  if (people.length > 1) {
    return { ok: false, reason: "invalid", message: `Which one: ${people.map((p) => p.name).join(" or ")}?` };
  }
  const [person] = people;
  return person.id === ctx.user.userId ? { ok: true, id: null, name: "you" } : { ok: true, ...person };
}

const due = (d: string | undefined) => (d ? `due ${dayWords(d)}` : "with no due date");

export const createTask = defineWriteTool({
  name: "create_task",
  description:
    "Create a task on the Tasks page, not tied to a deal. For a task about a deal, use create_follow_up. The user is asked to confirm first.",
  input: z.object({
    title: z.string().trim().min(1).max(160),
    assignee: z.string().trim().min(1).max(60).optional().describe("\"me\" or a teammate's name. Omit for the user."),
    due_date: DAY.optional().describe("YYYY-MM-DD."),
    priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  }),
  async prepare(ctx, input) {
    const refused = refuseUnless(ctx.user, "create", "Task", "create tasks");
    if (refused) return refused;
    const who = await resolveAssignee(ctx, input.assignee, "assign tasks to other people");
    if (!who.ok) return who;
    return {
      ok: true,
      summary: `Create a task "${input.title}" for ${who.name}, ${due(input.due_date)}, ${input.priority} priority.`,
      leadId: null,
      args: input,
      plan: { ...input, assigneeId: who.id, who: who.name },
    };
  },
  async execute(ctx, plan) {
    const startedAt = new Date();
    // The New Task dialog's own call: a date-only due date, this workspace.
    const res = await createTaskAction({
      title: plan.title,
      assigneeId: plan.assigneeId ?? "",
      priority: plan.priority,
      dueAt: plan.due_date ?? "",
      scope: "workspace",
    });
    if (!res.ok) return { ok: false, message: res.error };
    const task = await prisma.task.findFirst({
      where: { companyId: ctx.user.companyId, createdById: ctx.user.userId, title: plan.title, leadId: null, createdAt: justNow(startedAt) },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    return {
      ok: true,
      done: `Created the task "${plan.title}" for ${plan.who}.`,
      leadId: null,
      entityType: "Task",
      entityId: task?.id ?? null,
    };
  },
});

export const createFollowUp = defineWriteTool({
  name: "create_follow_up",
  description:
    "Add a follow-up task on a Solar deal, as on the deal's follow-ups card. Omit deal_id for the deal on screen. The user is asked to confirm first.",
  input: z.object({
    deal_id: z.guid().optional().describe("From find_deal. Omit for the deal on screen."),
    title: z.string().trim().min(1).max(160),
    assignee: z.string().trim().min(1).max(60).optional().describe("\"me\" or a teammate's name. Omit for the user."),
    due_date: DAY.optional().describe("YYYY-MM-DD."),
  }),
  async prepare(ctx, input) {
    const refused = refuseUnless(ctx.user, "create", "Task", "create follow-ups");
    if (refused) return refused;
    const deal = await resolveDeal(ctx, input.deal_id);
    if (!deal.ok) return deal;
    const lead = await prisma.lead.findFirst({
      where: { id: deal.leadId, companyId: ctx.user.companyId },
      select: { firstName: true, lastName: true },
    });
    if (!lead) return DEAL_GONE;
    const who = await resolveAssignee(ctx, input.assignee, "assign follow-ups to other people");
    if (!who.ok) return { ...who, leadId: deal.leadId };
    const customer = personName(lead);
    return {
      ok: true,
      summary: `Add a follow-up on ${customer}'s deal: "${input.title}", for ${who.name}, ${due(input.due_date)}.`,
      leadId: deal.leadId,
      args: { ...input, deal_id: deal.leadId },
      plan: { title: input.title, due_date: input.due_date, leadId: deal.leadId, assigneeId: who.id, customer },
    };
  },
  async execute(ctx, plan) {
    const startedAt = new Date();
    // The deal follow-ups card's own call. Who may be tagged on a deal is the
    // action's rule, and it answers for itself if the person can't be.
    const res = await createTaskAction({
      title: plan.title,
      assigneeId: plan.assigneeId ?? "",
      dueAt: plan.due_date ?? "",
      leadId: plan.leadId,
      priority: "medium",
    });
    if (!res.ok) return { ok: false, message: res.error };
    const task = await prisma.task.findFirst({
      where: { companyId: ctx.user.companyId, createdById: ctx.user.userId, title: plan.title, leadId: plan.leadId, createdAt: justNow(startedAt) },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    return {
      ok: true,
      done: `Added the follow-up "${plan.title}" on ${plan.customer}'s deal.`,
      leadId: plan.leadId,
      entityType: "Task",
      entityId: task?.id ?? null,
    };
  },
});
