"use server";

import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { revalidatePath } from "next/cache";
import { decryptField, encryptField, maskTail } from "@/server/lib/crypto";
import { AmosSubmissionError, fetchAmosCatalog, type AmosCatalogItem } from "./amos-client";

/**
 * A lender's API credential, on the Settings screen.
 *
 * The submission itself lives in `./lender-submit` and is reached from the
 * customer's proposal, not from here — see the note on the Qualify button.
 * What is left in this module is the one thing only an administrator does:
 * put a partner's key in, and take it out again.
 *
 * Every partner issues its own key, which is why the key is a column on the
 * lender row rather than a company setting or an environment variable. Adding
 * the second lender is a paste, not a deploy.
 */

/**
 * Store a lender's API key.
 *
 * Its own action, separate from `saveSolarLenderAction`, because a secret must
 * only ever travel INBOUND. A form that edits the key alongside the other
 * fields has to be given the current value to send it back, which means
 * shipping a live credential to a browser on every settings page load. This
 * one takes a key and returns nothing but success.
 */
export async function setSolarLenderApiKeyAction(
  lenderId: string,
  apiKey: string,
): Promise<{ ok: true; masked: string } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return { ok: false, error: "Not allowed." };

  const key = apiKey.trim();
  if (!key) return { ok: false, error: "Paste the key the lender issued you." };
  if (key.length > 200) return { ok: false, error: "That does not look like an API key." };

  /**
   * An HTTP header value can only hold bytes. A key pasted out of a terminal
   * commonly arrives with the shell's prompt glyph on the front — "❯", U+276F —
   * and that single character makes the Authorization header impossible to
   * encode, so `fetch` throws BEFORE any request is sent. The failure then
   * looks exactly like the network being down, which is where a real
   * afternoon went.
   *
   * Refused here, at the moment of pasting, where the person can see what they
   * pasted. `stray` names the offending character so the message is actionable
   * rather than a shrug.
   */
  const stray = [...key].find((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) > 0x7e);
  if (stray) {
    return {
      ok: false,
      error:
        `That key contains a character it cannot have: "${stray}". ` +
        "It usually means a shell prompt or a line break was copied along with the key. " +
        "Copy just the key itself and paste it again.",
    };
  }

  const lender = await prisma.solarLender.findFirst({
    where: { id: lenderId, companyId: user.companyId },
    select: { id: true },
  });
  if (!lender) return { ok: false, error: "Lender not found." };

  await prisma.solarLender.update({
    where: { id: lender.id },
    data: { apiKeyEncrypted: encryptField(key) },
  });
  revalidatePath("/portal/settings/lenders");

  // The last four, so the person who pasted it can confirm they pasted the
  // right one. Never the whole key again.
  return { ok: true, masked: maskTail(key) };
}

/** Remove a lender's API key. The lender falls back to its application link. */
export async function clearSolarLenderApiKeyAction(
  lenderId: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return { ok: false, error: "Not allowed." };

  const lender = await prisma.solarLender.findFirst({
    where: { id: lenderId, companyId: user.companyId },
    select: { id: true },
  });
  if (!lender) return { ok: false, error: "Lender not found." };

  await prisma.solarLender.update({
    where: { id: lender.id },
    data: { apiKeyEncrypted: null },
  });
  revalidatePath("/portal/settings/lenders");
  return { ok: true };
}

/**
 * Pull this partner's approved-vendor list, live.
 *
 * The mapping screen's only source of truth for the right-hand side. Their
 * names cannot be derived from ours — theirs is a product family, ours is a
 * SKU with a wattage on the end — so an admin picks from THEIR list rather
 * than retyping it, and a string that looks right but submits to a 422 is not
 * reachable through the UI.
 *
 * Not cached. It is pressed by hand, a few times a year, by one admin; a
 * stale approved-vendor list is exactly the thing this screen exists to stop.
 */
export async function readLenderCatalogueAction(lenderId: string): Promise<
  | { ok: true; equipment: AmosCatalogItem[]; products: { slug: string; name: string }[] }
  | { ok: false; error: string }
> {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return { ok: false, error: "Not allowed." };

  const lender = await prisma.solarLender.findFirst({
    where: { id: lenderId, companyId: user.companyId },
    select: { name: true, apiBaseUrl: true, apiKeyEncrypted: true },
  });
  if (!lender) return { ok: false, error: "Lender not found." };

  const apiKey = decryptField(lender.apiKeyEncrypted);
  if (!lender.apiBaseUrl || !apiKey) {
    return {
      ok: false,
      error: `${lender.name} has no API address and key yet. Add them on the Details tab first.`,
    };
  }

  try {
    const catalog = await fetchAmosCatalog({ baseUrl: lender.apiBaseUrl, apiKey });
    return { ok: true, equipment: catalog.equipment, products: catalog.products };
  } catch (e) {
    // The lender's own sentence, which is written for a person: "This API key
    // is not recognized." Anything else would hide the one fact an admin
    // pressing this button is trying to establish.
    if (e instanceof AmosSubmissionError) return { ok: false, error: e.message };
    return { ok: false, error: "Could not read that lender's catalogue. Try again in a moment." };
  }
}

/**
 * Write down what this partner calls each item it approves.
 *
 * Only ever touches rows that ALREADY EXIST. The join row is the approval, so
 * creating one here to hold a name would silently add an item to a partner's
 * approved-vendor list — a change with pricing and eligibility consequences —
 * as a side effect of typing a name. Approvals are set on the equipment
 * screen; this sets the words.
 *
 * Both halves or neither: a row carrying their brand and our model is a name
 * no catalogue contains, so a half-filled pair is stored as null and the
 * submission falls back to ours. See `submittedName` in amos-payload.
 */
export async function setLenderEquipmentNamesAction(
  lenderId: string,
  entries: { equipmentId: string; lenderBrand: string | null; lenderModel: string | null }[],
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return { ok: false, error: "Not allowed." };

  const lender = await prisma.solarLender.findFirst({
    where: { id: lenderId, companyId: user.companyId },
    select: { id: true },
  });
  if (!lender) return { ok: false, error: "Lender not found." };

  // The approvals this lender actually holds, so an equipment id from another
  // company — or one this partner does not approve — writes nothing.
  const approved = new Set(
    (
      await prisma.solarEquipmentLender.findMany({
        where: { lenderId: lender.id, equipment: { companyId: user.companyId } },
        select: { equipmentId: true },
      })
    ).map((a) => a.equipmentId),
  );

  const writes = entries
    .filter((e) => approved.has(e.equipmentId))
    .map((e) => {
      const brand = e.lenderBrand?.trim() || null;
      const model = e.lenderModel?.trim() || null;
      const paired = brand && model;
      return prisma.solarEquipmentLender.update({
        where: { equipmentId_lenderId: { equipmentId: e.equipmentId, lenderId: lender.id } },
        data: {
          lenderBrand: paired ? brand : null,
          lenderModel: paired ? model : null,
        },
      });
    });

  await prisma.$transaction(writes);
  revalidatePath("/portal/settings/solar-lenders");
  return { ok: true, count: writes.length };
}
