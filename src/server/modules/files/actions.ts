"use server";

import { revalidatePath } from "next/cache";
import { nanoid } from "nanoid";
import type { FileKind, Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { listScope } from "@/server/rbac/policies";
import { leadAccessible, projectAccessible } from "@/server/rbac/lead-access";
import type { AccessUser } from "@/server/rbac/guards";
import { putObject } from "@/server/storage";
import { getMembership } from "@/server/modules/chat/queries";
import { companyExportLabel } from "@/lib/company-exports";
import { isContractorInvoice } from "@/lib/contractor-invoice";
import { foldersFor } from "@/lib/deal-folders";
import { CONTRACT_FOLDER_KEY, CONTRACT_MIME_TYPE, SIGNED_LENDER_CONTRACT } from "@/lib/contract-signed";
import { advanceToContractSignedIfReady } from "@/server/modules/pipeline/contract-signed";
import { photoGroupFor } from "@/lib/photo-groups";
import { checklistJustCompleted } from "@/server/modules/automations/checklist";
import { runAutomations } from "@/server/modules/automations/engine";
import { getActiveVertical } from "@/server/auth/vertical";
import { isActiveVertical } from "@/lib/vertical";
import sharp from "sharp";

const MAX_BYTES = 30 * 1024 * 1024; // 30MB (phone photos); compressed after upload

/**
 * A file attached to a deal is authorised BY that deal.
 *
 * The download route already works this way (see app/portal/files/[id]/route.ts);
 * moving and deleting were the two doors that did not, so a rep with File perms
 * could re-file or destroy a photo on somebody else's job by id alone.
 *
 * A file hanging off neither a lead nor a project — a chat attachment, an
 * onboarding document, a company asset — has no deal to ask about, and the
 * uploader/admin rules at each call site stay its boundary.
 */
async function fileParentAccessible(
  user: AccessUser,
  file: { leadId: string | null; projectId: string | null }
): Promise<boolean> {
  if (file.leadId) return !!(await leadAccessible(user, file.leadId));
  if (file.projectId) return !!(await projectAccessible(user, file.projectId));
  return true;
}

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

/**
 * The extension for the bytes we are about to store — keyed off the mime type
 * we actually wrote, not the one the phone sent. `compressImage` turns a PNG
 * into a JPEG, so trusting the original name would produce a "…png" holding
 * JPEG bytes. Falls back to whatever the original name ended in.
 */
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "application/pdf": "pdf",
};

