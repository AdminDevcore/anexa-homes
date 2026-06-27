import { DALLAS, DEFAULT_RADIUS_MILES, type LatLng } from "./geo";

export type StormConfig = { center: LatLng; radiusMiles: number };

// Per-company storm search center + radius. Today every company defaults to
// Dallas @ 100 mi; this is the single seam to make it configurable later
// (e.g. read from CompanySettings) without touching call sites.
export async function getStormConfig(companyId: string): Promise<StormConfig> {
  void companyId; // reserved: per-company center/radius will come from settings later
  return { center: { ...DALLAS }, radiusMiles: DEFAULT_RADIUS_MILES };
}

// Buffer kept around the search radius when importing, so events just outside
// the circle are still available when a user pans/filters near the edge.
export const IMPORT_BUFFER_MI = 25;
