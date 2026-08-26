"use server";

import { revalidatePath } from "next/cache";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { putObject } from "@/server/storage";

/**
 * A photograph of a catalogue component — a panel, an inverter, a battery.
 *
 * Deliberately the same shape as `lender-logo-actions`, down to the storage
 * key and the cache-busting column, because it is the same problem: an image
 * that has to render inside a document a homeowner opens from an email with no
 * session and no account.
 *
 * Not a FileAsset row, for the same reason lender logos are not: `files` has no
 * equipment column, so tying one to a catalogue item would mean smuggling the
 * id into a category string, and every product shot would then appear in
 * Documents as a mystery image on somebody's deal.
 */

const fail = (error: string) => ({ ok: false as const, error });

/** Product shots are small. Anything bigger is a camera roll original. */
const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp"]);
/** SVG is refused on purpose — the same XSS reasoning as the company logo. */

/**
 * Normalise whatever we were given into the one shape everything renders.
 *
 * `fit: "inside"` never crops. A panel is a wide rectangle and an inverter is a
 * tall one; centre-cropping either to a square cuts the product in half, and
 * half a photograph of the hardware somebody is buying is worse than none.
 *
 * PNG, like lender logos, so the serving route needs no mime column and a
 * cut-out product shot keeps its transparency against the proposal's paper.
 * 640px is the honest ceiling for something rendered in a card a third of a
 * column wide, printed included.
 */
async function normalise(raw: Buffer): Promise<Buffer | null> {
  try {
    return await sharp(raw)
      .rotate()
      .resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}

/** The catalogue item, scoped to the caller's company. Null means "not yours". */
async function ownedEquipment(companyId: string, id: string) {
  return prisma.solarEquipment.findFirst({
    where: { companyId, id },
    select: { id: true, model: true, photoKey: true },
  });
}

function revalidate() {
  revalidatePath("/portal/settings/solar-equipment");
}

/** Upload a photo for one catalogue item. */
export async function uploadSolarEquipmentPhotoAction(
  equipmentId: string,
  formData: FormData,
): Promise<{ ok: true; photoUpdatedAt: number } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");

  const item = await ownedEquipment(user.companyId, equipmentId);
  if (!item) return fail("Not found.");

  const file = formData.get("file");
  if (!(file instanceof File)) return fail("No file provided.");
  if (file.size > MAX_BYTES) return fail("Photo too large (max 8MB).");
  if (!ALLOWED.has(file.type)) return fail("Use a PNG, JPG, or WebP image.");

  const png = await normalise(Buffer.from(await file.arrayBuffer()));
  if (!png) return fail("Could not read that image.");

  const key = `companies/${user.companyId}/solar/equipment/${nanoid()}.png`;
  await putObject(key, png);
  await prisma.solarEquipment.update({
    where: { id: equipmentId },
    data: { photoKey: key, photoUpdatedAt: new Date() },
  });

  revalidate();
  return { ok: true, photoUpdatedAt: Date.now() };
}

/** Forget the photo. The item keeps working; the proposal just shows no image. */
export async function removeSolarEquipmentPhotoAction(
  equipmentId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");

  const item = await ownedEquipment(user.companyId, equipmentId);
  if (!item) return fail("Not found.");

  // The object itself is left in storage rather than deleted: a proposal issued
  // last month is still pointing at it, and an image 404 inside a document a
  // customer already has is a worse outcome than an orphaned file.
  await prisma.solarEquipment.update({
    where: { id: equipmentId },
    data: { photoKey: null, photoUpdatedAt: null },
  });

  revalidate();
  return { ok: true };
}
