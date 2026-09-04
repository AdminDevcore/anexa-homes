import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { getActiveVertical } from "@/server/auth/vertical";
import { can } from "@/server/rbac/guards";
import {
  settingsInventoryCached,
  workspaceSetupGapsCached,
} from "@/server/modules/settings/cached";

/**
 * What is configured in each settings section, for the menu in the sidebar.
 *
 * Fetched rather than passed down, because of where the two things live: the
 * sidebar is rendered by the portal layout and the counts belong to Settings,
 * one level below it. Moving the queries up would run sixteen counts on every
 * page in the CRM to decorate a menu most of them never open, and a layout does
 * not re-render when you navigate between its children — so a value handed down
 * on the way in would go stale the moment somebody added a lead source.
 *
 * Reads only, and the same split the overview makes: the counts are for anybody
 * who can open Settings, the gaps only for somebody who could act on one.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user || !can(user, "read", "Settings")) {
    return NextResponse.json({ inventory: {}, gapKeys: [] }, { status: 401 });
  }

  const vertical = await getActiveVertical(user);
  const [inventory, gaps] = await Promise.all([
    settingsInventoryCached(user.companyId, vertical),
    can(user, "update", "Settings")
      ? workspaceSetupGapsCached(user.companyId, vertical)
      : Promise.resolve([]),
  ]);

  return NextResponse.json({ inventory, gapKeys: gaps.map((g) => g.key) });
}
