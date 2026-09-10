import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { getActiveVertical } from "@/server/auth/vertical";
import { can } from "@/server/rbac/guards";
import { SettingsScreenHeader } from "@/components/portal/settings-kit/screen-header";
import { prisma } from "@/server/db/client";
import { SolarEquipmentManager } from "@/components/portal/solar-equipment-manager";
import { catalogueBasis } from "@/server/modules/solar/adders";
import { getSolarSettings } from "@/server/modules/solar/settings";

export const dynamic = "force-dynamic";

export default async function SolarEquipmentPage({
  searchParams,
}: {
  /**
   * Which catalogue item is open, and on which tab.
   *
   * Read HERE rather than in the browser: the panel keeps it in the URL so a
   * reload comes back where you were, and a client that reads
   * `window.location` while hydrating renders an item the server never sent —
   * which React reports as a hydration mismatch and repairs by throwing the
   * server's markup away.
   */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
  const user = await requireUser("/portal/settings/solar-equipment");
  if (!can(user, "read", "Settings")) redirect("/portal/dashboard");
  if ((await getActiveVertical(user)) !== "solar") redirect("/portal/settings");

  const lenders = await prisma.solarLender.findMany({
    where: { companyId: user.companyId },
    orderBy: [{ isActive: "desc" }, { rank: "asc" }, { name: "asc" }],
    select: { id: true, name: true, isActive: true, rank: true, notes: true },
  });

  // For the defaults panel: how many batteries a storage deal starts with. It
  // used to live two screens away under Solar Settings, which is why nobody
  // found it — it is a fact about the battery you standardised on, so it now
  // sits beside the field that names it.
  const settings = await getSolarSettings(user.companyId);

  const items = await prisma.solarEquipment.findMany({
    where: { companyId: user.companyId },
    // Sellable first, then newest AVL year, so the current list leads.
    orderBy: [{ kind: "asc" }, { isActive: "desc" }, { avlYear: "desc" }, { rank: "asc" }, { model: "asc" }],
    include: { lenderApprovals: { select: { lenderId: true } } },
  });

  return (
    <div className="space-y-6">
      <SettingsScreenHeader
        section="solar_equipment"
        description="What reps can pick from when they build a system, and what a new design starts on. Adders are rank-ordered, so the ones you want sold lead."
      />
      <SolarEquipmentManager
        canEdit={can(user, "update", "Settings")}
        lenders={lenders}
        defaultBatteryQty={settings.defaultBatteryQty}
        autoBatteryQty={settings.autoBatteryQty}
        batteryNightSharePct={settings.batteryNightSharePct}
        initialItemId={one(params.item)}
        initialTab={one(params.tab)}
        items={items
          .filter((i) => i.kind !== "adder")
          .map((i) => ({
            id: i.id,
            kind: i.kind,
            manufacturer: i.manufacturer,
            model: i.model,
            ratingW: i.ratingW,
            widthMm: i.widthMm,
            heightMm: i.heightMm,
            costCents: i.costCents,
            priceCents: i.priceCents,
            isActive: i.isActive,
            isDefault: i.isDefault,
            avlYear: i.avlYear,
            specSheetUrl: i.specSheetUrl,
            lenderIds: i.lenderApprovals.map((a) => a.lenderId),
            // The serving route, cache-busted on the photo's own timestamp, so
            // replacing a product shot shows the new one immediately instead of
            // whatever the browser kept. Null when there is no photo — the
            // panel renders an upload control rather than a broken frame.
            photoUrl: i.photoKey
              ? `/api/solar/equipment-photo?equipment=${i.id}&v=${(i.photoUpdatedAt ?? new Date()).getTime()}`
              : null,
          }))}
        // Adders are their own group in the rail: a priced rule rather than a
        // product, ordered by hand because that order is the order a rep is
        // offered them. Sorted by rank here — sellable first — so the arrows on
        // the panel move things where the picker will show them.
        adders={items
          .filter((i) => i.kind === "adder")
          .sort((a, b) =>
            a.isActive === b.isActive
              ? a.rank - b.rank || a.model.localeCompare(b.model)
              : Number(b.isActive) - Number(a.isActive)
          )
          .map((i) => ({
            id: i.id,
            label: [i.manufacturer, i.model].filter(Boolean).join(" ") || i.model,
            description: i.description,
            basis: catalogueBasis(i),
            priceCents: i.priceCents,
            priceMillsPerWatt: i.priceMillsPerWatt,
            costCents: i.costCents,
            autoApplyMinKw: i.autoApplyMinKw,
            autoApplyMaxKw: i.autoApplyMaxKw,
            financedOnTop: i.financedOnTop,
            rank: i.rank,
            isActive: i.isActive,
          }))}
      />
    </div>
  );
}
