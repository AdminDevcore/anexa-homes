"use server";

import { revalidatePath } from "next/cache";
import { nanoid } from "nanoid";
import type { Role, KnowledgeItemType } from "@prisma/client";
import sharp from "sharp";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { getActiveVertical } from "@/server/auth/vertical";
import { stampVertical } from "@/server/vertical/visibility";
import { putObject } from "@/server/storage";
import { TRAINING_AUDIENCE_ROLES } from "./policies";

type Result = { ok: true } | { ok: false; error: string };

const MAX_BYTES = 30 * 1024 * 1024; // 30MB — documents & images
const MAX_VIDEO_BYTES = 250 * 1024 * 1024; // 250MB — uploaded training videos

// Validate uploads by file EXTENSION, not the browser-reported MIME type:
// Office files (.pptx/.docx/.xlsx) and some videos frequently arrive with an
// empty or "application/octet-stream" MIME, which a strict MIME allowlist would
// wrongly reject. Extension → canonical MIME so the serve route streams it right.
const EXT_MIME: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  csv: "text/csv",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  // Video
  mp4: "video/mp4",
  m4v: "video/x-m4v",
  mov: "video/quicktime",
  webm: "video/webm",
  ogv: "video/ogg",
  avi: "video/x-msvideo",
  mkv: "video/x-matroska",
};
const VIDEO_EXTS = new Set(["mp4", "m4v", "mov", "webm", "ogv", "avi", "mkv"]);

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

function isVideoFile(file: File): boolean {
  return VIDEO_EXTS.has(extOf(file.name)) || file.type.startsWith("video/");
}

/** Resolve the canonical MIME for a file, falling back to its extension. */
function resolveMime(file: File): string {
  if (file.type && file.type !== "application/octet-stream") return file.type;
  return EXT_MIME[extOf(file.name)] ?? "application/octet-stream";
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "file";
}

/**
 * Upload a training file to storage and return its FileAsset id.
 *
 * Knowledge files are the one parentless `workspace` case: they hang off a
 * category rather than a deal, so there is no parent to inherit isolation from
 * and the workspace has to be stamped on the row itself. Reads are still gated
 * by the category (see knowledgeFileForUser), so this is defence in depth rather
 * than the only check — training material is exactly the thing the user asked
 * never to cross between workspaces.
 */
async function storeUpload(file: File, companyId: string, uploadedById: string): Promise<string> {
  const raw = Buffer.from(await file.arrayBuffer());
  const { buffer, mimeType } = file.type.startsWith("image/")
    ? await compressImage(raw, file.type)
    : { buffer: raw, mimeType: resolveMime(file) };
  const fid = nanoid();
  const key = `companies/${companyId}/knowledge/${fid}-${safeName(file.name)}`;
  await putObject(key, buffer);
  const asset = await prisma.fileAsset.create({
    data: {
      companyId,
      kind: "document",
      name: file.name,
      storageKey: key,
      mimeType,
      size: buffer.length,
      uploadedById,
      scope: "workspace",
      vertical: await stampVertical(),
    },
    select: { id: true },
  });
  return asset.id;
}

/** Keep only roles that are valid visibility targets. */
function sanitizeRoles(roles: string[]): Role[] {
  return roles.filter((r): r is Role => (TRAINING_AUDIENCE_ROLES as string[]).includes(r));
}

async function compressImage(buffer: Buffer, mimeType: string) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
    return { buffer, mimeType };
  }
  try {
    const out = await sharp(buffer)
      .rotate()
      .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
    return { buffer: out, mimeType: "image/jpeg" };
  } catch {
    return { buffer, mimeType };
  }
}

// ── Categories ──────────────────────────────────────────────────────────────

export async function createCategoryAction(input: {
  name: string;
  description?: string;
  visibleRoles: string[];
}): Promise<Result> {
  const user = await requireUser();
  if (!can(user, "create", "Knowledge")) return { ok: false, error: "Not allowed." };

  const name = input.name?.trim();
  if (!name) return { ok: false, error: "Category name is required." };

  const vertical = await getActiveVertical(user);
  const count = await prisma.knowledgeCategory.count({
    where: { companyId: user.companyId, vertical },
  });

  await prisma.knowledgeCategory.create({
    data: {
      companyId: user.companyId,
      vertical,
      name,
      description: input.description?.trim() || null,
      visibleRoles: sanitizeRoles(input.visibleRoles ?? []),
      position: count,
    },
  });
  revalidatePath("/portal/knowledge");
  return { ok: true };
}

export async function updateCategoryAction(input: {
  id: string;
  name: string;
  description?: string;
  visibleRoles: string[];
}): Promise<Result> {
  const user = await requireUser();
  if (!can(user, "update", "Knowledge")) return { ok: false, error: "Not allowed." };

  const name = input.name?.trim();
  if (!name) return { ok: false, error: "Category name is required." };

  const existing = await prisma.knowledgeCategory.findFirst({
    where: { id: input.id, companyId: user.companyId },
    select: { id: true },
  });
  if (!existing) return { ok: false, error: "Category not found." };

  await prisma.knowledgeCategory.update({
    where: { id: input.id },
    data: {
      name,
      description: input.description?.trim() || null,
      visibleRoles: sanitizeRoles(input.visibleRoles ?? []),
    },
  });
  revalidatePath("/portal/knowledge");
  return { ok: true };
}

