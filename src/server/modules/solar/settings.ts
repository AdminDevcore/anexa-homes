import { prisma } from "@/server/db/client";
import type { SolarAssumptions } from "@/lib/solar-money";

/**
 * Solar assumptions for a company.
 *
 * Every number here is DATA, deliberately, so a quote can move without a
 * deploy. There is no incentive among them: no federal, state or local credit
 * is configurable, quoted or printed anywhere in the solar product.
 */
export const SOLAR_ASSUMPTION_DEFAULTS: SolarAssumptions = {
  derateFactor: 0.84,
  annualDegradationPct: 0.5,
  utilityEscalationPct: 3.5,
  kwhPerKwYear: 1450,
  utilityMeterFeeCents: 1000,
  defaultGrossPpwCents: 350,
  defaultDealerFeePct: 18,
  minOffsetPct: 0,
  maxOffsetPct: 150,
  minPpwCents: 150,
  maxPpwCents: 800,
};

export type SolarSettingsView = SolarAssumptions & {
  /// What the company must keep per watt after the lender's cut, cents.
  ///
  /// NOT part of SolarAssumptions: those are the physics-and-pricing inputs
  /// every pure calculation shares, and this one only ever reaches the sticker
  /// price. Null — the default — means derive nothing and leave gross as typed.
  targetNetPpwCents: number | null;
  /// What the company claims an owned system adds to a home's value, %.
  ///
  /// Also not part of SolarAssumptions: it reaches no calculation at all. It is
  /// a claim the DOCUMENT makes, and a claim needs an owner — zero, the
  /// default, means the company makes none and the card is omitted rather than
  /// printed as "0%".
  homeValueUpliftPct: number;
  /// How many batteries a design starts with once a rep picks one.
  ///
  /// Not a SolarAssumption either: it reaches no calculation. It decides what
  /// gets WRITTEN on a design the first time a battery lands on it, and from
  /// there the ordinary equipment figures follow.
  defaultBatteryQty: number;
  /// What a battery is assumed to shift, and what it loses doing it.
  ///
  /// NOT SolarAssumptions either, because those are the array's: degradation,
  /// yield, escalation. These reach exactly one calculation — `touSavings` —
  /// and are frozen onto a storage snapshot beside the figure they produced.
  ///
  /// `touPeakSharePct` is the softest number in a storage quote: it is
  /// modelled, not measured, which is why it is a company decision listed on
  /// the customer's document rather than a constant nobody can see.
  touPeakSharePct: number;
  touCyclesPerDay: number;
  touRoundTripEfficiency: number;
};

/// What a company that has never opened the settings page assumes about a
/// battery. Mirrors the column defaults in the schema, for the same reason
/// DEFAULT_BATTERY_QTY does.
export const TOU_DEFAULTS = {
  touPeakSharePct: 30,
  touCyclesPerDay: 1,
  touRoundTripEfficiency: 90,
} as const;

/// What a company that has never opened the settings page sells: two batteries,
/// this company's standard offer. Mirrors the column default in the schema —
/// the two have to agree, because a company with no settings row and a company
/// with an untouched one are the same company.
export const DEFAULT_BATTERY_QTY = 2;

export async function getSolarSettings(companyId: string): Promise<SolarSettingsView> {
  const row = await prisma.solarSettings.findUnique({ where: { companyId } });
  if (!row) {
    return {
      ...SOLAR_ASSUMPTION_DEFAULTS,
      targetNetPpwCents: null,
      homeValueUpliftPct: 0,
      defaultBatteryQty: DEFAULT_BATTERY_QTY,
      ...TOU_DEFAULTS,
    };
  }
  return {
    derateFactor: row.derateFactor,
    annualDegradationPct: row.annualDegradationPct,
    utilityEscalationPct: row.utilityEscalationPct,
    kwhPerKwYear: row.kwhPerKwYear,
    utilityMeterFeeCents: row.utilityMeterFeeCents,
    defaultGrossPpwCents: row.defaultGrossPpwCents,
    defaultDealerFeePct: row.defaultDealerFeePct,
    minOffsetPct: row.minOffsetPct,
    maxOffsetPct: row.maxOffsetPct,
    minPpwCents: row.minPpwCents,
    maxPpwCents: row.maxPpwCents,
    targetNetPpwCents: row.targetNetPpwCents,
    homeValueUpliftPct: row.homeValueUpliftPct,
    defaultBatteryQty: row.defaultBatteryQty,
    touPeakSharePct: row.touPeakSharePct,
    touCyclesPerDay: row.touCyclesPerDay,
    touRoundTripEfficiency: row.touRoundTripEfficiency,
  };
}
