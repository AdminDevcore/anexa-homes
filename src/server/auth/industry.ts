import { cookies } from "next/headers";
import type { Industry } from "@prisma/client";
import { isIndustry, DEFAULT_INDUSTRY, allowedIndustries } from "@/lib/industry";
import type { SessionUser } from "./session";

export const INDUSTRY_COOKIE = "anexa_industry";

/** The industries this user may switch between. */
export function userIndustries(user: Pick<SessionUser, "industries">): Industry[] {
  return allowedIndustries(user.industries);
}

/**
 * The active industry workspace for this request: the cookie value if the user
 * is allowed it, otherwise their default (roofing if allowed, else the first
 * industry they can access).
 */
export async function getActiveIndustry(user: Pick<SessionUser, "industries">): Promise<Industry> {
  const allowed = userIndustries(user);
  const fromCookie = (await cookies()).get(INDUSTRY_COOKIE)?.value;
  if (fromCookie && isIndustry(fromCookie) && allowed.includes(fromCookie)) return fromCookie;
  return allowed.includes(DEFAULT_INDUSTRY) ? DEFAULT_INDUSTRY : allowed[0];
}
