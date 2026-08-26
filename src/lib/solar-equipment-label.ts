/**
 * How a catalogue item reads to a human: "Tesla Powerwall 3 · 13500Wh".
 *
 * Shared rather than re-derived at each call site because the same battery is
 * named on a VPP programme's list in settings and in the verdict a rep reads on
 * a deal, and the two have to be recognisably the same string — a rep matching
 * "Powerwall 3" against "Tesla Powerwall 3 13.5kWh" is a phone call to the
 * office.
 */
export type EquipmentForLabel = {
  manufacturer?: string | null;
  model: string;
  ratingW?: number | null;
};

export function solarEquipmentLabel(e: EquipmentForLabel): string {
  const head = `${e.manufacturer ? `${e.manufacturer} ` : ""}${e.model}`;
  return e.ratingW ? `${head} · ${e.ratingW}W` : head;
}
