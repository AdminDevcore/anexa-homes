"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { getActiveVertical } from "@/server/auth/vertical";
import { sanitizeConditions, toStoredConditions } from "@/lib/pipeline-filters";

/**
 * Saved Pipeline filters.
 *
 * A view holds filter CONDITIONS, never deal data. Applying one runs the same
 * in-browser filter over the deals the page already scoped to the viewer, so a
 * rep who opens a manager's shared "Overdue NTP" still sees only their own
 * deals. That is why saving a private view needs nothing beyond seeing the
 * pipeline.
 *
 * Sharing is the permission that matters: a shared view appears in the Views
 * menu of everyone on this workspace's pipeline. So only a role that may edit
 * the pipeline itself (super admin, admin, manager) can share one, or change or
 * delete a shared one somebody else made.
 */

function fail(error: string) {
  return { ok: false as const, error };
}

const MAX_VIEWS_PER_PERSON = 50;

const saveSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Give the view a name.").max(60, "Keep the name under 60 characters."),
  shared: z.boolean().default(false),
  match: z.enum(["all", "any"]).default("all"),
  conditions: z.array(z.unknown()).max(30),
});

function mayChange(view: { createdById: string; shared: boolean }, userId: string, canShare: boolean) {
  return view.createdById === userId || (view.shared && canShare);
}

export async function saveFilterViewAction(input: z.input<typeof saveSchema>) {
  const user = await requireUser();
  if (!can(user, "read", "Lead")) return fail("Not allowed.");
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "That view could not be saved.");
  const d = parsed.data;

  // Re-sanitised here as well as in the browser: this JSON is read back into
  // every teammate's Views menu, so the server decides what shape it has.
  const conditions = toStoredConditions(sanitizeConditions(d.conditions));
  if (conditions.length === 0) return fail("Add at least one filter before saving a view.");
  const canShare = can(user, "update", "Pipeline");
  if (d.shared && !canShare) return fail("Only managers and admins can share a view with the team.");

  const data = {
    name: d.name,
    shared: d.shared,
    match: d.match,
    conditions: conditions as unknown as Prisma.InputJsonValue,
  };
  const select = { id: true, name: true, shared: true } as const;

  if (d.id) {
    const view = await prisma.pipelineFilterView.findFirst({
      where: { id: d.id, companyId: user.companyId },
      select: { id: true, createdById: true, shared: true },
    });
    if (!view) return fail("That view no longer exists.");
    if (!mayChange(view, user.userId, canShare)) return fail("Only the person who made this view can change it.");
    const row = await prisma.pipelineFilterView.update({ where: { id: view.id }, data, select });
    revalidatePath("/portal/pipeline");
    return { ok: true as const, view: row };
  }

  const mine = await prisma.pipelineFilterView.count({
    where: { companyId: user.companyId, createdById: user.userId },
  });
  if (mine >= MAX_VIEWS_PER_PERSON) return fail(`You can keep up to ${MAX_VIEWS_PER_PERSON} views. Delete one first.`);

  const row = await prisma.pipelineFilterView.create({
    data: {
      ...data,
      companyId: user.companyId,
      vertical: await getActiveVertical(user),
      createdById: user.userId,
    },
    select,
  });
  revalidatePath("/portal/pipeline");
  return { ok: true as const, view: row };
}

export async function deleteFilterViewAction(id: string) {
  const user = await requireUser();
  if (!can(user, "read", "Lead")) return fail("Not allowed.");
  if (!z.string().uuid().safeParse(id).success) return fail("That view no longer exists.");

  const view = await prisma.pipelineFilterView.findFirst({
    where: { id, companyId: user.companyId },
    select: { id: true, createdById: true, shared: true },
  });
  if (!view) return fail("That view no longer exists.");
  if (!mayChange(view, user.userId, can(user, "update", "Pipeline"))) {
    return fail("Only the person who made this view can delete it.");
  }

  await prisma.pipelineFilterView.delete({ where: { id: view.id } });
  revalidatePath("/portal/pipeline");
  return { ok: true as const };
}