function extensionFor(mimeType: string, originalName: string): string {
  return EXT_BY_MIME[mimeType] ?? /\.([a-z0-9]{1,5})$/i.exec(originalName)?.[1].toLowerCase() ?? "jpg";
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
  const photoTemplateItemId = (formData.get("photoTemplateItemId") as string) || null;
  // Both are rewritten below for a checklist photo — the slot decides where it
  // is filed and what it is called. See "A checklist photo is not a loose
  // upload" further down.
  let category = (formData.get("category") as string) || null;

  if (!(file instanceof File)) return { ok: false as const, error: "No file provided." };
  let name = file.name;

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

  /* ── A company report is not job paperwork ─────────────────────────────
   * A file filed on a deal is authorised by DEAL scope and nothing else — the
   * file route never consults the Report permission — so a payroll or P&L
   * export dropped here becomes readable by everyone who can open the job.
   * That is how a year-to-date Payroll report, holding every person's pay,
   * came to sit in one customer's "Other" folder: it was exported minutes
   * earlier and was the top entry in the Downloads folder when the file picker
   * opened. Refused by NAME — see company-exports.ts for why that is both
   * enough and deliberately defeatable.
   *
   * No admin exemption. The upload that prompted this was made by the owner.
   */
  const exportLabel = (leadId || projectId) && companyExportLabel(file.name);
  if (exportLabel) {
    return {
      ok: false as const,
      error: `That looks like the ${exportLabel} exported from Reports, not paperwork for this job. Company reports hold other people's information and anyone who can open this deal could read it here, so they can't be filed on a job.`,
    };
  }

  // Scope check: the target project/lead must be visible to this user. The rows
  // are kept rather than discarded — a checklist photo needs the deal's vertical
  // to know which folder it belongs in.
  let project: { leadId: string; vertical: string } | null = null;
  if (projectId) {
    const scope = listScope(user, "Project") as Prisma.ProjectWhereInput;
    project = await prisma.project.findFirst({
      where: { AND: [{ id: projectId }, scope] },
      select: { leadId: true, vertical: true },
    });
    if (!project) return { ok: false as const, error: "Project not found or access denied." };
  }
  let lead: { vertical: string } | null = null;
  if (leadId) {
    const scope = listScope(user, "Lead") as Prisma.LeadWhereInput;
    lead = await prisma.lead.findFirst({
      where: { AND: [{ id: leadId }, scope] },
      select: { vertical: true },
    });
    if (!lead) return { ok: false as const, error: "Lead not found or access denied." };
  }

  const kind: FileKind = file.type.startsWith("image/") ? "photo" : "document";
  const raw = Buffer.from(await file.arrayBuffer());
  const { buffer, mimeType } = kind === "photo" ? await compressImage(raw, file.type) : { buffer: raw, mimeType: file.type };

  /* ── A checklist photo is not a loose upload ────────────────────────────
   * It was taken for one slot on the Site Survey or Installation checklist, so
   * the slot — not the phone, and not the caller — settles two things about
   * it. Both are decided here so that every way of taking one (the checklist on
   * the deal, the same checklist opened inside its folder, the presentation
   * builder) files the photo identically. Which DEAL it lands on used to be
   * settled here too; that now applies to every upload, just above.
   *
   *  WHICH FOLDER.  Callers used to send `category = the slot's label`, which is
   *    not a folder key in either vertical. So every photo ever shot against a
   *    checklist landed in "Other", and the Survey Photos and Installation
   *    Photos folders both read 0 while the checklist beside them was full.
   *
   *  ITS NAME.  "IMG_4821.jpg" says nothing about what was photographed. The
   *    slot's label does, and it is what the deal's photo report prints as the
   *    caption and what anyone opening the file sees.
   */
  /* A file uploaded against the JOB belongs to the job's DEAL.
   *
   * The folder grid lists the deal's files, so a file carrying only a
   * `projectId` was in no folder at all — not even "Other". That was already
   * known and already fixed, but only inside the checklist branch below; every
   * other project-only uploader still produced an invisible file. Hoisting it
   * here fixes them all, and is what lets the installer's job page — which
   * never learns the leadId, because an installer may not read the deal — put
   * an invoice where the office can find it. Safe for the same reason it was
   * safe there: the project's scope check above has already passed, and a
   * project belongs to exactly one lead.
   */
  const dealLeadId = leadId ?? project?.leadId ?? null;
  if (photoTemplateItemId) {
    const slot = await prisma.photoTemplateItem.findFirst({
      where: { id: photoTemplateItemId, template: { companyId: user.companyId } },
      select: { label: true, template: { select: { kind: true } } },
    });
    if (slot) {
      category = photoGroupFor(
        lead?.vertical ?? project?.vertical,
        slot.template.kind as "site" | "install",
      );
      // A slot can hold several shots ("each slope"), and they cannot all be
      // called the same thing. Counting first means the second is "(2)" — the
      // uploader posts one file per call, in order, so the count is stable.
      const already = await prisma.fileAsset.count({
        where: {
          companyId: user.companyId,
          photoTemplateItemId,
          ...(projectId ? { projectId } : dealLeadId ? { leadId: dealLeadId } : {}),
        },
      });
      const suffix = already > 0 ? ` (${already + 1})` : "";
      name = `${slot.label}${suffix}.${extensionFor(mimeType, file.name)}`;
    }
  }

  const id = nanoid();
  const key = `companies/${user.companyId}/uploads/${id}-${safeName(name)}`;
  await putObject(key, buffer);

  // One recording per call slot: replace any existing file in this slot.
  if (isCall && leadId) {
    await prisma.fileAsset.deleteMany({ where: { companyId: user.companyId, leadId, category } });
  }

  await prisma.fileAsset.create({
    data: {
      companyId: user.companyId,
      kind,
      name,
      storageKey: key,
      mimeType,
      size: buffer.length,
      category,
      leadId: dealLeadId,
      projectId,
      photoTemplateItemId,
      uploadedById: user.userId,
    },
  });

  // Uploading into Contract is NOT evidence of a contract. A file counts only
  // once somebody allowed to edit files marks it as the lender's signed
  // contract, and that is where the deal is re-evaluated — see
  // setSignedLenderContractAction and server/modules/pipeline/contract-signed.ts.

  // The shot that closes the last required slot is the one people want work
  // hung off — "photos are all in, compile them and move the job on". Asked
  // per upload rather than on a schedule so it happens while the crew is still
  // standing on the roof.
  if (photoTemplateItemId && dealLeadId) {
    const kind = await checklistJustCompleted(user.companyId, dealLeadId, photoTemplateItemId);
    if (kind) {
      // The DEAL's workspace, not the uploader's active one: an installer may
      // be posting to a job in a workspace they are not currently looking at,
      // and the rule that fires must be that job's.
      const dealVertical = lead?.vertical ?? project?.vertical;
      await runAutomations({
        companyId: user.companyId,
        vertical: isActiveVertical(dealVertical) ? dealVertical : await getActiveVertical(user),
        trigger: "photo_checklist_completed",
        leadId: dealLeadId,
        payload: { kind },
        depth: 0,
      });
    }
  }

  if (projectId) revalidatePath(`/portal/projects/${projectId}`);
  if (dealLeadId) revalidatePath(`/portal/leads/${dealLeadId}`);
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
  if (!can(user, "update", "File") && !can(user, "create", "File")) {
    return { ok: false as const, error: "Not allowed." };
  }
  const file = await prisma.fileAsset.findFirst({
    where: { id, companyId: user.companyId },
    select: {
      id: true,
      uploadedById: true,
      category: true,
      projectId: true,
      leadId: true,
      lead: { select: { vertical: true } },
    },
  });
  if (!file) return { ok: false as const, error: "File not found." };
  // Same sentence as a missing file: whether it exists on another rep's deal
  // is not something an id-guesser should learn.
  if (!(await fileParentAccessible(user, file))) return { ok: false as const, error: "File not found." };
  if (!can(user, "update", "File") && file.uploadedById !== user.userId) {
    return { ok: false as const, error: "You can only move your own uploads." };
  }

  /* Neither into the letter slot, nor out of it.
   *
   * OUT is the one that matters: refiling an invoice into "Other" would strip
   * the category the file route reads, and the bill would become readable by
   * everyone who can open the deal — the drop box undone by a dropdown. IN is
   * refused for the mirror reason: it would hide an ordinary document from the
   * people working the job, in a folder they cannot open to get it back.
   *
   * Checked against the FILE'S category rather than the current folder, because
   * that is the only thing the route consults. See src/lib/contractor-invoice.ts.
   */
  if (isContractorInvoice(file.category) || isContractorInvoice(category)) {
    return {
      ok: false as const,
      error: "Contractor invoices stay in the Contractor Invoice folder — they're read in Contractor Pay.",
    };
  }

  // The target must be a real folder for THIS deal's vertical — otherwise an
  // arbitrary category string could be written straight into the column.
  if (!foldersFor(file.lead?.vertical).some((f) => f.key === category)) {
    return { ok: false as const, error: "Unknown folder." };
  }

  await prisma.fileAsset.update({ where: { id }, data: { category } });
  // A PDF already MARKED as the lender's signed contract counts again once it is
  // refiled into Contract; anything else refiled there is re-read and ignored.
  if (file.leadId && file.lead?.vertical === "solar" && category === CONTRACT_FOLDER_KEY) {
    await advanceToContractSignedIfReady({ companyId: user.companyId, leadId: file.leadId, via: "document" });
  }
  if (file.projectId) revalidatePath(`/portal/projects/${file.projectId}`);
  if (file.leadId) revalidatePath(`/portal/leads/${file.leadId}`);
  return { ok: true as const };
}

