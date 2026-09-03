"use server";

import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { revalidatePath } from "next/cache";
import { encryptField, maskTail } from "@/server/lib/crypto";

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
