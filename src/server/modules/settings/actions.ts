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

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "field";
}

// --------------------------- Pipeline stages --------------------------------

const stageSchema = z.object({
  name: z.string().min(1).max(60),
  color: z.string().min(1).max(20),
  isWon: z.boolean().optional(),
  isLost: z.boolean().optional(),
});

export async function addPipelineStageAction(pipelineId: string, input: z.infer<typeof stageSchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const parsed = stageSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid stage.");

  const pipeline = await prisma.pipeline.findFirst({
    where: { id: pipelineId, companyId: user.companyId },
    include: { stages: { orderBy: { position: "desc" }, take: 1 } },
  });
  if (!pipeline) return fail("Pipeline not found.");

  const nextPos = (pipeline.stages[0]?.position ?? -1) + 1;
  await prisma.pipelineStage.create({
    data: {
      pipelineId,
      name: parsed.data.name,
      key: `${slug(parsed.data.name)}_${nextPos}`,
      color: parsed.data.color,
      position: nextPos,
      isWon: parsed.data.isWon ?? false,
      isLost: parsed.data.isLost ?? false,
    },
  });
  revalidatePath("/portal/settings/pipeline");
  return ok();
}

export async function updatePipelineStageAction(id: string, input: z.infer<typeof stageSchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const parsed = stageSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid stage.");

  const stage = await prisma.pipelineStage.findFirst({
    where: { id, pipeline: { companyId: user.companyId } },
    select: { id: true },
  });
  if (!stage) return fail("Stage not found.");

  await prisma.pipelineStage.update({
    where: { id },
    data: {
      name: parsed.data.name,
      color: parsed.data.color,
      isWon: parsed.data.isWon ?? false,
      isLost: parsed.data.isLost ?? false,
    },
  });
  revalidatePath("/portal/settings/pipeline");
  return ok();
}

export async function deletePipelineStageAction(id: string) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const stage = await prisma.pipelineStage.findFirst({
    where: { id, pipeline: { companyId: user.companyId } },
    select: { id: true },
  });
  if (!stage) return fail("Stage not found.");

  // Detach leads from the stage before deleting (FK is restrict).
  await prisma.$transaction([
    prisma.lead.updateMany({ where: { stageId: id }, data: { stageId: null } }),
    prisma.pipelineStage.delete({ where: { id } }),
  ]);
  revalidatePath("/portal/settings/pipeline");
  return ok();
}

export async function reorderPipelineStagesAction(orderedIds: string[]) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const stages = await prisma.pipelineStage.findMany({
    where: { id: { in: orderedIds }, pipeline: { companyId: user.companyId } },
    select: { id: true },
  });
  const valid = new Set(stages.map((s) => s.id));
  await prisma.$transaction(
    orderedIds
      .filter((id) => valid.has(id))
      .map((id, i) => prisma.pipelineStage.update({ where: { id }, data: { position: i } }))
  );
  revalidatePath("/portal/settings/pipeline");
  return ok();
}

// ----------------------- Appointment dispositions ---------------------------

const dispositionsSchema = z.object({
  items: z
    .array(
      z.object({
        group: z.string().trim().max(40).nullable().optional(),
        label: z.string().trim().min(1).max(60),
      })
    )
    .max(80),
});

/** Replace the company's customizable, grouped appointment outcomes (full list). */
export async function updateAppointmentDispositionsAction(input: z.infer<typeof dispositionsSchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const parsed = dispositionsSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid outcomes.");

  // De-dupe by label (case-insensitive) while preserving order; keep group.
  const seen = new Set<string>();
  const items: { group: string | null; label: string }[] = [];
  for (const raw of parsed.data.items) {
    const label = raw.label.trim();
    const group = raw.group?.trim() || null;
    if (!label || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    items.push({ group, label });
  }
  if (items.length === 0) return fail("Keep at least one outcome.");

  await prisma.companySettings.upsert({
    where: { companyId: user.companyId },
    create: { companyId: user.companyId, appointmentDispositions: items },
    update: { appointmentDispositions: items },
  });
  revalidatePath("/portal/settings/appointment-outcomes");
  return ok();
}

// --------------------------- Custom fields ----------------------------------

const fieldSchema = z.object({
  entity: z.enum(["lead", "project"]),
  label: z.string().min(1).max(80),
  type: z.enum(["text", "number", "date", "select", "checkbox", "textarea"]),
  options: z.array(z.string()).optional().default([]),
  required: z.boolean().optional().default(false),
});

export async function createCustomFieldAction(input: z.infer<typeof fieldSchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const parsed = fieldSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid field.");

  const count = await prisma.customFieldDef.count({
    where: { companyId: user.companyId, entity: parsed.data.entity },
  });
  const key = slug(parsed.data.label);
  const exists = await prisma.customFieldDef.findFirst({
    where: { companyId: user.companyId, entity: parsed.data.entity, key },
  });
  if (exists) return fail("A field with a similar name already exists.");

  await prisma.customFieldDef.create({
    data: {
      companyId: user.companyId,
      entity: parsed.data.entity,
      key,
      label: parsed.data.label,
      type: parsed.data.type,
      options: parsed.data.options,
      required: parsed.data.required,
      position: count,
    },
  });
  revalidatePath("/portal/settings/fields");
  return ok();
}

export async function deleteCustomFieldAction(id: string) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const field = await prisma.customFieldDef.findFirst({
    where: { id, companyId: user.companyId },
    select: { id: true },
  });
  if (!field) return fail("Field not found.");
  await prisma.customFieldDef.delete({ where: { id } });
  revalidatePath("/portal/settings/fields");
  return ok();
}

// --------------------------- Branding ---------------------------------------

const brandingSchema = z.object({
  logoUrl: z.string().max(500).optional().or(z.literal("")),
  primaryColor: z.string().min(1).max(20),
  accentColor: z.string().min(1).max(20),
});

export async function updateBrandingAction(input: z.infer<typeof brandingSchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const parsed = brandingSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid branding values.");

  await prisma.companySettings.upsert({
    where: { companyId: user.companyId },
    update: {
      logoUrl: parsed.data.logoUrl || null,
      primaryColor: parsed.data.primaryColor,
      accentColor: parsed.data.accentColor,
    },
    create: {
      companyId: user.companyId,
      logoUrl: parsed.data.logoUrl || null,
      primaryColor: parsed.data.primaryColor,
      accentColor: parsed.data.accentColor,
    },
  });
  revalidatePath("/portal/settings/branding");
  return ok();
}
