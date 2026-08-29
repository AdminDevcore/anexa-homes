/**
 * What a battery is worth, in the two currencies a homeowner buying one cares
 * about: hours the lights stay on, and money off the bill.
 *
 * A battery makes no kilowatt-hours. Every argument the solar proposal makes —
 * offset, the production chart, the twenty-five-year comparison, the
 * environmental equivalences — is built on a figure a storage deal does not
 * have, so a document about a battery has to be argued from something else.
 * This is that something else.
 *
 * PURE. No database, no React, no formatting. The rep's builder and the
 * customer's document both read these, and a figure that differs between the
 * screen a rep quoted from and the paper a customer signed is a phone call.
 *
 * NOTHING IS HARDCODED, the same rule `solar-proposal.ts` opens with: every
 * assumption arrives as an argument and is frozen into the snapshot beside the
 * number it produced. A number a homeowner reads is one somebody at the company
 * decided to stand behind.
 */

/** A company's named load profile. `loadWatts` is what is being backed up. */
export type BackupProfile = { id: string; name: string; loadWatts: number; rank: number };

export type BackupRow = { id: string; name: string; loadWatts: number; hours: number };

export type TouAssumptions = {
  /**
   * What share of a day's kWh falls inside the peak window, %.
   *
   * MODELLED, not measured, and the softest number in a storage quote — which
   * is why it is a company decision listed on the document rather than a
   * constant hidden in here.
   */
  peakSharePct: number;
  /** How many times a day the battery is cycled. */
  cyclesPerDay: number;
  /** What survives a charge/discharge round trip, %. */
  roundTripEfficiencyPct: number;
};

export type TouSavings = {
  shiftedKwhPerDay: number;
  peakUsageKwhPerDay: number;
  annualSavingsCents: number;
};

/**
 * Usable storage, kWh.
 *
 * `SolarEquipment.ratingW` holds WATT-HOURS on a battery — the catalogue label
 * renders "Tesla Powerwall 3 · 13500Wh". The column is misnamed for this kind
 * and is READ, not renamed: a rename reaches the VPP equipment lists, the
 * catalogue manager and the approved-vendor joins, and buys nothing this needs.
 */
export function usableKwh(batteryRatingWh: number | null | undefined, qty: number): number {
  if (!batteryRatingWh || !(batteryRatingWh > 0)) return 0;
  const n = Math.max(0, Math.round(qty));
  return (batteryRatingWh / 1000) * n;
}

/**
 * Hours at a given load.
 *
 * Null rather than Infinity when nothing is drawing. A profile someone saved
 * with a zero load is a mistake in Settings, and "∞ hours" printed on a
 * customer's proposal is a worse way to find out than the row simply not
 * appearing.
 */
export function backupHours(kwh: number, loadWatts: number): number | null {
  if (!(loadWatts > 0)) return null;
  return kwh / (loadWatts / 1000);
}

/**
 * Every active profile with its hours, lowest load first.
 *
 * Rank-ordered so the cover can headline the first row without the design
 * carrying a "which one do I headline" field — the list already has an order,
 * and a second way to say the same thing is a second thing to keep in sync.
 *
 * EMPTY when there is no storage, so the chapter omits itself rather than
 * printing a column of zeroes. That is rule one of the proposal document: a
 * chapter with no data is omitted, never rendered empty.
 */
export function backupTable(kwh: number, profiles: BackupProfile[]): BackupRow[] {
  if (!(kwh > 0)) return [];
  return [...profiles]
    .sort((a, b) => a.rank - b.rank || a.loadWatts - b.loadWatts)
    .map((p) => ({
      id: p.id,
      name: p.name,
      loadWatts: p.loadWatts,
      hours: backupHours(kwh, p.loadWatts),
    }))
    .filter((r): r is BackupRow => r.hours != null);
}

/**
 * What charging cheap and discharging at peak is worth in a year.
 *
 *     peakUsage/day = annualUsage ÷ 365 × peakShare
 *     shifted/day   = min(usableKwh × cycles, peakUsage/day)
 *     savings/yr    = shifted × 365 × (peak − offPeak) × roundTripEfficiency
 *
 * The `min` is the whole model: a big battery in a small house cannot shift
 * more than the house uses in the window, and a small battery in a big house
 * cannot shift more than it holds. Whichever binds first is the answer.
 *
 * NULL, NOT ZERO, whenever the arithmetic has nothing behind it — a missing
 * rate, a spread of zero or less, no usage on file, no storage. The document
 * omits the line in that case. A zero printed beside a real backup figure reads
 * as "this battery saves you nothing", which is a different and untrue claim
 * from "we do not have your utility's peak rate on file".
 */
export function touSavings(
  input: {
    usableKwh: number;
    annualUsageKwh: number;
    peakRateMills: number | null | undefined;
    offPeakRateMills: number | null | undefined;
  } & TouAssumptions
): TouSavings | null {
  const { usableKwh: kwh, annualUsageKwh, peakRateMills, offPeakRateMills } = input;
  if (!(kwh > 0) || !(annualUsageKwh > 0)) return null;
  if (peakRateMills == null || offPeakRateMills == null) return null;

  const spreadMills = peakRateMills - offPeakRateMills;
  if (!(spreadMills > 0)) return null;

  const peakUsageKwhPerDay = (annualUsageKwh / 365) * (input.peakSharePct / 100);
  const shiftedKwhPerDay = Math.min(kwh * input.cyclesPerDay, peakUsageKwhPerDay);
  if (!(shiftedKwhPerDay > 0)) return null;

  // Mills are tenths of a cent, so the spread divides by 10 to reach cents —
  // not 1000. A 15-cent spread is 150 mills, and a kWh of it is 15 cents.
  const annualSavingsCents = Math.round(
    ((shiftedKwhPerDay * 365 * spreadMills) / 10) * (input.roundTripEfficiencyPct / 100)
  );
  return { shiftedKwhPerDay, peakUsageKwhPerDay, annualSavingsCents };
}
