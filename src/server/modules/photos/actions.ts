"use server";

import { revalidatePath } from "next/cache";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { putObject } from "@/server/storage";
import { requireUser } from "@/server/auth/session";
import { getActiveVertical } from "@/server/auth/vertical";
import { can } from "@/server/rbac/guards";
import { defaultItems, defaultName } from "./defaults";

function fail(error: string) {
  return { ok: false as const, error };
}
function ok() {
  return { ok: true as const };
}

const kindSchema = z.enum(["site", "install"]);

/**
 * Find (or create) this workspace's checklist of a given kind.
 *
 * PhotoTemplate is vertical-isolated, so "the site checklist" means a different
 * row in Roofing than it does in Solar, and a workspace that has never had one
 * simply has no row — which is exactly why the Settings page used to render
 * blank in Solar. Every write path goes through here so the row is created on
 * first use instead of having to be seeded ahead of time. The Prisma extension
 * stamps `vertical` from the active workspace on create.
 *
 * One row per kind per workspace is deliberate: the deal's Survey and Install
 * folders each pick their checklist with `find(c => c.kind === ...)`, so a
 * second template of the same kind would be silently unreachable.
 */
async function ensureTemplate(companyId: string, kind: "site" | "install", name: string) {
  const existing = await prisma.photoTemplate.findFirst({
    where: { companyId, kind },
    orderBy: { position: "asc" },
    select: { id: true },
  });
  if (existing) return existing;
  return prisma.photoTemplate.create({
    data: { companyId, name, kind, position: 0 },
    select: { id: true },
  });
}

/** Create this workspace's checklist of `kind` if it does not exist yet. */
export async function ensurePhotoTemplateAction(input: { kind: "site" | "install" }) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Only admins can edit photo templates.");
  const parsed = kindSchema.safeParse(input?.kind);
  if (!parsed.success) return fail("Unknown checklist type.");

  const vertical = await getActiveVertical(user);
  await ensureTemplate(user.companyId, parsed.data, defaultName(vertical, parsed.data));
  revalidatePath("/portal/settings/photo-templates");
  return ok();
}

/**
 * Fill a checklist with the standard slots for this workspace's trade.
 *
 * Additive on purpose: it appends only the labels that are not already there,
 * so pressing it on a half-built list tops it up rather than wiping the admin's
 * own slots.
 */
export async function seedPhotoTemplateAction(input: { kind: "site" | "install" }) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Only admins can edit photo templates.");
  const parsed = kindSchema.safeParse(input?.kind);
  if (!parsed.success) return fail("Unknown checklist type.");
  const kind = parsed.data;

  const vertical = await getActiveVertical(user);
  const template = await ensureTemplate(user.companyId, kind, defaultName(vertical, kind));

  const existing = await prisma.photoTemplateItem.findMany({
    where: { templateId: template.id },
    select: { label: true, position: true },
  });
  const have = new Set(existing.map((i) => i.label.trim().toLowerCase()));
  let position = existing.reduce((max, i) => Math.max(max, i.position), -1);

  const toAdd = defaultItems(vertical, kind)
    .filter((d) => !have.has(d.label.trim().toLowerCase()))
    .map((d) => ({ templateId: template.id, label: d.label, required: d.required, position: ++position }));

  if (toAdd.length === 0) return fail("Every standard photo is already on this checklist.");
  await prisma.photoTemplateItem.createMany({ data: toAdd });
  revalidatePath("/portal/settings/photo-templates");
  return ok();
}

const renameSchema = z.object({ id: z.string().min(1), name: z.string().min(1, "Name is required").max(120) });

export async function renamePhotoTemplateAction(input: z.infer<typeof renameSchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Only admins can edit photo templates.");
  const parsed = renameSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid name.");

  const template = await prisma.photoTemplate.findFirst({
    where: { id: parsed.data.id, companyId: user.companyId },
    select: { id: true },
  });
  if (!template) return fail("Checklist not found.");

  await prisma.photoTemplate.update({
    where: { id: template.id },
    data: { name: parsed.data.name.trim() },
  });
  revalidatePath("/portal/settings/photo-templates");
  return ok();
}

/**
 * Delete a whole checklist. Its slots cascade; photos already taken against
 * those slots survive (FileAsset.photoTemplateItemId is ON DELETE SET NULL) and
 * stay on the job under their folder — they just stop being checklist items.
 */
