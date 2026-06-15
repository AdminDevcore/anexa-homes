import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { getLeadSourcesForSettings } from "@/server/modules/settings/queries";
import { PageHeader } from "@/components/portal/ui";
import { LeadSourcesManager } from "@/components/portal/lead-sources-manager";

export const metadata = { title: "Lead Sources" };

export default async function LeadSourcesSettingsPage() {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) redirect("/portal/settings");

  const items = await getLeadSourcesForSettings(user.companyId);

  return (
    <div className="space-y-6">
      <Link href="/portal/settings" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to settings
      </Link>
      <PageHeader
        title="Lead Sources"
        description="Customize the “Source” options reps choose when booking a lead — add, rename, reorder, or retire channels."
      />
      <LeadSourcesManager items={items} />
    </div>
  );
}
