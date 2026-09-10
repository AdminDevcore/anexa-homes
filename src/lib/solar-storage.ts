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

import { effectiveUsageKwh } from "@/lib/solar-energy";

/**
 * WHICH kilowatt-hours the battery count is measured against.
 *
 * A deal with an array is sized off its PRODUCTION: that is the energy the
 * battery is being asked to hold overnight, and a 60%-offset system cannot
 * charge storage for a night it never made the power for. A storage-only deal
 * makes none at all, so it is sized off what the house USES, adders included —
 * measuring it against zero would quote a single battery to every home on the
 * street.
 *
 * Storage-only is decided on the SYSTEM TYPE, never on the production being
 * zero: a deal switching to storage-only still carries the production of the
 * array it is abandoning until that write lands.
 *
 * One function, because the rule is read in two places — the recompute that
 * WRITES the count, and the deal screen that explains it — and two copies of a
 * rule this load-bearing is two answers to "why does it say three batteries".
 */
export function autoBatteryBasisKwh(design: {
  systemType: "pv" | "pv_storage" | "storage";
  year1ProductionKwh: number;
  annualUsageKwh: number | null | undefined;
  usageAdjustmentKwh: number | null | undefined;
}): number {
  const usageKwh = effectiveUsageKwh(
    design.annualUsageKwh,
    design.usageAdjustmentKwh,
  );
  if (design.systemType === "storage") return usageKwh;
  return design.year1ProductionKwh > 0 ? design.year1ProductionKwh : usageKwh;
}

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
export function usableKwh(
  batteryRatingWh: number | null | undefined,
  qty: number,
): number {
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
 * Hours in a year.
 *
 * The divisor that turns a year's kilowatt-hours into a continuous load, and
 * the only reason a runtime can be worked out from a figure the Energy step
 * already collects instead of from a wattage somebody typed.
 */
const HOURS_PER_YEAR = 8760;

/**
 * What the one remaining backup row is called, everywhere.
 *
 * A constant rather than a string typed in three files: the rep's builder, the
 * frozen snapshot and the customer's document all name the same row, and a
 * document whose figure is labelled differently from the screen it was quoted
 * from is a phone call.
 */
export const WHOLE_HOME_BACKUP_LABEL = "Whole home";

export type WholeHomeBackup = {
  /** What the house draws on average, W — the year's usage spread over 8760 h. */
  averageLoadWatts: number;
  /** What the outage is assumed to draw, W — the average times the factor. */
  loadWatts: number;
  /** How long the battery carries that. */
  hours: number;
};

/**
 * How long the battery carries THIS house, whole-home.
 *
 *     average W = annual kWh × 1000 ÷ 8760
 *     outage W  = average × outageDrawFactor
 *     hours     = usable kWh ÷ (outage W ÷ 1000)
 *
 * REPLACES the company's list of named load profiles, and the reason is the
 * one thing every install here has in common: they are all whole-home backup.
 * A menu of "Essentials / Essentials + AC / Whole home" sold coverage tiers
 * this company does not offer, and worse, it divided every customer's battery
 * by the same wattage — a 900 sq ft condo and a 4,000 sq ft house were quoted
 * the same hours off the same stack. The home's own usage is already on the
 * deal; it is a better answer than a number typed once in Settings.
 *
 * `outageDrawFactor` is the margin over the yearly average, and it is a company
 * decision rather than a constant in here for the same reason `touPeakSharePct`
 * is: an outage is not an average moment. Power goes out in a heatwave with the
 * AC running, so dividing by the bare average would overpromise. It is MODELLED,
 * so the company states it and the document carries it.
 *
 * NULL, not zero, whenever the arithmetic has nothing behind it — no storage,
 * no usage on file, no factor set. The chapter then omits itself, which is rule
 * one of the proposal document. "0 hours" beside a battery a homeowner is being
 * asked to buy is a claim, and an untrue one; what it actually means is that
 * nobody has filled in the Energy step yet.
 */
export function wholeHomeBackup(input: {
  usableKwh: number;
  annualUsageKwh: number | null | undefined;
  outageDrawFactor: number | null | undefined;
}): WholeHomeBackup | null {
  const { usableKwh: kwh, annualUsageKwh, outageDrawFactor } = input;
  if (!(kwh > 0)) return null;
  if (!annualUsageKwh || !(annualUsageKwh > 0)) return null;
  // A factor of zero is a company saying the house draws nothing while the grid
  // is down, which is not a setting anybody means — it is an unfilled field, and
  // dividing by it prints an endless runtime.
  if (!outageDrawFactor || !(outageDrawFactor > 0)) return null;

  const averageLoadWatts = (annualUsageKwh * 1000) / HOURS_PER_YEAR;
  const loadWatts = averageLoadWatts * outageDrawFactor;
  const hours = backupHours(kwh, loadWatts);
  return hours == null ? null : { averageLoadWatts, loadWatts, hours };
}

/**
 * What the document freezes about how a runtime was worked out, or null on one
 * generated before backup went whole-home. Mirrors the snapshot's
 * `storage.backupBasis` — see `SolarProposalSnapshot`.
 */
export type BackupBasis = {
  annualUsageKwh: number;
  averageLoadWatts: number;
  outageDrawFactor: number;
};

/** One backup row as the document holds it, whichever era it came from. */
export type FrozenBackupRow = {
  name: string;
  loadWatts: number;
  hours: number;
};

/**
 * Hours, as a customer reads them.
 *
 * A decimal below ten because the difference between six and seven hours is the
 * difference between the fridge surviving the night; a whole number above it,
 * where a tenth of an hour is false precision about a modelled figure.
 */
export function formatBackupHours(h: number): string {
  return h < 10 ? `${h.toFixed(1)} hrs` : `${Math.round(h)} hrs`;
}

/**
 * The runtime clause on the cover.
 *
 * HERE, not in the document component, because it is a sentence a homeowner
 * reads and it changes on the era of the document. Assembled as one string
 * rather than as JSX siblings: `{a} {b}` drops the space between them and ships
 * "about 12 hrsfor the whole home" — see the note in `solar-proposal.ts`.
 *
 * With a basis it is THIS house, whole-home, and saying so matters: the number
 * is no longer a tier anybody chose. Without one the document predates the
 * change and named the profile the company put at rank 0, which is what that
 * cover has always said and must keep saying.
 */
export function backupHeadline(
  row: FrozenBackupRow,
  basis: BackupBasis | null,
): string {
  const hours = formatBackupHours(row.hours);
  return basis
    ? `about ${hours} for the whole home`
    : `about ${hours} on ${row.name.toLowerCase()}`;
}

/**
 * The line under the runtime that shows its working.
 *
 * A modelled figure a household is asked to buy on should say what it was
 * modelled from, in the household's own numbers — their usage, the average it
 * implies, and how far above that average an outage is quoted. The alternative
 * is a number with nothing behind it, which is the thing this whole change was
 * about.
 */
export function backupFootnote(
  usableKwh: number,
  basis: BackupBasis | null,
): string {
  const held = `${usableKwh.toFixed(1)} kWh of usable storage`;
  if (!basis) {
    return `Estimated from ${held} at the loads shown. Real runtime moves with what is switched on.`;
  }
  const usage = Math.round(basis.annualUsageKwh).toLocaleString();
  const avg = (basis.averageLoadWatts / 1000).toFixed(1);
  const margin = Math.round((basis.outageDrawFactor - 1) * 100);
  return (
    `Estimated from ${held} against your own use: ${usage} kWh a year averages ${avg} kW, ` +
    `and an outage is quoted ${margin}% above that because the power tends to go out when the ` +
    `house is working hardest. Real runtime moves with what is switched on.`
  );
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
  } & TouAssumptions,
): TouSavings | null {
  const {
    usableKwh: kwh,
    annualUsageKwh,
    peakRateMills,
    offPeakRateMills,
  } = input;
  if (!(kwh > 0) || !(annualUsageKwh > 0)) return null;
  if (peakRateMills == null || offPeakRateMills == null) return null;

  const spreadMills = peakRateMills - offPeakRateMills;
  if (!(spreadMills > 0)) return null;

  const peakUsageKwhPerDay =
    (annualUsageKwh / 365) * (input.peakSharePct / 100);
  const shiftedKwhPerDay = Math.min(
    kwh * input.cyclesPerDay,
    peakUsageKwhPerDay,
  );
  if (!(shiftedKwhPerDay > 0)) return null;

  // Mills are tenths of a cent, so the spread divides by 10 to reach cents —
  // not 1000. A 15-cent spread is 150 mills, and a kWh of it is 15 cents.
  const annualSavingsCents = Math.round(
    ((shiftedKwhPerDay * 365 * spreadMills) / 10) *
      (input.roundTripEfficiencyPct / 100),
  );
  return { shiftedKwhPerDay, peakUsageKwhPerDay, annualSavingsCents };
}

