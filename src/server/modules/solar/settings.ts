import { prisma } from "@/server/db/client";
import type { SolarAssumptions } from "@/lib/solar-money";
import {
  CREDIT_DISCLAIMER_DEFAULT,
  CREDIT_INCENTIVE_LABEL_DEFAULT,
  CREDIT_RATES_DEFAULT,
  type CreditRates,
} from "@/lib/solar-credit-ladder";

/**
 * Solar assumptions for a company.
 *
 * Every number here is DATA, deliberately, so a quote can move without a
 * deploy. No incentive is among them: these are the physics and the pricing.
 * The federal credits live below, in their own block, and are quoted on ONE
 * structure only — see `SolarSettingsView.credit*`.
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
  /// The federal credits, for the "what you actually pay" ladder.
  ///
  /// STATUTE, which is why they are data: the base credit has already stepped
  /// down twice and both bonuses were invented in 2022. Not SolarAssumptions —
  /// they reach no pricing calculation at all. They decide what the credit
  /// ladder on the cost chapter is worked out with, and nothing else.
  creditRates: CreditRates;
  /// What the remainder between the after-credit figure and the quoted price
  /// is CALLED. The figure itself is always derived; see solar-credit-ladder.
  creditIncentiveLabel: string;
  /// The tax caveat printed under the ladder. Never empty.
  creditDisclaimer: string;
};

/// What a company that has never opened the settings page quotes: the statute
/// as it stands. Mirrors the column defaults, for the reason DEFAULT_BATTERY_QTY
/// gives — a company with no row and a company with an untouched one are the
/// same company.
export const CREDIT_DEFAULTS = {
  creditRates: CREDIT_RATES_DEFAULT,
  creditIncentiveLabel: CREDIT_INCENTIVE_LABEL_DEFAULT,
  creditDisclaimer: CREDIT_DISCLAIMER_DEFAULT,
} as const;

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
      ...CREDIT_DEFAULTS,
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
    targetNetPpwCents: row.targetNetPpwCents,
    homeValueUpliftPct: row.homeValueUpliftPct,
    defaultBatteryQty: row.defaultBatteryQty,
    touPeakSharePct: row.touPeakSharePct,
    touCyclesPerDay: row.touCyclesPerDay,
    touRoundTripEfficiency: row.touRoundTripEfficiency,
    creditRates: {
      itcPct: row.creditItcPct,
      energyCommunityPct: row.creditEnergyCommunityPct,
      domesticContentPct: row.creditDomesticContentPct,
    },
    creditIncentiveLabel: row.creditIncentiveLabel,
    creditDisclaimer: row.creditDisclaimer,
  };
}
