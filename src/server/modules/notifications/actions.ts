"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { permittedVerticalFilter } from "@/server/vertical/visibility";
import { planStarterRules } from "./defaults";

function fail(error: string) {
  return { ok: false as const, error };
}
function ok() {
  return { ok: true as const };
}

const EVENTS = [
  "lead_created", "lead_assigned", "stage_changed", "project_status_changed",
  "document_sent", "document_viewed", "document_signed", "document_completed",
  "task_assigned", "daily_report_submitted", "commission_approved", "payroll_approved",
  "automation_failed",
] as const;

const ruleSchema = z.object({
  name: z.string().min(1).max(120),
  event: z.enum(EVENTS),
  conditions: z.object({ stageId: z.string().optional(), status: z.string().optional() }).default({}),
  recipients: z.object({
    roles: z.array(z.string()).optional().default([]),
    userIds: z.array(z.string()).optional().default([]),
    dynamic: z.array(z.string()).optional().default([]),
  }).default({}),
  channels: z.array(z.enum(["in_app", "email", "sms"])).min(1).default(["in_app"]),
  titleTemplate: z.string().min(1).max(200),
  bodyTemplate: z.string().min(1).max(600),
  active: z.boolean().optional().default(true),
});

export type RuleInput = z.infer<typeof ruleSchema>;

export async function createNotificationRuleAction(input: RuleInput) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const parsed = ruleSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid rule.");
  const d = parsed.data;
  await prisma.notificationRule.create({
    data: {
      companyId: user.companyId,
      name: d.name,
      event: d.event,
      conditions: d.conditions as Prisma.InputJsonValue,
      recipients: d.recipients as Prisma.InputJsonValue,
      channels: d.channels as Prisma.InputJsonValue,
      titleTemplate: d.titleTemplate,
      bodyTemplate: d.bodyTemplate,
      active: d.active,
    },
  });
  revalidatePath("/portal/settings/notifications");
  return ok();
}

export async function updateNotificationRuleAction(id: string, input: RuleInput) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const parsed = ruleSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid rule.");
  const existing = await prisma.notificationRule.findFirst({ where: { id, companyId: user.companyId }, select: { id: true } });
  if (!existing) return fail("Rule not found.");
  const d = parsed.data;
  await prisma.notificationRule.update({
    where: { id },
    data: {
      name: d.name,
      event: d.event,
      conditions: d.conditions as Prisma.InputJsonValue,
      recipients: d.recipients as Prisma.InputJsonValue,
      channels: d.channels as Prisma.InputJsonValue,
      titleTemplate: d.titleTemplate,
      bodyTemplate: d.bodyTemplate,
      active: d.active,
    },
  });
  revalidatePath("/portal/settings/notifications");
  return ok();
}

export async function toggleNotificationRuleAction(id: string, active: boolean) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const existing = await prisma.notificationRule.findFirst({ where: { id, companyId: user.companyId }, select: { id: true } });
  if (!existing) return fail("Rule not found.");
  await prisma.notificationRule.update({ where: { id }, data: { active } });
  revalidatePath("/portal/settings/notifications");
  return ok();
}

export async function deleteNotificationRuleAction(id: string) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const existing = await prisma.notificationRule.findFirst({ where: { id, companyId: user.companyId }, select: { id: true } });
  if (!existing) return fail("Rule not found.");
  await prisma.notificationRule.delete({ where: { id } });
  revalidatePath("/portal/settings/notifications");
  return ok();
}

// --- Recipient (mark read) ---

export async function markNotificationReadAction(id: string) {
  const user = await requireUser();
  await prisma.notification.updateMany({
    where: { id, userId: user.userId },
    data: { read: true, readAt: new Date() },
  });
  revalidatePath("/portal/notifications");
  return ok();
}

export async function markAllNotificationsReadAction() {
  const user = await requireUser();
  // "All" means all the notifications this person can actually SEE. Without the
  // filter, clearing the bell would also silently read-flag alerts from a
  // workspace they lost access to — and if that access is ever restored those
  // alerts come back already read, which is how a real one gets missed.
  await prisma.notification.updateMany({
    where: { userId: user.userId, read: false, ...permittedVerticalFilter(user) },
    data: { read: true, readAt: new Date() },
  });
  revalidatePath("/portal/notifications");
  return ok();
}

/**
 * The rules this workspace would gain from the starter set, without writing any.
 *
 * Separate from applying them on purpose: these rules send real email to real
 * staff the next time a deal moves, so the set is shown and confirmed before it
 * exists rather than after.
 */
export async function previewStarterNotificationRulesAction() {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");

  const [stages, existing] = await Promise.all([
    // The active workspace's pipeline — the extension scopes `pipeline`, and
    // stages are reached through it, so this is the open workspace's list.
    prisma.pipelineStage.findMany({
      where: { pipeline: { companyId: user.companyId } },
      orderBy: { position: "asc" },
      select: { id: true, name: true },
    }),
    prisma.notificationRule.findMany({
      where: { companyId: user.companyId },
      select: { name: true },
    }),
  ]);

  const planned = planStarterRules(stages, existing.map((r) => r.name));
  return {
    ok: true as const,
    rules: planned.map((r) => ({
      name: r.name,
      event: r.event,
      channels: r.channels,
      recipients: [...r.recipients.roles, ...r.recipients.dynamic],
    })),
  };
}

/**
 * Create the starter rules this workspace is missing. Additive and idempotent:
 * a rule whose name is already taken is skipped, so pressing it twice tops the
 * set up instead of duplicating it.
 */
export async function applyStarterNotificationRulesAction() {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");

  const [stages, existing] = await Promise.all([
    prisma.pipelineStage.findMany({
      where: { pipeline: { companyId: user.companyId } },
      orderBy: { position: "asc" },
      select: { id: true, name: true },
    }),
    prisma.notificationRule.findMany({
      where: { companyId: user.companyId },
      select: { name: true },
    }),
  ]);

  const planned = planStarterRules(stages, existing.map((r) => r.name));
  if (planned.length === 0) return fail("This workspace already has every starter rule.");

  for (const r of planned) {
    await prisma.notificationRule.create({
      data: {
        companyId: user.companyId,
        name: r.name,
        event: r.event,
        conditions: r.conditions as Prisma.InputJsonValue,
        recipients: r.recipients as Prisma.InputJsonValue,
        channels: r.channels as Prisma.InputJsonValue,
        titleTemplate: r.titleTemplate,
        bodyTemplate: r.bodyTemplate,
        active: true,
      },
    });
  }

  revalidatePath("/portal/settings/notifications");
  return { ok: true as const, created: planned.length };
}
