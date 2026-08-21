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
  defaultGrossPpwCents: 350,
  defaultDealerFeePct: 18,
  minOffsetPct: 0,
  maxOffsetPct: 150,
  minPpwCents: 150,
  maxPpwCents: 800,
};

export type SolarSettingsView = SolarAssumptions & {
  /// The utility's programme, company-wide. See the schema comment: it is set
  /// by the utility rather than by the house, so it is one value here instead
  /// of one retyped onto every design.
  netMeteringProgram: string | null;
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
};

export async function getSolarSettings(companyId: string): Promise<SolarSettingsView> {
  const row = await prisma.solarSettings.findUnique({ where: { companyId } });
  if (!row) {
    return {
      ...SOLAR_ASSUMPTION_DEFAULTS,
      netMeteringProgram: null,
      targetNetPpwCents: null,
      homeValueUpliftPct: 0,
    };
  }
  return {
    derateFactor: row.derateFactor,
    annualDegradationPct: row.annualDegradationPct,
    utilityEscalationPct: row.utilityEscalationPct,
    kwhPerKwYear: row.kwhPerKwYear,
    defaultGrossPpwCents: row.defaultGrossPpwCents,
    defaultDealerFeePct: row.defaultDealerFeePct,
    minOffsetPct: row.minOffsetPct,
    maxOffsetPct: row.maxOffsetPct,
    minPpwCents: row.minPpwCents,
    maxPpwCents: row.maxPpwCents,
    netMeteringProgram: row.netMeteringProgram,
    targetNetPpwCents: row.targetNetPpwCents,
    homeValueUpliftPct: row.homeValueUpliftPct,
  };
}
