"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import sharp from "sharp";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import {
  uniqueCredentialKey,
  SIGNATURE_MAX_BYTES,
  SIGNATURE_MAX_HEIGHT,
  SIGNATURE_MAX_WIDTH,
} from "@/lib/company-signer";

/**
 * Settings → Authorised signers.
 *
 * Its own file rather than another thousand lines in settings/actions.ts: this
 * is the one settings screen whose rows end up inside a legally binding
 * document, and the rules that protect that — one default, a normalised mark,
 * retire rather than delete — deserve to be readable in one place.
 */

function fail(error: string) {
  return { ok: false as const, error };
}

const credentialSchema = z.object({
  /**
   * The line's existing key, echoed back by the editor. Absent or empty on a
   * line just added.
   *
   * Sent BY the client and honoured only when this signer already owns it —
   * see the rename note in saveCompanySignerAction. Without it there is nothing
   * to identify a line across a rename, because the label is the only other
   * thing about it and the label is precisely what changed.
   */
  key: z.string().max(40).optional(),
  label: z.string().min(1).max(60),
  value: z.string().max(120),
});

const signerSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(120),
  title: z.string().max(80).optional().or(z.literal("")),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().max(30).optional().or(z.literal("")),
  licenseNumber: z.string().max(80).optional().or(z.literal("")),
  credentials: z.array(credentialSchema).max(12).default([]),
  isDefault: z.boolean().default(false),
  active: z.boolean().default(true),
});

export type SignerInput = z.input<typeof signerSchema>;

/**
 * Create or update one signer.
 *
 * The default is settled inside the transaction that writes the row, not by a
 * partial index: "make this one the default" is one intent, and doing it in two
 * statements leaves a window where a company has two defaults or none — and the
 * thing that reads it is a contract send.
 */
export async function saveCompanySignerAction(raw: SignerInput) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");

  const parsed = signerSchema.safeParse(raw);
  if (!parsed.success) return fail("Check the signer's details — a name is required.");
  const d = parsed.data;

  // Keys are assigned once and never recomputed, so renaming a label leaves
  // every template mapping its token pointing at the same line. See
  // SignerCredential.key.
  const existing = d.id
    ? await prisma.companySigner.findFirst({
        where: { id: d.id, companyId: user.companyId },
        select: { credentials: true },
      })
    : null;
  if (d.id && !existing) return fail("Signer not found.");

  /**
   * The keys this signer already owns.
   *
   * A submitted key is honoured only if it is in here. Matching on the LABEL
   * instead would defeat the whole mechanism — a renamed line would not match,
   * a fresh key would be minted, and the template mapping the old token would
   * quietly print nothing. Checking membership also means a client cannot
   * invent a key, or claim one belonging to another signer.
   */
  const ownedKeys = new Set<string>();
  for (const c of Array.isArray(existing?.credentials) ? existing!.credentials : []) {
    if (c && typeof c === "object") {
      const r = c as Record<string, unknown>;
      if (typeof r.key === "string" && r.key) ownedKeys.add(r.key);
    }
  }
  const taken = new Set<string>();
  const credentials = d.credentials.map((c) => {
    const key =
      c.key && ownedKeys.has(c.key) && !taken.has(c.key)
        ? c.key
        : uniqueCredentialKey(c.label, taken);
    taken.add(key);
    return { key, label: c.label, value: c.value };
  });

  const data = {
    name: d.name.trim(),
    title: d.title?.trim() || null,
    email: d.email?.trim() || null,
    phone: d.phone?.trim() || null,
    licenseNumber: d.licenseNumber?.trim() || null,
    credentials,
    isDefault: d.isDefault,
    active: d.active,
  };

  const id = await prisma.$transaction(async (tx) => {
    const row = d.id
      ? await tx.companySigner.update({ where: { id: d.id }, data })
      : await tx.companySigner.create({ data: { ...data, companyId: user.companyId } });

    if (data.isDefault) {
      await tx.companySigner.updateMany({
        where: { companyId: user.companyId, id: { not: row.id }, isDefault: true },
        data: { isDefault: false },
      });
    }
    return row.id;
  });

  revalidatePath("/portal/settings/signers");
  revalidatePath("/portal/documents");
  return { ok: true as const, id };
}

