import type { NotificationChannel, NotificationEvent, Role } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { emailBrandFor } from "@/server/modules/notifications/brand";
import { brandedEmailTemplate } from "@/server/modules/notifications/email-templates";
import { AGENT_ACCESS_ROLE } from "@/server/modules/agents/access";
import type { RecipientConfig } from "./types";
import { sendEmail, sendSms } from "./delivery";

export type FireArgs = {
  companyId: string;
  event: NotificationEvent;
  actorId?: string | null;
  leadId?: string | null;
  projectId?: string | null;
  documentId?: string | null;
  taskId?: string | null;
  stageId?: string | null;
  status?: string | null;
  /** The agent a run belongs to, for agent_run_failed / agent_needs_human. */
  agentName?: string | null;
};

type Tokens = Record<string, string>;

/** Agent events carry a sentence in `status`, not an enum value. */
const AGENT_EVENTS: ReadonlySet<NotificationEvent> = new Set<NotificationEvent>(["agent_run_failed", "agent_needs_human"]);

function fillTokens(tpl: string, tokens: Tokens): string {
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, k: string) => tokens[k] ?? "");
}

/** Best-effort: never throws into the caller's main action. */
export async function fireEvent(args: FireArgs): Promise<void> {
  try {
    await run(args);
  } catch (err) {
    console.error("[notifications] fireEvent failed", args.event, err);
  }
}

async function run(args: FireArgs) {
  const rules = await prisma.notificationRule.findMany({
    where: { companyId: args.companyId, event: args.event, active: true },
  });
  if (rules.length === 0) return;

  // --- Load context entities once ---
  const lead = args.leadId
    ? await prisma.lead.findUnique({
        where: { id: args.leadId },
        include: { project: { select: { id: true, projectNumber: true, managerId: true } } },
      })
    : null;

  const projectId = args.projectId ?? lead?.project?.id ?? null;
  const project = projectId
    ? await prisma.project.findUnique({
        where: { id: projectId },
        include: { lead: { select: { id: true, firstName: true, lastName: true, assignedRepId: true, createdById: true } } },
      })
    : null;

  const doc = args.documentId
    ? await prisma.documentPackage.findUnique({ where: { id: args.documentId }, select: { id: true, title: true, leadId: true, projectId: true } })
    : null;

  const task = args.taskId
    ? await prisma.task.findUnique({
        where: { id: args.taskId },
        select: { id: true, title: true, assigneeId: true, vertical: true },
      })
    : null;

  const stage = args.stageId
    ? await prisma.pipelineStage.findUnique({ where: { id: args.stageId }, select: { name: true } })
    : null;

  const actor = args.actorId
    ? await prisma.user.findUnique({ where: { id: args.actorId }, select: { firstName: true, lastName: true } })
    : null;

  const company = await prisma.company.findUnique({ where: { id: args.companyId }, select: { name: true } });

  // Resolve a "primary lead" for tokens/recipients (from lead, project, or doc).
  const leadForCtx = lead ?? project?.lead ?? null;
  const customerName = leadForCtx ? `${leadForCtx.firstName} ${leadForCtx.lastName}`.trim() : "";

  const tokens: Tokens = {
    customer: customerName,
    "customer.fullName": customerName,
    lead: customerName,
    project: project?.projectNumber ?? "",
    stage: stage?.name ?? "",
    // Enum statuses read better with spaces ("in production"). An agent's status
    // is a sentence that can name a handler key ("bank.ntp_poll"), so it passes
    // through untouched.
    status: AGENT_EVENTS.has(args.event) ? (args.status ?? "") : (args.status ?? "").replace(/_/g, " "),
    agent: args.agentName ?? "",
    document: doc?.title ?? "",
    task: task?.title ?? "",
    actor: actor ? `${actor.firstName} ${actor.lastName}`.trim() : "System",
    company: company?.name ?? "",
  };

  const link = buildLink(args, { leadId: lead?.id ?? leadForCtx?.id, projectId, documentId: doc?.id });

  // The workspace this notification came from, taken from the entity that caused
  // it rather than from ambient context. The two can disagree: a cron job or a
  // webhook fires with no workspace open at all, and stamping "whatever the
  // actor had selected" would file a Solar alert under Roofing. NULL is the
  // honest answer for a genuinely company-level event (payroll approved), and it
  // shows in every workspace.
  const originVertical = lead?.vertical ?? project?.vertical ?? task?.vertical ?? null;

  // --- Load branding for the from-name + branded email template ---
  const { brand, fromName } = await emailBrandFor(args.companyId);
  const appUrl = (brand.appUrl ?? "http://localhost:3000").replace(/\/$/, "");
  const absoluteLink = link.startsWith("http") ? link : `${appUrl}${link.startsWith("/") ? "" : "/"}${link}`;

  // --- Cache role lookups ---
  const roleCache = new Map<string, string[]>();
  async function usersByRoles(roles: string[]): Promise<string[]> {
    const key = roles.slice().sort().join(",");
    if (roleCache.has(key)) return roleCache.get(key)!;
    const users = await prisma.user.findMany({
      where: { companyId: args.companyId, status: "active", role: { in: roles as Role[] } },
      select: { id: true },
    });
    const ids = users.map((u) => u.id);
    roleCache.set(key, ids);
    return ids;
  }
  const dynamicRoleUsers = (roleList: string[]) => usersByRoles(roleList);

  // Holders of the Agents access switch (modules/agents/access.ts): managers
  // whose permission overrides carry Agent:approve. Read now, when the alert
  // fires, so switching someone off stops the next alert with no rule to edit.
  let agentsAccessIds: string[] | null = null;
  async function agentsAccessUsers(): Promise<string[]> {
    if (agentsAccessIds) return agentsAccessIds;
    const users = await prisma.user.findMany({
      where: {
        companyId: args.companyId,
        status: "active",
        role: AGENT_ACCESS_ROLE,
        permissions: { path: ["Agent:approve"], equals: true },
      },
      select: { id: true },
    });
    agentsAccessIds = users.map((u) => u.id);
    return agentsAccessIds;
  }

  for (const rule of rules) {
    if (!conditionMatches(rule.event, rule.conditions as Record<string, unknown>, args)) continue;

    const cfg = (rule.recipients as RecipientConfig) ?? {};
    const recipientIds = new Set<string>();

    if (cfg.roles?.length) {
      for (const id of await usersByRoles(cfg.roles)) recipientIds.add(id);
    }
    if (cfg.userIds?.length) {
      for (const id of cfg.userIds) recipientIds.add(id);
    }
    for (const dyn of cfg.dynamic ?? []) {
      const id = resolveDynamic(dyn, { lead: leadForCtx, project, task });
      if (id) recipientIds.add(id);
      if (dyn === "all_admins") for (const x of await dynamicRoleUsers(["admin", "super_admin"])) recipientIds.add(x);
      if (dyn === "all_managers") for (const x of await dynamicRoleUsers(["manager"])) recipientIds.add(x);
      if (dyn === "agents_access") for (const x of await agentsAccessUsers()) recipientIds.add(x);
    }

    // Note: the person who performed the action IS notified if they're in the
    // recipient list (owners/managers want visibility into their own moves).
    if (recipientIds.size === 0) continue;

    const channels = (rule.channels as NotificationChannel[]) ?? ["in_app"];
    const title = fillTokens(rule.titleTemplate, tokens);
    const body = fillTokens(rule.bodyTemplate, tokens);

    // Validate recipients belong to the company (and grab contact info for email/sms).
    // Only active, non-deleted users get notified — suspended/disabled/deleted
    // people (e.g. a deal's former assigned rep) are skipped.
    const recipients = await prisma.user.findMany({
      where: { id: { in: [...recipientIds] }, companyId: args.companyId, status: "active", deletedAt: null },
      select: { id: true, email: true, phone: true },
    });

    for (const r of recipients) {
      if (channels.includes("in_app")) {
        await prisma.notification.create({
          data: { companyId: args.companyId, userId: r.id, ruleId: rule.id, event: args.event, title, body, link, channel: "in_app", vertical: originVertical },
        });
      }
      if (channels.includes("email") && r.email) {
        const tpl = brandedEmailTemplate({
          brand,
          subject: title,
          heading: title,
          paragraphs: body ? [body] : [],
          cta: link ? { label: "View in portal", url: absoluteLink } : undefined,
        });
        await sendEmail(r.email, tpl.subject, tpl.text, { fromName, html: tpl.html });
      }
      if (channels.includes("sms") && r.phone) await sendSms(r.phone, `${title}\n${body}`);
    }
  }
}