export async function deleteCategoryAction(id: string): Promise<Result> {
  const user = await requireUser();
  if (!can(user, "delete", "Knowledge")) return { ok: false, error: "Not allowed." };

  const existing = await prisma.knowledgeCategory.findFirst({
    where: { id, companyId: user.companyId },
    select: { id: true },
  });
  if (!existing) return { ok: false, error: "Category not found." };

  await prisma.knowledgeCategory.delete({ where: { id } });
  revalidatePath("/portal/knowledge");
  return { ok: true };
}

// ── Items ─────────────────────────────────────────────────────────────────

/**
 * Create a training item. Accepts FormData because `type=file` carries an upload.
 * Fields: categoryId, type, title, description?, url?, body?, file?
 */
export async function createItemAction(formData: FormData): Promise<Result> {
  const user = await requireUser();
  if (!can(user, "create", "Knowledge")) return { ok: false, error: "Not allowed." };

  const categoryId = String(formData.get("categoryId") ?? "");
  const type = String(formData.get("type") ?? "") as KnowledgeItemType;
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const url = String(formData.get("url") ?? "").trim() || null;
  const body = String(formData.get("body") ?? "").trim() || null;

  if (!title) return { ok: false, error: "Title is required." };
  if (!["file", "video", "link", "article"].includes(type)) {
    return { ok: false, error: "Invalid item type." };
  }

  const category = await prisma.knowledgeCategory.findFirst({
    where: { id: categoryId, companyId: user.companyId },
    select: { id: true },
  });
  if (!category) return { ok: false, error: "Category not found." };

  let fileId: string | null = null;
  const upload = formData.get("file");
  const hasFile = upload instanceof File && upload.size > 0;

  // A "file" item must have a file; a "video" item may EITHER have a URL embed
  // (YouTube/Vimeo) OR an uploaded video file.
  if (type === "file" && !hasFile) {
    return { ok: false, error: "Please choose a file to upload." };
  }
  if (type === "video" && !hasFile && !url) {
    return { ok: false, error: "Add a video URL or upload a video file." };
  }
  if (type === "link" && !url) {
    return { ok: false, error: "A URL is required for this item." };
  }
  if (type === "article" && !body) {
    return { ok: false, error: "Article content can't be empty." };
  }

  if (hasFile && (type === "file" || type === "video")) {
    const file = upload as File;
    const video = isVideoFile(file);
    const ext = extOf(file.name);
    const allowed = video || ext in EXT_MIME;
    if (!allowed) {
      return { ok: false, error: "Unsupported file type." };
    }
    const limit = video ? MAX_VIDEO_BYTES : MAX_BYTES;
    if (file.size > limit) {
      return { ok: false, error: `File too large (max ${video ? "250MB" : "30MB"}).` };
    }
    fileId = await storeUpload(file, user.companyId, user.userId);
  }

  const count = await prisma.knowledgeItem.count({ where: { categoryId } });
  await prisma.knowledgeItem.create({
    data: {
      companyId: user.companyId,
      categoryId,
      type,
      title,
      description,
      url: type === "video" || type === "link" ? url : null,
      body: type === "article" ? body : null,
      fileId,
      position: count,
      createdById: user.userId,
    },
  });
  revalidatePath("/portal/knowledge");
  return { ok: true };
}

export async function updateItemAction(input: {
  id: string;
  title: string;
  description?: string;
  url?: string;
  body?: string;
}): Promise<Result> {
  const user = await requireUser();
  if (!can(user, "update", "Knowledge")) return { ok: false, error: "Not allowed." };

  const title = input.title?.trim();
  if (!title) return { ok: false, error: "Title is required." };

  // Constrain through the CATEGORY, which carries the vertical. KnowledgeItem
  // has a companyId but no vertical of its own, so `{ id, companyId }` alone
  // would let a roofing session edit a solar article by id — the isolation is
  // on the parent, so the lookup has to go through the parent.
  const vertical = await getActiveVertical(user);
  const item = await prisma.knowledgeItem.findFirst({
    where: {
      id: input.id,
      companyId: user.companyId,
      category: { is: { companyId: user.companyId, vertical } },
    },
    select: { id: true, type: true },
  });
  if (!item) return { ok: false, error: "Item not found." };

  await prisma.knowledgeItem.update({
    where: { id: input.id },
    data: {
      title,
      description: input.description?.trim() || null,
      url:
        item.type === "video" || item.type === "link"
          ? input.url?.trim() || null
          : undefined,
      body: item.type === "article" ? input.body?.trim() || null : undefined,
    },
  });
  revalidatePath("/portal/knowledge");
  return { ok: true };
}

export async function deleteItemAction(id: string): Promise<Result> {
  const user = await requireUser();
  if (!can(user, "delete", "Knowledge")) return { ok: false, error: "Not allowed." };

  // Same as updateItemAction: scope through the category, or a roofing session
  // could delete a solar article (and its file) by id.
  const vertical = await getActiveVertical(user);
  const item = await prisma.knowledgeItem.findFirst({
    where: {
      id,
      companyId: user.companyId,
      category: { is: { companyId: user.companyId, vertical } },
    },
    select: { id: true, fileId: true },
  });
  if (!item) return { ok: false, error: "Item not found." };

  await prisma.knowledgeItem.delete({ where: { id } });
  if (item.fileId) {
    await prisma.fileAsset.deleteMany({ where: { id: item.fileId, companyId: user.companyId } });
  }
  revalidatePath("/portal/knowledge");
  return { ok: true };
}
