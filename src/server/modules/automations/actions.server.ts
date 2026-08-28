"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { validateRule, type RuleInput } from "./validate";
import { planStarterAutomations } from "./defaults";

/**
 * Settings CRUD for automation rules.
 *
 * Gated on the existing Settings `update` permission rather than a new one: a
 * rule that can move a deal and send a customer a contract is exactly as
 * powerful as the pipeline and document settings sitting beside it.
 *
 * Nothing here stamps `vertical` — the isolation extension does it from the
 * active workspace, the same way notification rules are written.
 */

function fail(error: string) {
  return { ok: false as const, error };
}

export async function createAutomationRuleAction(input: RuleInput) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const v = validateRule(input);
  if (!v.ok) return fail(v.error);

  await prisma.automationRule.create({
    data: {
      companyId: user.companyId,
      name: v.value.name,
      trigger: v.value.trigger,
      conditions: v.value.conditions as Prisma.InputJsonValue,
      actions: v.value.actions as Prisma.InputJsonValue,
      once: v.value.once,
      active: v.value.active,
    },
  });
  revalidatePath("/portal/settings/automations");
  return { ok: true as const };
}

export async function updateAutomationRuleAction(id: string, input: RuleInput) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const v = validateRule(input);
  if (!v.ok) return fail(v.error);

  const existing = await prisma.automationRule.findFirst({
    where: { id, companyId: user.companyId },
    select: { id: true },
  });
  if (!existing) return fail("Rule not found.");

  await prisma.automationRule.update({
    where: { id },
    data: {
      name: v.value.name,
      trigger: v.value.trigger,
      conditions: v.value.conditions as Prisma.InputJsonValue,
      actions: v.value.actions as Prisma.InputJsonValue,
      once: v.value.once,
      active: v.value.active,
    },
  });
  revalidatePath("/portal/settings/automations");
  return { ok: true as const };
}

export async function toggleAutomationRuleAction(id: string, active: boolean) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const existing = await prisma.automationRule.findFirst({
    where: { id, companyId: user.companyId },
    select: { id: true },
  });
  if (!existing) return fail("Rule not found.");
  await prisma.automationRule.update({ where: { id }, data: { active } });
  revalidatePath("/portal/settings/automations");
  return { ok: true as const };
}

export async function deleteAutomationRuleAction(id: string) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const existing = await prisma.automationRule.findFirst({
    where: { id, companyId: user.companyId },
    select: { id: true },
  });
  if (!existing) return fail("Rule not found.");
  // The runs go with it (onDelete: Cascade). Deleting a rule is deleting the
  // history of a rule that no longer exists, which is the point of the button.
  await prisma.automationRule.delete({ where: { id } });
  revalidatePath("/portal/settings/automations");
  return { ok: true as const };
}

/**
 * Create the starter set, skipping any rule this workspace already has by name
 * — so a second click adds nothing rather than duplicating everything.
 */
export async function createStarterAutomationsAction() {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");

  const planned = await planStarterAutomations(user.companyId);
  if (planned.length === 0) {
    return fail("This workspace has no stages or templates to build a starter rule from yet.");
  }

  const existing = await prisma.automationRule.findMany({
    where: { companyId: user.companyId },
    select: { name: true },
  });
  const have = new Set(existing.map((r) => r.name));
  const fresh = planned.filter((p) => !have.has(p.name));

  for (const p of fresh) {
    await prisma.automationRule.create({
      data: {
        companyId: user.companyId,
        name: p.name,
        trigger: p.trigger,
        conditions: p.conditions as Prisma.InputJsonValue,
        actions: p.actions as Prisma.InputJsonValue,
      },
    });
  }

  revalidatePath("/portal/settings/automations");
  return { ok: true as const, created: fresh.length };
}
