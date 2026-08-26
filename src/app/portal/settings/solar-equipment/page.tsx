import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { getActiveVertical } from "@/server/auth/vertical";
import { can } from "@/server/rbac/guards";
import { PageHeader } from "@/components/portal/ui";
import { prisma } from "@/server/db/client";
import { SolarEquipmentManager } from "@/components/portal/solar-equipment-manager";
import { SolarAdderCatalogue } from "@/components/portal/solar-adder-catalogue";
import { catalogueBasis } from "@/server/modules/solar/adders";

export const dynamic = "force-dynamic";

export default async function SolarEquipmentPage() {
  const user = await requireUser("/portal/settings/solar-equipment");
  if (!can(user, "read", "Settings")) redirect("/portal/dashboard");
  if ((await getActiveVertical(user)) !== "solar") redirect("/portal/settings");

  const lenders = await prisma.solarLender.findMany({
    where: { companyId: user.companyId },
    orderBy: [{ isActive: "desc" }, { rank: "asc" }, { name: "asc" }],
    select: { id: true, name: true, isActive: true, rank: true, notes: true },
  });

  const items = await prisma.solarEquipment.findMany({
    where: { companyId: user.companyId },
    // Sellable first, then newest AVL year, so the current list leads.
    orderBy: [{ kind: "asc" }, { isActive: "desc" }, { avlYear: "desc" }, { rank: "asc" }, { model: "asc" }],
    include: { lenderApprovals: { select: { lenderId: true } } },
  });

  return (
    <div className="space-y-6">
      <Link
        href="/portal/settings"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to settings
      </Link>
      <PageHeader
        title="Solar Equipment"
        description="What reps can pick from when they build a system. Adders are rank-ordered, so the ones you want sold lead."
      />
      <SolarEquipmentManager
        canEdit={can(user, "update", "Settings")}
        lenders={lenders}
        items={items
          .filter((i) => i.kind !== "adder")
          .map((i) => ({
            id: i.id,
            kind: i.kind,
            manufacturer: i.manufacturer,
            model: i.model,
            ratingW: i.ratingW,
            costCents: i.costCents,
            priceCents: i.priceCents,
            isActive: i.isActive,
            isDefault: i.isDefault,
            avlYear: i.avlYear,
            lenderIds: i.lenderApprovals.map((a) => a.lenderId),
            // The serving route, cache-busted on the photo's own timestamp, so
            // replacing a product shot shows the new one immediately instead of
            // whatever the browser kept. Null when there is no photo — the
            // manager renders an upload control rather than a broken frame.
            photoUrl: i.photoKey
              ? `/api/solar/equipment-photo?equipment=${i.id}&v=${(i.photoUpdatedAt ?? new Date()).getTime()}`
              : null,
          }))}
      />
      {/* Adders are their own list: a priced rule rather than a product, and
          ordered by hand because that order is the order a rep is offered
          them. Sorted by rank here — sellable first — so the arrows on the
          rows move things where the picker will show them. */}
      <SolarAdderCatalogue
        canEdit={can(user, "update", "Settings")}
        items={items
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
            rank: i.rank,
            isActive: i.isActive,
          }))}
      />
    </div>
  );
}
