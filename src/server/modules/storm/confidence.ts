// Confidence that a nearby storm report actually represents a given property,
// driven primarily by distance. Radar-at-point (point inside a MESH polygon) is
// treated as High by callers.

export type Confidence = "High" | "Medium" | "Low";

export function distanceConfidence(distanceMiles: number): Confidence | null {
  if (distanceMiles <= 3) return "High";
  if (distanceMiles <= 5) return "Medium";
  if (distanceMiles <= 10) return "Low";
  return null;
}

/** Friendly label for a storm_events.source value. */
export function sourceLabel(source: string): string {
  if (source === "spc_reports") return "SPC Daily Report";
  if (source === "noaa_storm_events") return "NOAA Storm Events";
  if (source === "mrms_mesh") return "MRMS Radar (MESH)";
  return source;
}
