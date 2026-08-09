"use server";

import { revalidatePath } from "next/cache";
import { nanoid } from "nanoid";
import type { FileKind, Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { listScope } from "@/server/rbac/policies";
import { putObject } from "@/server/storage";
import { getMembership } from "@/server/modules/chat/queries";
import { foldersFor } from "@/lib/deal-folders";
import sharp from "sharp";

const MAX_BYTES = 30 * 1024 * 1024; // 30MB (phone photos); compressed after upload
const CALL_MAX_BYTES = 100 * 1024 * 1024; // 100MB — call recordings (audio, uncompressed)

// Dedicated call-recording slots on a deal (QC Call). Kept in sync with
// src/lib/call-groups.ts.
const CALL_GROUPS = new Set(["qc_call"]);

// Audio formats accepted for call recordings. Browsers report m4a/aac
// inconsistently, so we accept the common spellings.
const AUDIO_ALLOWED = new Set([
  "audio/mpeg", // mp3
  "audio/mp4", // m4a (some browsers)
  "audio/x-m4a", // m4a (others)
  "audio/m4a",
  "audio/aac",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
  "audio/ogg",
]);

/**
 * Downscale + re-encode photos so stored files are small and fast to serve.
 * Returns the original buffer/type if the format can't be processed (e.g. HEIC
 * without libheif, or non-images).
 */
async function compressImage(
  buffer: Buffer,
  mimeType: string
): Promise<{ buffer: Buffer; mimeType: string }> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
    return { buffer, mimeType };
  }
  try {
    const out = await sharp(buffer)
      .rotate() // respect EXIF orientation
      .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    return { buffer: out, mimeType: "image/jpeg" };
  } catch {
    return { buffer, mimeType };
  }
}
const ALLOWED = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "application/pdf",
]);

// Chat allows photos + PDFs + common docs (docs render as download cards).
const CHAT_ALLOWED = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif", "image/heic",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/plain",
]);

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "file";
}

export type ChatAttachment = { id: string; name: string; kind: "photo" | "document"; mimeType: string; size: number };

/** Upload a single chat attachment (pre-send). Returns metadata to preview + link on send. */
export async function uploadChatAttachmentAction(
  formData: FormData
): Promise<{ ok: true; attachment: ChatAttachment } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can(user, "create", "Chat")) return { ok: false, error: "You don't have access to chat." };

  const file = formData.get("file");
  const conversationId = (formData.get("conversationId") as string) || "";
  if (!(file instanceof File)) return { ok: false, error: "No file provided." };
  if (file.size > MAX_BYTES) return { ok: false, error: "File too large (max 30MB)." };
  if (!CHAT_ALLOWED.has(file.type)) return { ok: false, error: "Unsupported file type." };

  // Must be a member of the conversation to attach to it.
  const membership = await getMembership(user.userId, conversationId);
  if (!membership) return { ok: false, error: "You're not a member of this conversation." };

  const kind: FileKind = file.type.startsWith("image/") ? "photo" : "document";
  const raw = Buffer.from(await file.arrayBuffer());
  const { buffer, mimeType } = kind === "photo" ? await compressImage(raw, file.type) : { buffer: raw, mimeType: file.type };
  const id = nanoid();
  const key = `companies/${user.companyId}/chat/${id}-${safeName(file.name)}`;
  await putObject(key, buffer);

  const asset = await prisma.fileAsset.create({
    data: {
      companyId: user.companyId,
      kind,
      name: file.name,
      storageKey: key,
      mimeType,
      size: buffer.length,
      // Chat is a company module — one set of channels for the whole business —
      // so its attachments must be reachable from any workspace. Leaving these
      // on the `workspace` default would make a file shared in a channel
      // unopenable for a teammate standing in the other workspace.
      scope: "company",
      conversationId, // messageId linked when the message is sent
      uploadedById: user.userId,
    },
    select: { id: true, name: true, kind: true, mimeType: true, size: true },
  });

  return {
    ok: true,
    attachment: { id: asset.id, name: asset.name, kind: asset.kind as "photo" | "document", mimeType: asset.mimeType ?? file.type, size: asset.size },
  };
}

