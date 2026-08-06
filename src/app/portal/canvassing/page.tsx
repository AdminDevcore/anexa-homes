import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { getActiveVertical } from "@/server/auth/vertical";
import { stormEnabled } from "@/lib/vertical-features";
import { can } from "@/server/rbac/guards";
import { CanvassingShell } from "@/components/portal/canvassing-shell";
import { mapTilesConfigured } from "@/server/modules/geo/map-tiles";

export const metadata = { title: "Field Map" };

export default async function CanvassingPage() {
  const user = await requireUser("/portal/canvassing");
  if (!can(user, "read", "Canvassing")) redirect("/portal/dashboard");

  // Two independent questions, both of which must be yes: may this person see
  // storm data, and does the workspace they are standing in have storms at all.
  const canStorm = can(user, "read", "StormIntelligence") && stormEnabled(await getActiveVertical(user));
  // Google basemaps are billed per tile, so the Layers panel only offers them
  // when a key exists to bill against.
  return <CanvassingShell canStorm={canStorm} googleTiles={mapTilesConfigured()} />;
}
