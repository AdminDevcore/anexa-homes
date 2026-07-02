import { prisma } from "@/server/db/client";
import { DALLAS, DEFAULT_RADIUS_MILES, type LatLng } from "./geo";

export type StormConfig = { center: LatLng; radiusMiles: number };

// Per-company storm search center + radius. Read from CompanySettings when the
// admin has set a coverage area (Settings → Storm Coverage); otherwise defaults
// to Dallas @ 100 mi. Drives the daily SPC import + the storm map/checker.
export async function getStormConfig(companyId: string): Promise<StormConfig> {
  const s = await prisma.companySettings
    .findUnique({
      where: { companyId },
      select: { stormCenterLat: true, stormCenterLng: true, stormRadiusMiles: true },
    })
    .catch(() => null);
  if (s && s.stormCenterLat != null && s.stormCenterLng != null) {
    return {
      center: { lat: s.stormCenterLat, lng: s.stormCenterLng },
      radiusMiles: s.stormRadiusMiles && s.stormRadiusMiles > 0 ? s.stormRadiusMiles : DEFAULT_RADIUS_MILES,
    };
  }
  return { center: { ...DALLAS }, radiusMiles: DEFAULT_RADIUS_MILES };
}

// Buffer kept around the search radius when importing, so events just outside
// the circle are still available when a user pans/filters near the edge.
export const IMPORT_BUFFER_MI = 25;