/**
 * Retire a signer, or bring them back.
 *
 * Never a delete. Templates point at signers and sent packages quote them, and
 * a hard delete would either orphan a template's choice or take the name off a
 * contract that has already been executed. Deactivating leaves both intact and
 * makes `pickSigner` fall through to the default.
 */
export async function setCompanySignerActiveAction(id: string, active: boolean) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");

  const row = await prisma.companySigner.findFirst({
    where: { id, companyId: user.companyId },
    select: { id: true, isDefault: true },
  });
  if (!row) return fail("Signer not found.");

  await prisma.companySigner.update({
    where: { id: row.id },
    // Retiring the default clears the flag with it. A retired default would
    // resolve to nobody while still looking like the company's answer.
    data: { active, isDefault: active ? row.isDefault : false },
  });

  revalidatePath("/portal/settings/signers");
  return { ok: true as const };
}

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

/**
 * Store a signer's mark.
 *
 * Drawn, typed and uploaded all arrive here and all leave as the same
 * normalised transparent PNG data URL, because the PDF stamper embeds exactly
 * one shape. A data URL rather than object storage: the column is read on every
 * send, a saved signature is a few tens of KB, and the customer's own signature
 * is already stored this way on DocumentSigner — one shape, one code path.
 *
 * `which` picks the signature or the separate initials mark.
 */
export async function uploadSignerMarkAction(formData: FormData) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");

  const id = formData.get("id");
  const which = formData.get("which");
  if (typeof id !== "string" || (which !== "signature" && which !== "initials")) {
    return fail("Bad request.");
  }

  const row = await prisma.companySigner.findFirst({
    where: { id, companyId: user.companyId },
    select: { id: true },
  });
  if (!row) return fail("Signer not found.");

  const file = formData.get("file");
  if (!(file instanceof File)) return fail("No image provided.");
  if (file.size > SIGNATURE_MAX_BYTES) return fail("That image is too large (max 4MB).");
  // SVG is refused for the reason branding refuses it: serving user SVG is an
  // XSS surface, and pdf-lib cannot embed one anyway.
  if (!IMAGE_TYPES.has(file.type)) return fail("Use a PNG, JPG, or WebP image.");

  let png: Buffer;
  try {
    png = await sharp(Buffer.from(await file.arrayBuffer()))
      .rotate()
      .resize({
        width: SIGNATURE_MAX_WIDTH,
        height: SIGNATURE_MAX_HEIGHT,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();
  } catch {
    return fail("Could not read that image.");
  }

  const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
  await prisma.companySigner.update({
    where: { id: row.id },
    data: which === "signature" ? { signatureData: dataUrl } : { initialsData: dataUrl },
  });

  revalidatePath("/portal/settings/signers");
  return { ok: true as const, dataUrl };
}

const markSchema = z.object({
  id: z.string().uuid(),
  which: z.enum(["signature", "initials"]),
  /** A PNG data URL straight off a canvas, or null to clear the mark. */
  dataUrl: z.string().max(2_000_000).nullable(),
});

/**
 * Save a mark drawn or typed in the browser.
 *
 * Re-encoded through sharp rather than trusted: the string arrives from a
 * client and is later handed to `embedPng`, so it is decoded once here — where
 * a bad image is a form error — instead of at PDF-generation time, where it
 * would be a failed contract send.
 */
export async function saveSignerMarkAction(input: z.input<typeof markSchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");

  const parsed = markSchema.safeParse(input);
  if (!parsed.success) return fail("Bad request.");
  const { id, which, dataUrl } = parsed.data;

  const row = await prisma.companySigner.findFirst({
    where: { id, companyId: user.companyId },
    select: { id: true },
  });
  if (!row) return fail("Signer not found.");

  let stored: string | null = null;
  if (dataUrl) {
    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
    if (base64 === dataUrl) return fail("That is not an image.");
    try {
      const png = await sharp(Buffer.from(base64, "base64"))
        .resize({
          width: SIGNATURE_MAX_WIDTH,
          height: SIGNATURE_MAX_HEIGHT,
          fit: "inside",
          withoutEnlargement: true,
        })
        .png()
        .toBuffer();
      stored = `data:image/png;base64,${png.toString("base64")}`;
    } catch {
      return fail("Could not read that signature.");
    }
  }

  await prisma.companySigner.update({
    where: { id: row.id },
    data: which === "signature" ? { signatureData: stored } : { initialsData: stored },
  });

  revalidatePath("/portal/settings/signers");
  return { ok: true as const, dataUrl: stored };
}