export async function deletePhotoTemplateAction(id: string) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Only admins can edit photo templates.");
  const template = await prisma.photoTemplate.findFirst({
    where: { id, companyId: user.companyId },
    select: { id: true },
  });
  if (!template) return fail("Checklist not found.");
  await prisma.photoTemplate.delete({ where: { id: template.id } });
  revalidatePath("/portal/settings/photo-templates");
  return ok();
}

const addSchema = z
  .object({
    templateId: z.string().min(1).optional(),
    /** Used instead of `templateId` when this workspace has no such checklist yet. */
    kind: kindSchema.optional(),
    label: z.string().min(1, "Label is required").max(120),
    required: z.boolean().optional().default(false),
  })
  .refine((v) => !!v.templateId || !!v.kind, { message: "Missing checklist." });

export async function addPhotoTemplateItemAction(input: z.infer<typeof addSchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Only admins can edit photo templates.");
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid item.");

  let template: { id: string } | null = null;
  if (parsed.data.templateId) {
    template = await prisma.photoTemplate.findFirst({
      where: { id: parsed.data.templateId, companyId: user.companyId },
      select: { id: true },
    });
  } else if (parsed.data.kind) {
    const vertical = await getActiveVertical(user);
    template = await ensureTemplate(user.companyId, parsed.data.kind, defaultName(vertical, parsed.data.kind));
  }
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

/* ── Example photos ──────────────────────────────────────────────────────
 * The reference shot beside a slot: "this is what this photo looks like when
 * it is right". Uploaded once by an admin in Settings, read by every rep and
 * crew on every job.
 *
 * The bytes go through the storage driver and the id lands on the slot itself,
 * not in `files` — see the schema note on PhotoTemplateItem.exampleKey. That is
 * also what keeps an example out of the job's actual photos: it is not a
 * FileAsset, so nothing that lists a deal's photos, counts them or compiles
 * them into the PDF report can pick it up.
 */

/** A phone photo, downscaled. Examples are looked at, never printed at size. */
const EXAMPLE_MAX_BYTES = 30 * 1024 * 1024;
const EXAMPLE_ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);

/** The slot, scoped to the caller's company. Null means "not yours". */
async function ownedItem(companyId: string, id: string) {
  return prisma.photoTemplateItem.findFirst({
    where: { id, template: { companyId } },
    select: { id: true, label: true, exampleKey: true },
  });
}

export async function uploadPhotoExampleAction(
  itemId: string,
  formData: FormData
): Promise<{ ok: true; exampleUpdatedAt: number } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Only admins can set example photos.");

  const item = await ownedItem(user.companyId, itemId);
  if (!item) return fail("Photo slot not found.");

  const file = formData.get("file");
  if (!(file instanceof File)) return fail("No file provided.");
  if (file.size > EXAMPLE_MAX_BYTES) return fail("Photo too large (max 30MB).");
  if (!EXAMPLE_ALLOWED.has(file.type)) return fail("Use a JPG, PNG or WebP image.");

  // 1600px is plenty for "hold this next to what you are looking at" on a phone
  // and keeps the image small enough to open on site over LTE. `fit: "inside"`
  // never crops — an example cropped to a square can lose the very thing it was
  // uploaded to show.
  let jpeg: Buffer;
  try {
    jpeg = await sharp(Buffer.from(await file.arrayBuffer()))
      .rotate() // respect EXIF orientation
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
  } catch {
    return fail("Could not read that image.");
  }

  const key = `companies/${user.companyId}/photo-examples/${nanoid()}.jpg`;
  await putObject(key, jpeg);
  await prisma.photoTemplateItem.update({
    where: { id: item.id },
    data: { exampleKey: key, exampleUpdatedAt: new Date() },
  });

  revalidatePath("/portal/settings/photo-templates");
  return { ok: true, exampleUpdatedAt: Date.now() };
}

/** Forget the example. The slot keeps working; it just loses its reference shot. */
export async function removePhotoExampleAction(itemId: string) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Only admins can set example photos.");

  const item = await ownedItem(user.companyId, itemId);
  if (!item) return fail("Photo slot not found.");

  // The object is left in storage rather than deleted: an admin who removes the
  // wrong one loses a click, not a file, and nothing else points at the key.
  await prisma.photoTemplateItem.update({
    where: { id: item.id },
    data: { exampleKey: null, exampleUpdatedAt: null },
  });
  revalidatePath("/portal/settings/photo-templates");
  return ok();
}
