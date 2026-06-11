export type DispositionMeta = { value: string; label: string; color: string; glyph: string };

// The blank/neutral state for an auto-generated address pin (a house nobody has
// knocked yet). Rendered as a hollow gray pin, distinct from the colored ones.
export const NOT_KNOCKED: DispositionMeta = {
  value: "not_knocked",
  label: "Not Knocked",
  color: "#94a3b8",
  glyph: "",
};

// Real "knocked" dispositions a rep sets after visiting a house.
export const KNOCKED_DISPOSITIONS: DispositionMeta[] = [
  { value: "not_home", label: "Not Home", color: "#6b7280", glyph: "!" },
  { value: "not_interested", label: "Not Interested", color: "#ef4444", glyph: "✕" },
  { value: "callback", label: "Callback", color: "#f59e0b", glyph: "↺" },
  { value: "appointment", label: "Appointment", color: "#3b82f6", glyph: "A" },
  { value: "sold", label: "Sold", color: "#22c55e", glyph: "$" },
  { value: "not_qualified", label: "Not Qualified", color: "#a855f7", glyph: "?" },
  { value: "dnk", label: "Do Not Knock", color: "#111827", glyph: "⊘" },
];

// All dispositions incl. the blank state (must match the KnockDisposition enum).
export const DISPOSITIONS: DispositionMeta[] = [NOT_KNOCKED, ...KNOCKED_DISPOSITIONS];

// Values a rep can SET (excludes not_knocked) — used by knock create/update.
export const DISPOSITION_VALUES = KNOCKED_DISPOSITIONS.map((d) => d.value);

export function dispositionMeta(value: string): DispositionMeta {
  return DISPOSITIONS.find((d) => d.value === value) ?? NOT_KNOCKED;
}

export type LatLng = [number, number]; // [lat, lng]

/** Ray-casting point-in-polygon. Points are [lat, lng]; lat=y, lng=x. */
export function pointInPolygon(point: LatLng, polygon: LatLng[]): boolean {
  const [y, x] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [yi, xi] = polygon[i];
    const [yj, xj] = polygon[j];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