/**
 * Mark a PDF in a solar deal's Contract folder as the LENDER'S SIGNED CONTRACT,
 * or take the mark off.
 *
 * The one way an uploaded file becomes evidence for Contract Signed. Being
 * filed into Contract proves nothing (a utility bill can be filed there), so a
 * person says what the document is, and the mark records who and when.
 *
 * WHO: `File:update` — super admin, admin and manager. A sales rep holds only
 * `File:create`/`read`, so the rep whose deal it is cannot certify the paperwork
 * that moves it — the same line the funding gate draws for M1.
 *
 * Marking re-evaluates the deal, so it advances the moment the second document
 * is real. Unmarking never moves a deal back, exactly as deleting a contract
 * does not: Contract Signed records that the sale happened.
 */
export async function setSignedLenderContractAction(input: { fileId: string; signed: boolean }) {
  const user = await requireUser();
  if (!can(user, "update", "File")) {
    return { ok: false as const, error: "Only an administrator or manager can mark the signed contract." };
  }
  const fileId = typeof input?.fileId === "string" ? input.fileId : "";
  if (!fileId || typeof input?.signed !== "boolean") {
    return { ok: false as const, error: "Invalid input." };
  }
  const file = await prisma.fileAsset.findFirst({
    where: { id: fileId, companyId: user.companyId },
    select: {
      id: true,
      uploadedById: true,
      category: true,
      mimeType: true,
      projectId: true,
      leadId: true,
      lead: { select: { vertical: true } },
    },
  });
  if (!file) return { ok: false as const, error: "File not found." };
  // Same sentence as a missing file, as moveFileAction does.
  if (!(await fileParentAccessible(user, file))) return { ok: false as const, error: "File not found." };
  if (!file.leadId || file.lead?.vertical !== "solar") {
    return { ok: false as const, error: "Only a document on a solar deal can be marked as the signed contract." };
  }
  if (input.signed) {
    if (file.category !== CONTRACT_FOLDER_KEY) {
      return { ok: false as const, error: "File it into the Contract folder first." };
    }
    if (file.mimeType !== CONTRACT_MIME_TYPE) {
      return { ok: false as const, error: "Only a PDF can be marked as the signed contract." };
    }
  }

  await prisma.fileAsset.update({
    where: { id: file.id },
    data: {
      documentType: input.signed ? SIGNED_LENDER_CONTRACT : null,
      documentTypeSetById: user.userId,
      documentTypeSetAt: new Date(),
    },
  });
  if (input.signed) {
    await advanceToContractSignedIfReady({ companyId: user.companyId, leadId: file.leadId, via: "document" });
  }
  revalidatePath(`/portal/leads/${file.leadId}`);
  return { ok: true as const };
}

