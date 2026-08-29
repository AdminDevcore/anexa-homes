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
import { lenderLogoUrl } from "@/lib/lender-mark";
import { adderRateLabel, catalogueBasis } from "@/lib/solar-adders";

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
      id: true, name: true, isActive: true, rank: true, notes: true, repPayMode: true,
      portalUrl: true, applyUrl: true, creditInstructions: true,
      logoUpdatedAt: true, maxFinalPpwCents: true, minBasePpwCents: true,
      finalPpwMode: true,
      minBasePricePerBatteryCents: true, maxFinalPricePerBatteryCents: true,
      finalBatteryPriceMode: true,
      batteryRule: true,
      /// What this partner does with each adder, where it has overruled the
      /// catalogue. Absent ids fall back to the catalogue's own answer.
      adderRules: { select: { equipmentId: true, financedOnTop: true } },
      _count: { select: { approvals: true, designs: true } },
      products: {
        orderBy: [{ isActive: "desc" }, { product: "asc" }, { rank: "asc" }, { createdAt: "asc" }],
      },
    },
  });

  const settings = await getSolarSettings(user.companyId);

  // The extra work the company sells, so each lender can say which of it rides
  // on top of its own $/W. Sellable rows only — a retired adder is not being
  // quoted, so a rule about it is a rule about nothing.
  const adders = await prisma.solarEquipment.findMany({
    where: { companyId: user.companyId, kind: "adder", isActive: true },
    orderBy: [{ rank: "asc" }, { model: "asc" }],
    select: {
      id: true, manufacturer: true, model: true, description: true,
      adderBasis: true, priceCents: true, priceMillsPerWatt: true,
      financedOnTop: true,
    },
  });

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
        adderCatalogue={adders.map((a) => ({
          id: a.id,
          label: [a.manufacturer, a.model].filter(Boolean).join(" ") || a.model,
          description: a.description,
          rateLabel: adderRateLabel({
            basis: catalogueBasis(a),
            flatCents: a.priceCents,
            millsPerWatt: a.priceMillsPerWatt,
          }),
          catalogueOnTop: a.financedOnTop,
        }))}
        lenders={lenders.map((l) => ({
          id: l.id,
          name: l.name,
          isActive: l.isActive,
          rank: l.rank,
          notes: l.notes,
          portalUrl: l.portalUrl,
          applyUrl: l.applyUrl,
          creditInstructions: l.creditInstructions,
          repPayMode: l.repPayMode,
          maxFinalPpwCents: l.maxFinalPpwCents,
          finalPpwMode: l.finalPpwMode,
          minBasePpwCents: l.minBasePpwCents,
          minBasePricePerBatteryCents: l.minBasePricePerBatteryCents,
          maxFinalPricePerBatteryCents: l.maxFinalPricePerBatteryCents,
          finalBatteryPriceMode: l.finalBatteryPriceMode,
          batteryRule: l.batteryRule,
          adderRules: Object.fromEntries(
            l.adderRules.map((r) => [r.equipmentId, r.financedOnTop])
          ),
          logoUrl: lenderLogoUrl(l.id, l.logoUpdatedAt),
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
            financesStorageOnly: p.financesStorageOnly,
            rateMillsPerKwh: p.rateMillsPerKwh,
            escalatorPct: p.escalatorPct,
            termYears: p.termYears,
            factorWithPaydownMicros: p.factorWithPaydownMicros,
            factorWithoutPaydownMicros: p.factorWithoutPaydownMicros,
            paydownPct: p.paydownPct,
            paydownMonths: p.paydownMonths,
            isActive: p.isActive,
          })),
        }))}
      />
    </div>
  );
}
