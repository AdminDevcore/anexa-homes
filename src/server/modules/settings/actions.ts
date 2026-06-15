"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { putObject } from "@/server/storage";

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
  // SLA / stage-duration settings.
  targetDays: z.number().int().min(0).max(3650).optional(),
  escalationDays: z.number().int().min(0).max(3650).optional(),
  notificationRecipient: z.enum(["none", "assigned_user", "team_manager", "project_owner", "department_manager", "everyone"]).optional(),
  sendInApp: z.boolean().optional(),
  sendEmail: z.boolean().optional(),
  markOverdue: z.boolean().optional(),
});

function stageSlaData(d: z.infer<typeof stageSchema>) {
  return {
    targetDays: d.targetDays ?? 0,
    escalationDays: d.escalationDays ?? 0,
    notificationRecipient: d.notificationRecipient ?? "none",
    sendInApp: d.sendInApp ?? true,
    sendEmail: d.sendEmail ?? false,
    markOverdue: d.markOverdue ?? false,
  };
}

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
      ...stageSlaData(parsed.data),
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
      ...stageSlaData(parsed.data),
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

// ---- Inspection outcomes + production checklist (simple label lists) --------

const labelListSchema = z.object({
  items: z.array(z.string().trim().min(1).max(80)).max(60),
});

/** De-dupe a label list (case-insensitive), preserving order. */
function cleanLabels(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const label = raw.trim();
    if (!label || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    out.push(label);
  }
  return out;
}

/** Replace the company's customizable inspection outcomes (full list). */
export async function updateInspectionOutcomesAction(input: z.infer<typeof labelListSchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const parsed = labelListSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid outcomes.");
  const items = cleanLabels(parsed.data.items);
  if (items.length === 0) return fail("Keep at least one outcome.");

  await prisma.companySettings.upsert({
    where: { companyId: user.companyId },
    create: { companyId: user.companyId, inspectionOutcomes: items },
    update: { inspectionOutcomes: items },
  });
  revalidatePath("/portal/settings/inspection-outcomes");
  return ok();
}

/** Replace the company's default production QC checklist (full list of labels). */
export async function updateQcChecklistTemplateAction(input: z.infer<typeof labelListSchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const parsed = labelListSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid checklist.");
  const items = cleanLabels(parsed.data.items);
  if (items.length === 0) return fail("Keep at least one checklist item.");

  await prisma.companySettings.upsert({
    where: { companyId: user.companyId },
    create: { companyId: user.companyId, qcChecklistTemplate: items },
    update: { qcChecklistTemplate: items },
  });
  revalidatePath("/portal/settings/production-checklist");
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
  faviconUrl: z.string().max(500).optional().or(z.literal("")),
  primaryColor: z.string().min(1).max(20),
  accentColor: z.string().min(1).max(20),
  fontFamily: z.string().max(80).optional().or(z.literal("")),
  recordPrefix: z.string().max(8).optional().or(z.literal("")),
  supportPhone: z.string().max(40).optional().or(z.literal("")),
  supportEmail: z.string().max(120).optional().or(z.literal("")),
  currencyCode: z.string().length(3),
  locale: z.string().min(2).max(12),
  emailFromName: z.string().max(80).optional().or(z.literal("")),
  customDomain: z.string().max(255).optional().or(z.literal("")),
  removePoweredBy: z.boolean().optional(),
});

export async function updateBrandingAction(input: z.infer<typeof brandingSchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const parsed = brandingSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid branding values.");
  const d = parsed.data;
  const data = {
    logoUrl: d.logoUrl || null,
    faviconUrl: d.faviconUrl || null,
    primaryColor: d.primaryColor,
    accentColor: d.accentColor,
    fontFamily: d.fontFamily || null,
    recordPrefix: d.recordPrefix?.trim() || "",
    supportPhone: d.supportPhone || null,
    supportEmail: d.supportEmail || null,
    currencyCode: d.currencyCode.toUpperCase(),
    locale: d.locale,
    emailFromName: d.emailFromName || null,
    customDomain: d.customDomain?.trim().toLowerCase() || null,
    removePoweredBy: d.removePoweredBy ?? false,
  };
  await prisma.companySettings.upsert({
    where: { companyId: user.companyId },
    update: data,
    create: { companyId: user.companyId, ...data },
  });
  revalidatePath("/portal/settings/branding");
  revalidatePath("/portal", "layout");
  return ok();
}