function conditionMatches(event: NotificationEvent, conditions: Record<string, unknown>, args: FireArgs): boolean {
  if (event === "stage_changed") {
    const want = conditions?.stageId as string | undefined;
    return !want || want === args.stageId;
  }
  if (event === "project_status_changed") {
    const want = conditions?.status as string | undefined;
    return !want || want === args.status;
  }
  return true;
}

function resolveDynamic(
  target: string,
  ctx: {
    lead: { assignedRepId: string | null; createdById: string | null } | null;
    project: { managerId: string | null } | null;
    task: { assigneeId: string | null } | null;
  }
): string | null {
  switch (target) {
    case "assigned_rep":
      return ctx.lead?.assignedRepId ?? null;
    case "project_manager":
      return ctx.project?.managerId ?? null;
    case "lead_creator":
      return ctx.lead?.createdById ?? null;
    case "task_assignee":
      return ctx.task?.assigneeId ?? null;
    default:
      return null;
  }
}

function buildLink(args: FireArgs, ids: { leadId?: string | null; projectId?: string | null; documentId?: string | null }): string {
  switch (args.event) {
    case "lead_created":
    case "lead_assigned":
    case "stage_changed":
      return ids.leadId ? `/portal/leads/${ids.leadId}` : "/portal/leads";
    case "project_status_changed":
    case "daily_report_submitted":
      return ids.projectId ? `/portal/projects/${ids.projectId}` : "/portal/projects";
    case "document_sent":
    case "document_viewed":
    case "document_signed":
    case "document_completed":
      return ids.documentId ? `/portal/documents/${ids.documentId}` : "/portal/documents";
    case "task_assigned":
      return "/portal/tasks";
    case "commission_approved":
      return "/portal/commissions";
    case "payroll_approved":
      return "/portal/payroll";
    case "agent_run_failed":
    case "agent_needs_human":
      return "/portal/agents/runs";
    default:
      return "/portal/dashboard";
  }
}
