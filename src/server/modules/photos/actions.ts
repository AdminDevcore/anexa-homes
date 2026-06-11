"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";

function fail(error: string) {
  return { ok: false as const, error };
}
function ok() {
  return { ok: true as const };
}

const addSchema = z.object({
  templateId: z.string().min(1),
  label: z.string().min(1, "Label is required").max(120),
  required: z.boolean().optional().default(false),
});

export async function addPhotoTemplateItemAction(input: z.infer<typeof addSchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Only admins can edit photo templates.");
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid item.");

  const template = await prisma.photoTemplate.findFirst({
    where: { id: parsed.data.templateId, companyId: user.companyId },
    select: { id: true },
  });
  if (!template) return fail("Template not found.");

  const last = await prisma.photoTemplateItem.findFirst({
    where: { templateId: template.id },
    orderBy: { position: "desc" },
    select: { position: true },
  });

  await prisma.photoTemplateItem.create({
    data: {
      templateId: template.id,
      label: parsed.data.label.trim(),
      required: parsed.data.required,
      position: (last?.position ?? -1) + 1,
    },
  });
  revalidatePath("/portal/settings/photo-templates");
  return ok();
}

const updateSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(120).optional(),
  required: z.boolean().optional(),
});

export async function updatePhotoTemplateItemAction(input: z.infer<typeof updateSchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Only admins can edit photo templates.");
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid update.");

  const item = await prisma.photoTemplateItem.findFirst({
    where: { id: parsed.data.id, template: { companyId: user.companyId } },
    select: { id: true },
  });
  if (!item) return fail("Item not found.");

  await prisma.photoTemplateItem.update({
    where: { id: parsed.data.id },
    data: {
      ...(parsed.data.label !== undefined ? { label: parsed.data.label.trim() } : {}),
      ...(parsed.data.required !== undefined ? { required: parsed.data.required } : {}),
    },
  });
  revalidatePath("/portal/settings/photo-templates");
  return ok();
}

export async function deletePhotoTemplateItemAction(id: string) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Only admins can edit photo templates.");
  const item = await prisma.photoTemplateItem.findFirst({
    where: { id, template: { companyId: user.companyId } },
    select: { id: true },
  });
  if (!item) return fail("Item not found.");
  await prisma.photoTemplateItem.delete({ where: { id } });
  revalidatePath("/portal/settings/photo-templates");
  return ok();
}
