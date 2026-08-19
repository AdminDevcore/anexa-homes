import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { getActiveVertical } from "@/server/auth/vertical";
import { can } from "@/server/rbac/guards";
import { PageHeader } from "@/components/portal/ui";
import { prisma } from "@/server/db/client";
import { getSolarSettings } from "@/server/modules/solar/settings";
import { SolarLenderManager } from "@/components/portal/solar-lender-manager";

export const dynamic = "force-dynamic";

/**
 * Lenders and their approved-vendor lists.
 *
 * Its own page rather than a section on Solar Equipment: a lender is a
 * relationship with its own terms, not a property of the catalogue, and the
 * list of who finances your deals is something an admin comes looking for
 * directly rather than by way of the panels.
 */
export default async function SolarLendersPage() {
  const user = await requireUser("/portal/settings/solar-lenders");
  if (!can(user, "read", "Settings")) redirect("/portal/dashboard");
  if ((await getActiveVertical(user)) !== "solar") redirect("/portal/settings");

  const lenders = await prisma.solarLender.findMany({
    where: { companyId: user.companyId },
    orderBy: [{ isActive: "desc" }, { rank: "asc" }, { name: "asc" }],
    select: {
      id: true, name: true, isActive: true, rank: true, notes: true,
      _count: { select: { approvals: true, designs: true } },
      products: {
        orderBy: [{ isActive: "desc" }, { product: "asc" }, { rank: "asc" }, { createdAt: "asc" }],
      },
    },
  });

  const settings = await getSolarSettings(user.companyId);

  // How much of the catalogue each lender covers. A lender approving nothing is
  // a lender whose deals will show empty equipment lists, which is worth seeing
  // here rather than discovering on a deal.
  const catalogue = await prisma.solarEquipment.groupBy({
    by: ["kind"],
    where: { companyId: user.companyId, isActive: true },
    _count: { _all: true },
  });
  const sellable = catalogue.reduce((n, c) => n + c._count._all, 0);

  return (
    <div className="space-y-6">
      <Link
        href="/portal/settings"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to settings
      </Link>
      <PageHeader
        title="Lenders"
        description="Who finances your deals, which equipment each one approves, and the terms they finance on. Pick a lender on a deal and the equipment narrows to its approved-vendor list; pick one of its products and the payment is quoted from it."
      />
      <SolarLenderManager
        canEdit={can(user, "update", "Settings")}
        sellableEquipment={sellable}
        targetNetPpwCents={settings.targetNetPpwCents}
        lenders={lenders.map((l) => ({
          id: l.id,
          name: l.name,
          isActive: l.isActive,
          rank: l.rank,
          notes: l.notes,
          approvedCount: l._count.approvals,
          dealCount: l._count.designs,
          products: l.products.map((p) => ({
            id: p.id,
            lenderId: p.lenderId,
            product: p.product,
            name: p.name,
            aprPct: p.aprPct,
            termMonths: p.termMonths,
            dealerFeePct: p.dealerFeePct,
            leaseRateCentsPerKwMonth: p.leaseRateCentsPerKwMonth,
            rateMillsPerKwh: p.rateMillsPerKwh,
            escalatorPct: p.escalatorPct,
            termYears: p.termYears,
            isActive: p.isActive,
          })),
        }))}
      />
    </div>
  );
}
