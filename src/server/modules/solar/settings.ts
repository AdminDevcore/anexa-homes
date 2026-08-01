import { prisma } from "@/server/db/client";
import type { SolarAssumptions } from "@/lib/solar-money";

/**
 * Solar assumptions for a company.
 *
 * Every number here is DATA, deliberately. The federal residential-solar credit
 * changed in 2025 and is still moving, so no percentage is baked into code —
 * the company's CPA sets it in Solar Settings and can change it without a
 * deploy. `federalItcPct` defaults to NULL, meaning "show no federal credit at
 * all", so an unconfigured tenant cannot accidentally quote a stale rate.
 */
export const SOLAR_ASSUMPTION_DEFAULTS: SolarAssumptions = {
  derateFactor: 0.84,
  annualDegradationPct: 0.5,
  utilityEscalationPct: 3.5,
  kwhPerKwYear: 1450,
  defaultGrossPpwCents: 350,
  defaultDealerFeePct: 18,
  federalItcPct: null, // unset on purpose — see above
  minOffsetPct: 0,
  maxOffsetPct: 150,
  minPpwCents: 150,
  maxPpwCents: 800,
};

export type SolarSettingsView = SolarAssumptions & {
  stateIncentiveNote: string | null;
  incentiveDisclaimer: string;
};

export async function getSolarSettings(companyId: string): Promise<SolarSettingsView> {
  const row = await prisma.solarSettings.findUnique({ where: { companyId } });
  if (!row) {
    return {
      ...SOLAR_ASSUMPTION_DEFAULTS,
      stateIncentiveNote: null,
      incentiveDisclaimer:
        "Estimated only and not a guarantee. Tax credits depend on your individual tax situation and on rules that may change. Consult your tax advisor.",
    };
  }
  return {
    derateFactor: row.derateFactor,
    annualDegradationPct: row.annualDegradationPct,
    utilityEscalationPct: row.utilityEscalationPct,
    kwhPerKwYear: row.kwhPerKwYear,
    defaultGrossPpwCents: row.defaultGrossPpwCents,
    defaultDealerFeePct: row.defaultDealerFeePct,
    federalItcPct: row.federalItcPct,
    minOffsetPct: row.minOffsetPct,
    maxOffsetPct: row.maxOffsetPct,
    minPpwCents: row.minPpwCents,
    maxPpwCents: row.maxPpwCents,
    stateIncentiveNote: row.stateIncentiveNote,
    incentiveDisclaimer: row.incentiveDisclaimer,
  };
}
