import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { getActiveVertical } from "@/server/auth/vertical";
import { can } from "@/server/rbac/guards";
import { SettingsScreenHeader } from "@/components/portal/settings-kit/screen-header";
import { prisma } from "@/server/db/client";
import { SolarProviderManager } from "@/components/portal/solar-provider-manager";
import { solarEquipmentLabel } from "@/lib/solar-equipment-label";
import { lenderProductLabel } from "@/lib/solar-lender-product";

export const dynamic = "force-dynamic";

export const metadata = { title: "Energy providers" };

/**
 * The utilities and retail electric providers a company sells against.
 *
 * Two lists rather than one, because they are two different companies in a
 * deregulated market: the utility delivers the power and owns the meter, the
 * retailer bills for it. A proposal that names the wrong one is wrong on the
 * customer's own document.
 *
 * Maintained here rather than typed per deal so that "Oncor" is spelled the
 * same way on every proposal — the previous free-text field is how a production
 * deal ended up naming "ZZ TEST UTILITY - DO NOT USE".
 */
export default async function SolarProvidersPage({
  searchParams,
}: {
  /**
   * Which provider is open, and on which tab.
   *
   * Read HERE rather than in the browser: the panel keeps it in the URL so a
   * reload comes back where you were, and a client that reads
   * `window.location` while hydrating renders a provider the server never
   * sent — which React reports as a hydration mismatch and repairs by throwing
   * the server's markup away.
   */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
  const user = await requireUser("/portal/settings/solar-providers");
  if (!can(user, "read", "Settings")) redirect("/portal/dashboard");
  if ((await getActiveVertical(user)) !== "solar") redirect("/portal/settings");

  const rows = await prisma.solarProvider.findMany({
    where: { companyId: user.companyId },
    orderBy: [{ active: "desc" }, { position: "asc" }, { name: "asc" }],
    select: {
      id: true, name: true, active: true, position: true, kind: true,
      // What the office has confirmed each provider does for a solar customer.
      buyback: true, buybackRateMills: true,
      touPeakRateMills: true, touOffPeakRateMills: true, touPeakWindow: true,
      vpp: true, vppProgramme: true, vppUpfrontCents: true, vppAnnualCents: true,
      vppMaxBatteries: true,
      vppFinanceProducts: true,
      notes: true,
      // Who each programme is open to, with the names spelled out: a retired
      // battery still on a list has to stay tickable, and the picker can only
      // offer it back if this row says what it was called.
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

  /**
   * What the pickers choose from.
   *
   * ACTIVE items only. A retired battery already on a programme's list stays on
   * it — the ids above are the record — but it is not something to newly add to
   * one, and putting last year's catalogue back in front of the office is how a
   * discontinued product gets ticked onto next year's programme.
   */
  const [batteries, lenderProducts] = await Promise.all([
    prisma.solarEquipment.findMany({
      where: { companyId: user.companyId, kind: "battery", isActive: true },
      orderBy: [{ manufacturer: "asc" }, { model: "asc" }],
      select: { id: true, manufacturer: true, model: true, ratingW: true },
    }),
    prisma.solarLenderProduct.findMany({
      where: { companyId: user.companyId, isActive: true, lender: { isActive: true } },
      orderBy: [{ lender: { rank: "asc" } }, { rank: "asc" }],
      select: {
        id: true, name: true, product: true, aprPct: true, termMonths: true,
        dealerFeePct: true, leaseRateCentsPerKwMonth: true, rateMillsPerKwh: true,
        escalatorPct: true, termYears: true,
        lender: { select: { name: true } },
      },
    }),
  ]);

  const batteryOptions = batteries.map((b) => ({ id: b.id, label: solarEquipmentLabel(b) }));
  const productOptions = lenderProducts.map((p) => ({
    id: p.id,
    lender: p.lender.name,
    label: lenderProductLabel(p),
  }));

  const providers = rows.map(({ vppEquipment, vppProducts, ...r }) => ({
    ...r,
    vppBatteries: vppEquipment.map((e) => ({
      id: e.equipment.id,
      label: solarEquipmentLabel(e.equipment),
    })),
    vppProducts: vppProducts.map((p) => ({
      id: p.product.id,
      label: `${p.product.lender.name} ${lenderProductLabel(p.product)}`,
    })),
  }));

  return (
    <div className="space-y-6">
      <SettingsScreenHeader
        section="solar_providers"
        description="The utilities and retail providers your reps pick from on the Energy step."
      />

      <SolarProviderManager
        utilities={providers.filter((r) => r.kind === "utility")}
        retailers={providers.filter((r) => r.kind === "retail")}
        batteries={batteryOptions}
        lenderProducts={productOptions}
        canEdit={can(user, "update", "Settings")}
        initialProviderId={one(params.provider)}
        initialTab={one(params.tab)}
      />
    </div>
  );
}