/**
 * The most batteries auto-sizing will ever put on a deal.
 *
 * The same ceiling the hand-typed count has always had, and here for the same
 * reason: a bad basis figure — a usage row entered in watt-hours, a production
 * model that ran away — must not quote a homeowner forty Powerwalls. A design
 * that hits the cap is a design somebody should look at, so the count stops at
 * a number a person can recognise as wrong rather than at whatever the division
 * produced.
 */
export const AUTO_BATTERY_MAX_QTY = 20;

export type AutoBatterySizing = {
  /** How many units cover the night. Never below 1, never above the cap. */
  qty: number;
  /** What the house is assumed to draw after dark, kWh. */
  nightKwhPerDay: number;
  /** What `qty` of this battery actually holds, kWh. */
  coveredKwh: number;
  /** True when the night load needed more units than the cap allows. */
  capped: boolean;
};

/**
 * How many batteries it takes to carry the house through the night.
 *
 *     night kWh/day = basisKwh ÷ 365 × nightSharePct
 *     qty           = ceil(night kWh/day ÷ the battery's usable kWh)
 *
 * ROUNDS UP, always. The question this answers is "is the night covered", and
 * 2.2 batteries is not an amount of storage anybody can install — two leaves
 * the last hours of the night on the grid. Rounding up over-serves by less than
 * one unit; rounding down under-serves by a promise the document has already
 * made.
 *
 * `basisKwh` is the year's PRODUCTION on a deal that has an array, and the
 * home's usage on one that does not — a storage-only deal makes no kilowatt
 * hours, and sizing it against zero would quote a single battery to every
 * house on the street. The caller decides which; see `resolveAutoBatteryQty`.
 *
 * NULL, NOT ZERO or one, whenever the arithmetic has nothing behind it: a
 * battery the catalogue has no capacity for, or a deal with neither production
 * nor usage on file yet. The caller then leaves the count exactly as it is,
 * which on a new deal is the company's `defaultBatteryQty` and on an existing
 * one is a real quote. Returning 1 here would silently halve a system every
 * time a figure went briefly missing.
 */
