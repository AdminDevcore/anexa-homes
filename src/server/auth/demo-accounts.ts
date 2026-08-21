import { prisma } from "@/server/db/client";
import type { Role } from "@prisma/client";

/**
 * The quick-login list shown under the sign-in form on a local copy of live.
 *
 * Read from the DATABASE rather than hardcoded, for two reasons. A local clone
 * of production carries whoever production carries plus the seeded demo roles,
 * and a fixed list goes stale the moment either changes. More importantly, a
 * hardcoded list puts real employees' email addresses into the client bundle of
 * a public page — where they sit whether or not the panel ever renders.
 *
 * TWO INDEPENDENT GUARDS, because this returns a roster of accounts on an
 * unauthenticated page:
 *
 *   1. NEXT_PUBLIC_DEMO_MODE must be exactly "true". It is never set in
 *      production (see DEPLOY.md).
 *   2. VERCEL must be unset. Vercel defines it on every build and every
 *      request, so this cannot render on a deployed site even if somebody adds
 *      the flag there by mistake. Checking NODE_ENV instead would have broken
 *      `next build && next start` locally, which is the only way to verify some
 *      behaviour honestly.
 */
export type DemoAccount = { email: string; label: string };

const ROLE_LABEL: Record<Role, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  manager: "Sales Manager",
  sales_rep: "Sales Rep",
  canvasser: "Canvasser",
  marketing: "Marketing",
  installer: "Installer / Crew",
  accounting: "Accounting",
  customer: "Customer",
};

/** Roughly seniority, so the panel reads top-down like an org chart. */
const ROLE_ORDER: Role[] = [
  "super_admin", "admin", "manager", "sales_rep",
  "canvasser", "marketing", "installer", "accounting", "customer",
];

export function demoModeEnabled(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_MODE === "true" && !process.env.VERCEL;
}

export async function getDemoAccounts(): Promise<DemoAccount[]> {
  if (!demoModeEnabled()) return [];
  try {
    const users = await prisma.user.findMany({
      where: { status: "active" },
      select: { email: true, firstName: true, lastName: true, role: true },
      take: 40,
    });
    return users
      .sort((a, b) => {
        const r = ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role);
        return r !== 0 ? r : a.email.localeCompare(b.email);
      })
      .map((u) => {
        const name = `${u.firstName} ${u.lastName}`.replace(/\s+/g, " ").trim();
        return { email: u.email, label: name ? `${name} · ${ROLE_LABEL[u.role]}` : ROLE_LABEL[u.role] };
      });
  } catch {
    // The sign-in page must render even with no database — otherwise a stopped
    // Docker container looks like a broken app rather than a stopped container.
    return [];
  }
}
