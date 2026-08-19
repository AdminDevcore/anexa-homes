import { prisma } from "@/server/db/client";
import type { SolarProviderKind } from "@prisma/client";

export type ProviderOption = { id: string; name: string; active: boolean };

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
    select: { id: true, name: true, active: true },
  });
  return rows;
}