export async function uploadFileAction(formData: FormData) {
  const user = await requireUser();
  if (!can(user, "create", "File")) return { ok: false as const, error: "Not allowed." };

  const file = formData.get("file");
  const projectId = (formData.get("projectId") as string) || null;
  const leadId = (formData.get("leadId") as string) || null;
  const category = (formData.get("category") as string) || null;
  const photoTemplateItemId = (formData.get("photoTemplateItemId") as string) || null;

  if (!(file instanceof File)) return { ok: false as const, error: "No file provided." };

  // Call recordings get audio mime types + a higher size cap; everything else
  // keeps the image/PDF rules.
  const isCall = !!category && CALL_GROUPS.has(category);
  const maxBytes = isCall ? CALL_MAX_BYTES : MAX_BYTES;
  const allowed = isCall ? AUDIO_ALLOWED : ALLOWED;
  if (file.size > maxBytes) {
    return { ok: false as const, error: `File too large (max ${Math.round(maxBytes / 1024 / 1024)}MB).` };
  }
  if (!allowed.has(file.type)) {
    return { ok: false as const, error: isCall ? "Unsupported audio type." : "Unsupported file type." };
  }

  // Scope check: the target project/lead must be visible to this user.
  if (projectId) {
    const scope = listScope(user, "Project") as Prisma.ProjectWhereInput;
    const p = await prisma.project.findFirst({ where: { AND: [{ id: projectId }, scope] }, select: { id: true } });
    if (!p) return { ok: false as const, error: "Project not found or access denied." };
  }
  if (leadId) {
    const scope = listScope(user, "Lead") as Prisma.LeadWhereInput;
    const l = await prisma.lead.findFirst({ where: { AND: [{ id: leadId }, scope] }, select: { id: true } });
    if (!l) return { ok: false as const, error: "Lead not found or access denied." };
  }

  const kind: FileKind = file.type.startsWith("image/") ? "photo" : "document";
  const raw = Buffer.from(await file.arrayBuffer());
  const { buffer, mimeType } = kind === "photo" ? await compressImage(raw, file.type) : { buffer: raw, mimeType: file.type };
  const id = nanoid();
  const key = `companies/${user.companyId}/uploads/${id}-${safeName(file.name)}`;
  await putObject(key, buffer);

  // One recording per call slot: replace any existing file in this slot.
  if (isCall && leadId) {
    await prisma.fileAsset.deleteMany({ where: { companyId: user.companyId, leadId, category } });
  }

  await prisma.fileAsset.create({
    data: {
      companyId: user.companyId,
      kind,
      name: file.name,
      storageKey: key,
      mimeType,
      size: buffer.length,
      category,
      leadId,
      projectId,
      photoTemplateItemId,
      uploadedById: user.userId,
    },
  });

  if (projectId) revalidatePath(`/portal/projects/${projectId}`);
  if (leadId) revalidatePath(`/portal/leads/${leadId}`);
  return { ok: true as const };
}

/**
 * Refile a document into another deal folder.
 *
 * Every file uploaded before folders existed is uncategorised, so it lands in
 * "Other" — this is how it gets put away. Authorisation is deliberately
 * identical to deleteFileAction: moving a file is a smaller act than destroying
 * one, so anyone allowed to delete it is allowed to move it, and nobody else.
 */
export async function moveFileAction(id: string, category: string) {
  const user = await requireUser();
  if (user.role === "customer") {
    return { ok: false as const, error: "Customers can't move files." };
  }
  if (!can(user, "update", "File") && !can(user, "create", "File")) {
    return { ok: false as const, error: "Not allowed." };
  }
  const file = await prisma.fileAsset.findFirst({
    where: { id, companyId: user.companyId },
    select: {
      id: true,
      uploadedById: true,
      projectId: true,
      leadId: true,
      lead: { select: { vertical: true } },
    },
  });
  if (!file) return { ok: false as const, error: "File not found." };
  if (!can(user, "update", "File") && file.uploadedById !== user.userId) {
    return { ok: false as const, error: "You can only move your own uploads." };
  }

  // The target must be a real folder for THIS deal's vertical — otherwise an
  // arbitrary category string could be written straight into the column.
  if (!foldersFor(file.lead?.vertical).some((f) => f.key === category)) {
    return { ok: false as const, error: "Unknown folder." };
  }

  await prisma.fileAsset.update({ where: { id }, data: { category } });
  if (file.projectId) revalidatePath(`/portal/projects/${file.projectId}`);
  if (file.leadId) revalidatePath(`/portal/leads/${file.leadId}`);
  return { ok: true as const };
}

export async function deleteFileAction(id: string) {
  const user = await requireUser();
  // Customers may upload but never delete — signed contracts must stay immutable.
  if (user.role === "customer") {
    return { ok: false as const, error: "Customers can't delete files." };
  }
  if (!can(user, "update", "File") && !can(user, "create", "File")) {
    return { ok: false as const, error: "Not allowed." };
  }
  const file = await prisma.fileAsset.findFirst({
    where: { id, companyId: user.companyId },
    select: { id: true, uploadedById: true, projectId: true, leadId: true },
  });
  if (!file) return { ok: false as const, error: "File not found." };
  // Non-managers may only delete their own uploads.
  if (!can(user, "update", "File") && file.uploadedById !== user.userId) {
    return { ok: false as const, error: "You can only delete your own uploads." };
  }
  await prisma.fileAsset.delete({ where: { id } });
  if (file.projectId) revalidatePath(`/portal/projects/${file.projectId}`);
  if (file.leadId) revalidatePath(`/portal/leads/${file.leadId}`);
  return { ok: true as const };
}