/** Category tag for the company's branding logo FileAsset (one per company). */
const BRANDING_LOGO_CATEGORY = "branding_logo";
const LOGO_MAX_BYTES = 5 * 1024 * 1024; // 5MB — logos are small
const LOGO_ALLOWED = new Set(["image/png", "image/jpeg", "image/webp"]);

/**
 * Upload a logo file. Stores it, replaces any prior logo, and points the
 * company's `logoUrl` at the public serving route so the sidebar (and login,
 * emails, proposals) pick it up immediately. SVG is intentionally not accepted
 * (serving user SVG is an XSS surface) — export a PNG instead.
 */
export async function uploadBrandingLogoAction(
  formData: FormData
): Promise<{ ok: true; logoUrl: string } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");

  const file = formData.get("file");
  if (!(file instanceof File)) return fail("No file provided.");
  if (file.size > LOGO_MAX_BYTES) return fail("Logo too large (max 5MB).");
  if (!LOGO_ALLOWED.has(file.type)) return fail("Use a PNG, JPG, or WebP image.");

  // Resize within 512×512 and output PNG to keep transparency for logos.
  const raw = Buffer.from(await file.arrayBuffer());
  let png: Buffer;
  try {
    png = await sharp(raw)
      .rotate()
      .resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
  } catch {
    return fail("Could not process that image.");
  }

  const key = `companies/${user.companyId}/branding/${nanoid()}.png`;
  await putObject(key, png);

  // One logo per company: drop prior branding-logo rows, then record the new one.
  await prisma.fileAsset.deleteMany({
    where: { companyId: user.companyId, category: BRANDING_LOGO_CATEGORY },
  });
  await prisma.fileAsset.create({
    data: {
      companyId: user.companyId,
      kind: "photo",
      name: file.name,
      storageKey: key,
      mimeType: "image/png",
      size: png.length,
      category: BRANDING_LOGO_CATEGORY,
      uploadedById: user.userId,
    },
  });

  // Relative URL with a cache-busting version. Emails absolutize it via appUrl.
  const logoUrl = `/api/branding/logo?company=${user.companyId}&v=${Date.now()}`;
  await prisma.companySettings.upsert({
    where: { companyId: user.companyId },
    update: { logoUrl },
    create: { companyId: user.companyId, logoUrl },
  });

  revalidatePath("/portal/settings/branding");
  revalidatePath("/portal", "layout");
  return { ok: true, logoUrl };
}

/** Toggle the weekly open-task reminder digest (read by the task-reminders cron). */
export async function setWeeklyTaskRemindersAction(enabled: boolean) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  await prisma.companySettings.upsert({
    where: { companyId: user.companyId },
    update: { weeklyTaskRemindersEnabled: enabled },
    create: { companyId: user.companyId, weeklyTaskRemindersEnabled: enabled },
  });
  revalidatePath("/portal/settings/notifications");
  return ok();
}

const companyIdentitySchema = z.object({
  name: z.string().min(1).max(120),
  address: z.string().max(200).optional().or(z.literal("")),
  city: z.string().max(80).optional().or(z.literal("")),
  state: z.string().max(40).optional().or(z.literal("")),
  zip: z.string().max(20).optional().or(z.literal("")),
  timezone: z.string().max(60),
});

export async function updateCompanyIdentityAction(input: z.infer<typeof companyIdentitySchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const parsed = companyIdentitySchema.safeParse(input);
  if (!parsed.success) return fail("Invalid company values.");
  const d = parsed.data;
  await prisma.company.update({
    where: { id: user.companyId },
    data: {
      name: d.name,
      address: d.address || null,
      city: d.city || null,
      state: d.state || null,
      zip: d.zip || null,
      timezone: d.timezone,
    },
  });
  revalidatePath("/portal/settings/branding");
  revalidatePath("/portal", "layout");
  return ok();
}