export function autoBatteryCount(input: {
  basisKwh: number | null | undefined;
  nightSharePct: number | null | undefined;
  /** Usable WATT-hours off the catalogue row — `SolarEquipment.ratingW`. */
  batteryRatingWh: number | null | undefined;
  maxQty?: number;
}): AutoBatterySizing | null {
  const { basisKwh, nightSharePct, batteryRatingWh } = input;
  if (!basisKwh || !(basisKwh > 0)) return null;
  if (!batteryRatingWh || !(batteryRatingWh > 0)) return null;
  // A share of zero is a company saying "the house draws nothing after dark",
  // which is not a sizing instruction — it is an unfilled field. Above 100 is
  // arithmetic nobody meant either.
  if (!nightSharePct || !(nightSharePct > 0) || nightSharePct > 100)
    return null;

  const nightKwhPerDay = (basisKwh / 365) * (nightSharePct / 100);
  const perUnitKwh = batteryRatingWh / 1000;
  const max = input.maxQty ?? AUTO_BATTERY_MAX_QTY;

  // The epsilon is for FLOATING POINT, not for tolerance. A night load that
  // divides exactly — 27 kWh across two 13.5 kWh units — arrives out of the
  // division as 2.0000000000000004, and a bare ceil sells a third battery on
  // the strength of the sixteenth decimal place. It is far too small to soften
  // the round-up rule: a need genuinely over a whole unit still costs one.
  const needed = Math.ceil(nightKwhPerDay / perUnitKwh - 1e-9);
  const qty = Math.min(max, Math.max(1, needed));

  return {
    qty,
    nightKwhPerDay,
    coveredKwh: perUnitKwh * qty,
    capped: needed > max,
  };
}
