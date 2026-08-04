import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { getActiveVertical } from "@/server/auth/vertical";
import { can } from "@/server/rbac/guards";
import { insuranceEnabled } from "@/lib/vertical-features";
import { isScopeReady } from "@/server/modules/scope/policies";
import { getClaimStatuses } from "@/server/modules/settings/queries";
import { updateClaimStatusesAction } from "@/server/modules/settings/actions";
import { PageHeader } from "@/components/portal/ui";
import { ClaimStatusSettings } from "@/components/portal/claim-status-settings";

export const metadata = { title: "Claim Statuses" };

export default async function ClaimStatusesSettingsPage() {
  const user = await requireUser("/portal/settings/claim-statuses");
  if (!can(user, "update", "Settings")) redirect("/portal/settings");

  const vertical = await getActiveVertical(user);
  // A carrier claim is an insurance-restoration concept. Solar has no adjuster
  // and its deal page never renders a claim status, so the page has nothing to
  // configure there — the hub hides the card, and this is the direct-URL guard.
  if (!insuranceEnabled(vertical)) redirect("/portal/settings");

  const [statuses, counts] = await Promise.all([
    getClaimStatuses(user.companyId, vertical),
    // How many live deals sit on each status — the number an admin needs before
    // deleting one, since those deals keep the value they already have.
    prisma.lead.groupBy({
      by: ["claimStatus"],
      where: { companyId: user.companyId, vertical },
      _count: { _all: true },
    }),
  ]);
  const byStatus = new Map(counts.map((c) => [c.claimStatus, c._count._all]));

  return (
    <div className="space-y-6">
      <Link
        href="/portal/settings"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to settings
      </Link>
      <PageHeader
        title="Claim Statuses"
        description="Customize the insurance claim statuses on the deal Summary, and their order."
      />
      <ClaimStatusSettings
        items={statuses.map((s) => ({
          ...s,
          inUse: byStatus.get(s.key) ?? 0,
          unlocksScope: isScopeReady(s.key),
        }))}
        save={updateClaimStatusesAction}
      />
      <p className="max-w-2xl text-sm text-muted-foreground">
        Renaming a status keeps every deal already on it — including the ones that open the Scope of
        Work tab. Deleting one leaves those deals showing it until someone picks a new status.
      </p>
    </div>
  );
}
