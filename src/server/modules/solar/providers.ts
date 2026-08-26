import { prisma } from "@/server/db/client";
import type { SolarProviderKind } from "@prisma/client";
import type { ProviderTerms } from "@/lib/solar-provider-terms";

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
      vpp: true, vppProgramme: true, vppUpfrontCents: true, vppAnnualCents: true,
      notes: true,
    },
  });
  return rows;
}
