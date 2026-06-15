import { cache } from "react";
import { redirect } from "next/navigation";
import type { Session } from "next-auth";
import type { Role, Industry } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/server/db/client";
import type { AccessUser } from "@/server/rbac/guards";

export type SessionUser = AccessUser & {
  email: string | null;
  firstName: string;
  lastName: string;
  fullName: string;
  companySlug: string;
  avatarUrl: string | null;
  title: string | null;
  industries: Industry[];
};

/**
 * Returns the current authenticated user, re-validated against the live DB row
 * (status + sessionVersion) so disabling a user or bumping their session version
 * invalidates existing JWTs immediately. Returns null when unauthenticated.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  // auth() can throw (e.g. JWTSessionError) when a cookie was encrypted with an old
  // AUTH_SECRET and no longer decrypts. Treat any session-read failure as logged-out
  // instead of letting it crash every server render.
  let session: Session | null = null;
  try {
    session = await auth();
  } catch {
    return null;
  }
  if (!session?.user?.id) return null;

  const live = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      status: true,
      sessionVersion: true,
      companyId: true,
      avatarUrl: true,
      title: true,
      permissions: true,
      industries: true,
      company: { select: { slug: true } },
    },
  });

  if (!live || live.status === "disabled" || live.status === "suspended" || live.role === "customer") {
    return null;
  }
  if (live.sessionVersion !== session.user.sessionVersion) {
    return null;
  }

  return {
    userId: live.id,
    companyId: live.companyId,
    role: live.role as Role,
    permissions: (live.permissions as Record<string, unknown>) ?? {},
    email: live.email,
    firstName: live.firstName,
    lastName: live.lastName,
    fullName: `${live.firstName} ${live.lastName}`.trim(),
    companySlug: live.company.slug,
    avatarUrl: live.avatarUrl,
    title: live.title,
    industries: live.industries,
  };
});

/** Require an authenticated user or redirect to login. */
export async function requireUser(nextPath?: string): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    const params = nextPath ? `?next=${encodeURIComponent(nextPath)}` : "";
    redirect(`/login${params}`);
  }
  return user;
}

/** Default landing path for a role after login. (Customer role is retired.) */
export function dashboardPathForRole(_role: Role): string {
  return "/portal/dashboard";
}
