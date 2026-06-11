"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import type { Industry } from "@prisma/client";
import { requireUser } from "@/server/auth/session";
import { INDUSTRY_COOKIE, userIndustries } from "@/server/auth/industry";
import { isIndustry } from "@/lib/industry";

/** Switch the active industry workspace (only to one the user can access). */
export async function setActiveIndustryAction(industry: Industry) {
  const user = await requireUser();
  if (!isIndustry(industry) || !userIndustries(user).includes(industry)) {
    return { ok: false as const, error: "You don't have access to that industry." };
  }
  (await cookies()).set(INDUSTRY_COOKIE, industry, {
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/portal", "layout");
  return { ok: true as const };
}