export async function deleteFileAction(id: string) {
  const user = await requireUser();
  if (!can(user, "update", "File") && !can(user, "create", "File")) {
    return { ok: false as const, error: "Not allowed." };
  }
  const file = await prisma.fileAsset.findFirst({
    where: { id, companyId: user.companyId },
    select: { id: true, uploadedById: true, category: true, projectId: true, leadId: true },
  });
  if (!file) return { ok: false as const, error: "File not found." };
  // Same sentence as a missing file: whether it exists on another rep's deal
  // is not something an id-guesser should learn.
  if (!(await fileParentAccessible(user, file))) return { ok: false as const, error: "File not found." };

  /* A submitted invoice is the contractor's evidence that he billed, so it
   * outranks the "your own uploads" rule that would otherwise let him take it
   * back — and outranks File:update, which every manager and admin holds. Only
   * ContractorInvoice:delete removes one, which is super_admin alone.
   */
  if (isContractorInvoice(file.category)) {
    if (!can(user, "delete", "ContractorInvoice")) {
      return { ok: false as const, error: "A submitted contractor invoice can only be removed by a super admin." };
    }
  } else if (!can(user, "update", "File") && file.uploadedById !== user.userId) {
    // Non-managers may only delete their own uploads.
    return { ok: false as const, error: "You can only delete your own uploads." };
  }
  await prisma.fileAsset.delete({ where: { id } });
  if (file.projectId) revalidatePath(`/portal/projects/${file.projectId}`);
  if (file.leadId) revalidatePath(`/portal/leads/${file.leadId}`);
  return { ok: true as const };
}
