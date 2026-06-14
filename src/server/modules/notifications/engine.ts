import type { NotificationChannel, NotificationEvent, Role } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { emailBrandFor } from "@/server/modules/notifications/brand";
import { brandedEmailTemplate } from "@/server/modules/notifications/email-templates";
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
};

type Tokens = Record<string, string>;

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
        include: { lead: { select: { id: true, firstName: true, lastName: true, customerUserId: true, assignedRepId: true, createdById: true } } },
      })
    : null;

  const doc = args.documentId
    ? await prisma.documentPackage.findUnique({ where: { id: args.documentId }, select: { id: true, title: true, leadId: true, projectId: true } })
    : null;

  const task = args.taskId
    ? await prisma.task.findUnique({ where: { id: args.taskId }, select: { id: true, title: true, assigneeId: true } })
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
    status: (args.status ?? "").replace(/_/g, " "),
    document: doc?.title ?? "",
    task: task?.title ?? "",
    actor: actor ? `${actor.firstName} ${actor.lastName}`.trim() : "System",
    company: company?.name ?? "",
  };

  const link = buildLink(args, { leadId: lead?.id ?? leadForCtx?.id, projectId, documentId: doc?.id });

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
    }

    // Don't notify the actor about their own action.
    if (args.actorId) recipientIds.delete(args.actorId);
    if (recipientIds.size === 0) continue;

    const channels = (rule.channels as NotificationChannel[]) ?? ["in_app"];
    const title = fillTokens(rule.titleTemplate, tokens);
    const body = fillTokens(rule.bodyTemplate, tokens);

    // Validate recipients belong to the company (and grab contact info for email/sms).
    const recipients = await prisma.user.findMany({
      where: { id: { in: [...recipientIds] }, companyId: args.companyId },
      select: { id: true, email: true, phone: true },
    });

    for (const r of recipients) {
      if (channels.includes("in_app")) {
        await prisma.notification.create({
          data: { companyId: args.companyId, userId: r.id, ruleId: rule.id, event: args.event, title, body, link, channel: "in_app" },
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
    lead: { customerUserId: string | null; assignedRepId: string | null; createdById: string | null } | null;
    project: { managerId: string | null } | null;
    task: { assigneeId: string | null } | null;
  }
): string | null {
  switch (target) {
    case "assigned_rep":
      return ctx.lead?.assignedRepId ?? null;
    case "project_manager":
      return ctx.project?.managerId ?? null;
    case "customer":
      return ctx.lead?.customerUserId ?? null;
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
    default:
      return "/portal/dashboard";
  }
}
