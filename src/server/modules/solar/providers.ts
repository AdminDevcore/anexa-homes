import { prisma } from "@/server/db/client";
import type { SolarProviderKind } from "@prisma/client";
import type { ProviderTerms } from "@/lib/solar-provider-terms";
import { solarEquipmentLabel } from "@/lib/solar-equipment-label";
import { lenderProductLabel } from "@/lib/solar-lender-product";

export type ProviderOption = {
  id: string;
  name: string;
  active: boolean;
} & ProviderTerms;

/**
 * A company's provider list for one kind.
 *
 * `keepName` names a provider the current design already holds, and pulls it
 * back into the list even if it has been retired — the same rule the equipment
 * dropdowns follow, for the same reason: an option that vanishes from its own
 * select is how a save quietly writes null over a deal's data.
 *
 * `SolarProvider` is a SCOPED model, so callers outside a portal session must
 * wrap this in `runInVertical("solar", …)`.
 */
export async function listSolarProviders(
  companyId: string,
  kind: SolarProviderKind,
  keepName?: string | null
): Promise<ProviderOption[]> {
  const rows = await prisma.solarProvider.findMany({
    where: {
      companyId,
      kind,
      ...(keepName ? { OR: [{ active: true }, { name: keepName }] } : { active: true }),
    },
    orderBy: [{ position: "asc" }, { name: "asc" }],
    /**
     * The terms travel with the option.
     *
     * A rep picking a provider on the Energy step is exactly the moment the
     * question "do they buy back, is there anything for the battery?" comes up,
     * and a second query to answer it would be a second thing to forget on the
     * next screen that lists providers.
     */
    select: {
      id: true, name: true, active: true,
      buyback: true, buybackRateMills: true,
      touPeakRateMills: true, touOffPeakRateMills: true, touPeakWindow: true,
      vpp: true, vppProgramme: true, vppUpfrontCents: true, vppAnnualCents: true,
      vppMaxBatteries: true,
      vppFinanceProducts: true,
      notes: true,
      /**
       * The programme's conditions travel with it for the same reason its money
       * does: the rep reading "$500/yr" is the one who has to know it only runs
       * on some batteries, and a second query to find that out is a second thing
       * to forget on the next screen that lists providers.
       *
       * Retired items stay on the list. A battery the office has since stopped
       * selling is still a battery this programme enrols, and dropping it here
       * would silently shorten a list somebody deliberately wrote.
       */
      vppEquipment: {
        select: {
          equipment: { select: { id: true, manufacturer: true, model: true, ratingW: true } },
        },
      },
      vppProducts: {
        select: {
          product: {
            select: {
              id: true, name: true, product: true, aprPct: true, termMonths: true,
              dealerFeePct: true, leaseRateCentsPerKwMonth: true, rateMillsPerKwh: true,
              escalatorPct: true, termYears: true,
              lender: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  return rows.map(({ vppEquipment, vppProducts, ...r }) => ({
    ...r,
    vppBatteries: vppEquipment.map((e) => ({
      id: e.equipment.id,
      label: solarEquipmentLabel(e.equipment),
    })),
    // The lender's name leads: "25 yr · 4.99%" is a row on somebody's rate
    // sheet, and which somebody is the half a rep needs to act on it.
    vppProducts: vppProducts.map((p) => ({
      id: p.product.id,
      label: `${p.product.lender.name} ${lenderProductLabel(p.product)}`,
    })),
  }));
}
