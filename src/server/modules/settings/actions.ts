"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { nanoid } from "nanoid";
import sharp from "sharp";
import type { Vertical } from "@prisma/client";
import { getActiveVertical } from "@/server/auth/vertical";
import { DEFAULT_VERTICAL } from "@/lib/vertical";
import { writeVerticalOverrides, brandingLogoCategory } from "@/lib/vertical-settings";
import { claimStatusKey, type ClaimStatusOption } from "@/lib/claim-status";
import { prisma } from "@/server/db/client";

import { writeVerticalConfig } from "@/lib/vertical-config";
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
  // Owned vs blocked, and who owns / who we are waiting on.
  stageType: z.enum(["internally_owned", "externally_blocked"]).optional(),
  ownerRole: z.string().max(60).nullable().optional(),
  followUpDays: z.number().int().min(0).max(365).optional(),
  isActionRequired: z.boolean().optional(),
  defaultBlocker: z.enum(["us", "ahj", "utility", "customer", "lender"]).nullable().optional(),
});

function stageSlaData(d: z.infer<typeof stageSchema>) {
  const stageType = d.stageType ?? "internally_owned";
  const blocked = stageType === "externally_blocked";
  return {
    stageType,
    ownerRole: d.ownerRole ?? null,
    isActionRequired: d.isActionRequired ?? false,
    defaultBlocker: d.defaultBlocker ?? null,
    // The two timing models are mutually exclusive by construction, so a stage
    // can never end up with both a deadline and a chase cadence — that would
    // put our team on the hook for a utility's queue, which is exactly the
    // failure the split exists to prevent.
    targetDays: blocked ? 0 : (d.targetDays ?? 0),
    escalationDays: blocked ? 0 : (d.escalationDays ?? 0),
    followUpDays: blocked ? (d.followUpDays ?? 0) : 0,
    markOverdue: blocked ? false : (d.markOverdue ?? false),
    notificationRecipient: d.notificationRecipient ?? "none",
    sendInApp: d.sendInApp ?? true,
    sendEmail: d.sendEmail ?? false,
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
    select: {
      id: true, stageType: true, ownerRole: true, followUpDays: true,
      isActionRequired: true, defaultBlocker: true, targetDays: true,
      escalationDays: true, markOverdue: true,
    },
  });
  if (!stage) return fail("Stage not found.");

  // Fall back to what the stage already has for anything the caller omitted.
  // Without this, the existing stages manager — which knows nothing about
  // stage types or owner roles — would silently reset every solar stage to
  // "internally owned, no owner" the first time somebody renamed one.
  const merged = stageSlaData({
    ...parsed.data,
    stageType: parsed.data.stageType ?? stage.stageType,
    ownerRole: parsed.data.ownerRole ?? stage.ownerRole,
    followUpDays: parsed.data.followUpDays ?? stage.followUpDays,
    isActionRequired: parsed.data.isActionRequired ?? stage.isActionRequired,
    defaultBlocker: parsed.data.defaultBlocker ?? stage.defaultBlocker,
    targetDays: parsed.data.targetDays ?? stage.targetDays,
    escalationDays: parsed.data.escalationDays ?? stage.escalationDays,
    markOverdue: parsed.data.markOverdue ?? stage.markOverdue,
  });

  await prisma.pipelineStage.update({
    where: { id },
    data: {
      name: parsed.data.name,
      color: parsed.data.color,
      isWon: parsed.data.isWon ?? false,
      isLost: parsed.data.isLost ?? false,
      ...merged,
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
/**
 * Persist one vertical's slice of a namespaced CompanySettings JSON column.
 *
 * Reads the current column, replaces ONLY the active vertical's entry, and
 * writes the merged object back. This is what makes "editing Roofing config
 * cannot mutate Solar config" true at the persistence layer rather than only in
 * the UI.
 */
async function saveVerticalScopedSetting(
  companyId: string,
  vertical: Vertical,
  column: "appointmentDispositions" | "inspectionOutcomes" | "qcChecklistTemplate" | "claimStatuses",
  value: unknown
) {
  const current = await prisma.companySettings.findUnique({
    where: { companyId },
    select: { [column]: true } as Record<string, true>,
  });
  const merged = writeVerticalConfig(
    (current as Record<string, unknown> | null)?.[column],
    vertical,
    value
  );
  await prisma.companySettings.upsert({
    where: { companyId },
    create: { companyId, [column]: merged },
    update: { [column]: merged },
  });
}

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

  await saveVerticalScopedSetting(
    user.companyId,
    await getActiveVertical(user),
    "appointmentDispositions",
    items
  );
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

/**
 * Replace the company's customizable inspection outcomes (full list).
 *
 * Roofing only. Solar's visit ends at the appointment status — it has no site
 * survey outcome to record — so the hub hides the card and the page redirects.
 * This list is stored per vertical, so without the guard a solar session could
 * still POST a list into a slice nothing ever reads back.
 */
export async function updateInspectionOutcomesAction(input: z.infer<typeof labelListSchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const vertical = await getActiveVertical(user);
  if (vertical === "solar") return fail("Inspection outcomes are a Roofing setting.");
  const parsed = labelListSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid outcomes.");
  const items = cleanLabels(parsed.data.items);
  if (items.length === 0) return fail("Keep at least one outcome.");

  await saveVerticalScopedSetting(user.companyId, vertical, "inspectionOutcomes", items);
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

  await saveVerticalScopedSetting(
    user.companyId,
    await getActiveVertical(user),
    "qcChecklistTemplate",
    items
  );
  revalidatePath("/portal/settings/production-checklist");
  return ok();
}

// --------------------------- Claim statuses ---------------------------------

const claimStatusesSchema = z.object({
  items: z
    .array(
      z.object({
        /** Absent on a brand-new option; present (and frozen) on every existing one. */
        key: z.string().trim().max(60).optional(),
        label: z.string().trim().min(1).max(60),
      })
    )
    .max(40),
});

/**
 * Replace the company's customizable claim statuses (full list).
 *
 * Keys are assigned once and never re-derived: a rename must NOT change the key,
 * or every deal already sitting on that status would be orphaned and scope
 * gating (`isScopeReady`) would stop recognising it.
 */
export async function updateClaimStatusesAction(input: z.infer<typeof claimStatusesSchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const parsed = claimStatusesSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid statuses.");

  const seenKeys = new Set<string>();
  const seenLabels = new Set<string>();
  const items: ClaimStatusOption[] = [];
  for (const raw of parsed.data.items) {
    const label = raw.label.trim();
    if (!label || seenLabels.has(label.toLowerCase())) continue;
    // New option: slug its label, then disambiguate rather than collide with an
    // existing key — two statuses named "Approved (partial)" and "Approved —
    // partial" would otherwise slug to the same thing and silently merge.
    let key = raw.key?.trim() || claimStatusKey(label);
    if (seenKeys.has(key)) {
      let n = 2;
      while (seenKeys.has(`${key}_${n}`)) n++;
      key = `${key}_${n}`;
    }
    seenKeys.add(key);
    seenLabels.add(label.toLowerCase());
    items.push({ key, label });
  }
  if (items.length === 0) return fail("Keep at least one status.");

  await saveVerticalScopedSetting(
    user.companyId,
    await getActiveVertical(user),
    "claimStatuses",
    items
  );
  revalidatePath("/portal/settings/claim-statuses");
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
  brandName: z.string().max(120).optional().or(z.literal("")),
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

  // Currency and locale identify the BUSINESS, not the brand — always company
  // level, whichever workspace you are editing from.
  const shared = { currencyCode: d.currencyCode.toUpperCase(), locale: d.locale };

  // Everything else is per brand.
  const branded = {
    brandName: d.brandName?.trim() || "",
    logoUrl: d.logoUrl || null,
    faviconUrl: d.faviconUrl || null,
    primaryColor: d.primaryColor,
    accentColor: d.accentColor,
    fontFamily: d.fontFamily || null,
    recordPrefix: d.recordPrefix?.trim() || "",
    supportPhone: d.supportPhone || null,
    supportEmail: d.supportEmail || null,
    emailFromName: d.emailFromName || null,
    customDomain: d.customDomain?.trim().toLowerCase() || null,
    removePoweredBy: d.removePoweredBy ?? false,
  };

  const vertical = await getActiveVertical(user);

  // The DEFAULT vertical writes the base COLUMNS, exactly as before — so the
  // roofing edit path is unchanged and the stored row still holds the company
  // values that every other vertical inherits. A non-default vertical writes
  // only its deviations into verticalOverrides, so clearing a field there means
  // "inherit again" rather than "blank the brand".
  if (vertical === DEFAULT_VERTICAL) {
    const data = { ...shared, ...branded };
    // brandName is override-only; it has no column to write to.
    delete (data as { brandName?: string }).brandName;
    await prisma.companySettings.upsert({
      where: { companyId: user.companyId },
      update: data,
      create: { companyId: user.companyId, ...data },
    });
  } else {
    const current = await prisma.companySettings.findUnique({
      where: { companyId: user.companyId },
      select: { verticalOverrides: true },
    });
    const verticalOverrides = writeVerticalOverrides(
      current?.verticalOverrides,
      vertical,
      branded
    );
    await prisma.companySettings.upsert({
      where: { companyId: user.companyId },
      update: { ...shared, verticalOverrides },
      create: { companyId: user.companyId, ...shared, verticalOverrides },
    });
  }
  revalidatePath("/portal/settings/branding");
  revalidatePath("/portal", "layout");
  return ok();
}

/** Category tag for the company's branding logo FileAsset (one per company). */
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

  // One logo per BRAND, not per company: a solar logo is a solar asset, so it
  // gets its own category tag and replacing it must not delete Roofing's.
  const logoVertical = await getActiveVertical(user);
  const category = brandingLogoCategory(logoVertical);
  await prisma.fileAsset.deleteMany({
    where: { companyId: user.companyId, category },
  });
  await prisma.fileAsset.create({
    data: {
      companyId: user.companyId,
      kind: "photo",
      name: file.name,
      storageKey: key,
      mimeType: "image/png",
      size: png.length,
      // Branding is company-level: one logo, every workspace.
      scope: "company",
      category,
      uploadedById: user.userId,
    },
  });

  // Relative URL with a cache-busting version. Emails absolutize it via appUrl.
  // The vertical rides in the URL because the serving route is unauthenticated
  // (login page, email clients) and so has no session to infer it from.
  const isDefault = logoVertical === DEFAULT_VERTICAL;
  const logoUrl = isDefault
    ? `/api/branding/logo?company=${user.companyId}&v=${Date.now()}`
    : `/api/branding/logo?company=${user.companyId}&vertical=${logoVertical}&v=${Date.now()}`;

  if (isDefault) {
    // Unchanged path: the company column, exactly as before.
    await prisma.companySettings.upsert({
      where: { companyId: user.companyId },
      update: { logoUrl },
      create: { companyId: user.companyId, logoUrl },
    });
  } else {
    const current = await prisma.companySettings.findUnique({
      where: { companyId: user.companyId },
      select: { verticalOverrides: true },
    });
    const verticalOverrides = writeVerticalOverrides(current?.verticalOverrides, logoVertical, {
      logoUrl,
    });
    await prisma.companySettings.upsert({
      where: { companyId: user.companyId },
      update: { verticalOverrides },
      create: { companyId: user.companyId, verticalOverrides },
    });
  }

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

// --------------------------- Lead sources -----------------------------------

const sourceNameSchema = z.string().trim().min(1, "Enter a source name.").max(60, "Name is too long.");
const LEAD_SOURCES_PATH = "/portal/settings/lead-sources";

export async function createLeadSourceAction(name: string) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const parsed = sourceNameSchema.safeParse(name);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const clean = parsed.data;
  const dup = await prisma.leadSource.findFirst({
    where: { companyId: user.companyId, name: { equals: clean, mode: "insensitive" } },
    select: { id: true },
  });
  if (dup) return fail("That source already exists.");
  const last = await prisma.leadSource.findFirst({
    where: { companyId: user.companyId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  await prisma.leadSource.create({ data: { companyId: user.companyId, name: clean, position: (last?.position ?? -1) + 1 } });
  revalidatePath(LEAD_SOURCES_PATH);
  return ok();
}

export async function renameLeadSourceAction(id: string, name: string) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const parsed = sourceNameSchema.safeParse(name);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const clean = parsed.data;
  const src = await prisma.leadSource.findFirst({ where: { id, companyId: user.companyId }, select: { id: true } });
  if (!src) return fail("Source not found.");
  const dup = await prisma.leadSource.findFirst({
    where: { companyId: user.companyId, name: { equals: clean, mode: "insensitive" }, id: { not: id } },
    select: { id: true },
  });
  if (dup) return fail("That source already exists.");
  await prisma.leadSource.update({ where: { id }, data: { name: clean } });
  revalidatePath(LEAD_SOURCES_PATH);
  return ok();
}

export async function setLeadSourceActiveAction(id: string, active: boolean) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const src = await prisma.leadSource.findFirst({ where: { id, companyId: user.companyId }, select: { id: true } });
  if (!src) return fail("Source not found.");
  await prisma.leadSource.update({ where: { id }, data: { active } });
  revalidatePath(LEAD_SOURCES_PATH);
  return ok();
}

export async function moveLeadSourceAction(id: string, dir: "up" | "down") {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  // Reindex to clean 0..n-1 positions on every move so ties (legacy rows all at 0) sort reliably.
  const all = await prisma.leadSource.findMany({
    where: { companyId: user.companyId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  const idx = all.findIndex((s) => s.id === id);
  if (idx === -1) return fail("Source not found.");
  const target = dir === "up" ? idx - 1 : idx + 1;
  if (target < 0 || target >= all.length) return ok(); // already at the end
  const order = all.map((s) => s.id);
  [order[idx], order[target]] = [order[target], order[idx]];
  await prisma.$transaction(order.map((sid, i) => prisma.leadSource.update({ where: { id: sid }, data: { position: i } })));
  revalidatePath(LEAD_SOURCES_PATH);
  return ok();
}

export async function deleteLeadSourceAction(id: string) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const src = await prisma.leadSource.findFirst({
    where: { id, companyId: user.companyId },
    select: { id: true, _count: { select: { leads: true } } },
  });
  if (!src) return fail("Source not found.");
  if (src._count.leads > 0) return fail("This source is used by existing leads — deactivate it instead.");
  await prisma.leadSource.delete({ where: { id } });
  revalidatePath(LEAD_SOURCES_PATH);
  return ok();
}

/** Toggle the weekly "overdue jobs" digest to managers/admins (read by the overdue-digest cron). */
export async function setOverdueDigestAction(enabled: boolean) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  await prisma.companySettings.upsert({
    where: { companyId: user.companyId },
    update: { overdueDigestEnabled: enabled },
    create: { companyId: user.companyId, overdueDigestEnabled: enabled },
  });
  revalidatePath("/portal/settings/notifications");
  return ok();
}

/** Toggle emailing each signer a copy of the executed PDF on document completion. */
export async function setEmailSignedCopyToSignersAction(enabled: boolean) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  await prisma.companySettings.upsert({
    where: { companyId: user.companyId },
    update: { emailSignedCopyToSigners: enabled },
    create: { companyId: user.companyId, emailSignedCopyToSigners: enabled },
  });
  revalidatePath("/portal/settings/notifications");
  return ok();
}

const companyIdentitySchema = z.object({
  name: z.string().min(1).max(120),
  // Phone and email are on the CUSTOMER-FACING documents (a solar proposal
  // prints both, and refuses to generate without them), so they belong here
  // rather than with the portal's own support contacts in CompanySettings.
  phone: z.string().max(40).optional().or(z.literal("")),
  email: z.string().max(160).optional().or(z.literal("")),
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
  // Trimmed to null, never stored blank: readiness checks and document
  // templates ask "is this set?", and a stored " " answers yes while printing
  // nothing. A seeded `phone: ""` is the same trap from the other end.
  const set = (v: string | undefined) => v?.trim() || null;
  await prisma.company.update({
    where: { id: user.companyId },
    data: {
      name: d.name.trim(),
      phone: set(d.phone),
      email: set(d.email),
      address: set(d.address),
      city: set(d.city),
      state: set(d.state),
      zip: set(d.zip),
      timezone: d.timezone,
    },
  });
  revalidatePath("/portal/settings/branding");
  revalidatePath("/portal", "layout");
  return ok();
}
