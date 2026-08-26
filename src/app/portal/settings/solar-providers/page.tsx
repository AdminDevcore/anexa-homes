import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { getActiveVertical } from "@/server/auth/vertical";
import { can } from "@/server/rbac/guards";
import { PageHeader } from "@/components/portal/ui";
import { prisma } from "@/server/db/client";
import { SolarProviderManager } from "@/components/portal/solar-provider-manager";

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
export default async function SolarProvidersPage() {
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
      vpp: true, vppProgramme: true, vppUpfrontCents: true, vppAnnualCents: true,
      notes: true,
    },
  });

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <Link
        href="/portal/settings"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to settings
      </Link>

      <PageHeader
        title="Energy providers"
        description="The utilities and retail providers your reps pick from on the Energy step."
      />

      <div className="mt-6">
        <SolarProviderManager
          utilities={rows.filter((r) => r.kind === "utility")}
          retailers={rows.filter((r) => r.kind === "retail")}
          canEdit={can(user, "update", "Settings")}
        />
      </div>
    </div>
  );
}
