import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { getActiveVertical } from "@/server/auth/vertical";
import { can } from "@/server/rbac/guards";
import {
  settingsInventoryCached,
  workspaceSetupGapsCached,
} from "@/server/modules/settings/cached";
import { SettingsChrome } from "@/components/portal/settings-nav";

/**
 * Settings is one screen with a rail, not twenty pages with a Back link.
 *
 * The guard lives here as well as on every page under it, deliberately: a
 * layout is not a security boundary in Next — a page renders even when its
 * layout redirects — so the pages keep their own `can()` check. What this one
 * buys is that the rail is never built for somebody who cannot read Settings.
 */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (!can(user, "read", "Settings")) redirect("/portal/dashboard");
  const vertical = await getActiveVertical(user);

  // Same split the hub makes: everyone who can read Settings sees the counts,
  // because they say nothing opening the page would not, but only somebody who
  // can act on a gap is shown one.
  const [inventory, gaps] = await Promise.all([
    settingsInventoryCached(user.companyId, vertical),
    can(user, "update", "Settings")
      ? workspaceSetupGapsCached(user.companyId, vertical)
      : Promise.resolve([]),
  ]);

  return (
    <SettingsChrome
      vertical={vertical}
      inventory={inventory}
      gapKeys={gaps.map((g) => g.key)}
    >
      {children}
    </SettingsChrome>
  );
}
