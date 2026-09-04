import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";

/**
 * Settings has no chrome of its own — the app sidebar becomes its menu.
 *
 * It used to build a second navigation rail here, beside the one the portal
 * already had, and fetch the counts to decorate it with. Both moved: the menu to
 * the sidebar, and its counts to /api/settings/inventory, which is the only
 * place that can keep them current while you are editing the very things being
 * counted.
 *
 * What is left is the guard, and it lives here as well as on every page under it
 * deliberately: a layout is not a security boundary in Next — a page renders even
 * when its layout redirects — so the pages keep their own `can()` check.
 */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (!can(user, "read", "Settings")) redirect("/portal/dashboard");
  return <>{children}</>;
}
