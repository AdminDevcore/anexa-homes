"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth/session";
import { VERTICAL_COOKIE, userVerticals } from "@/server/auth/vertical";
import { isActiveVertical, type ActiveVertical } from "@/lib/vertical";

/**
 * Switch the active vertical workspace.
 *
 * Only ever switches into a vertical the user is actually granted, and
 * `isActiveVertical` rejects retired values, so a crafted request cannot land
 * someone in a workspace that no longer exists.
 */
export async function setActiveVerticalAction(vertical: ActiveVertical) {
  const user = await requireUser();
  if (!isActiveVertical(vertical) || !userVerticals(user).includes(vertical)) {
    return { ok: false as const, error: "You don't have access to that workspace." };
  }
  (await cookies()).set(VERTICAL_COOKIE, vertical, {
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/portal", "layout");
  return { ok: true as const };
}
