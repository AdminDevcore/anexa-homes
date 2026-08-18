import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { getActiveVertical } from "@/server/auth/vertical";
import { can } from "@/server/rbac/guards";
import { PageHeader } from "@/components/portal/ui";
import { prisma } from "@/server/db/client";
import { SolarEquipmentManager } from "@/components/portal/solar-equipment-manager";

export const dynamic = "force-dynamic";

export default async function SolarEquipmentPage() {
  const user = await requireUser("/portal/settings/solar-equipment");
  if (!can(user, "read", "Settings")) redirect("/portal/dashboard");
  if ((await getActiveVertical(user)) !== "solar") redirect("/portal/settings");

  const items = await prisma.solarEquipment.findMany({
    where: { companyId: user.companyId },
    orderBy: [{ kind: "asc" }, { rank: "asc" }, { model: "asc" }],
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
        items={items.map((i) => ({
          id: i.id,
          kind: i.kind,
          manufacturer: i.manufacturer,
          model: i.model,
          ratingW: i.ratingW,
          costCents: i.costCents,
          priceCents: i.priceCents,
          rank: i.rank,
          crossoverKind: i.crossoverKind,
          isActive: i.isActive,
          isDefault: i.isDefault,
        }))}
      />
    </div>
  );
}
