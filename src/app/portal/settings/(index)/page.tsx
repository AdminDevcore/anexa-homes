import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { getActiveVertical } from "@/server/auth/vertical";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { PageHeader } from "@/components/portal/ui";
import { SettingsOverview } from "@/components/portal/settings-overview";
import {
  settingsInventoryCached,
  workspaceSetupGapsCached,
} from "@/server/modules/settings/cached";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser();
  if (!can(user, "read", "Settings")) redirect("/portal/dashboard");
  const vertical = await getActiveVertical(user);

  // Only an admin can act on a gap, so only an admin is shown one. The counts
  // are for everyone who can read Settings — they say nothing a reader could not
  // learn by opening the page itself.
  const [gaps, inventory] = await Promise.all([
    can(user, "update", "Settings") ? workspaceSetupGapsCached(user.companyId, vertical) : [],
    settingsInventoryCached(user.companyId, vertical),
  ]);

  // Users is a company-wide count on purpose — one legal entity, one roster.
  // Pipelines and document templates used to sit beside it and were wrong twice
  // over: a nested `_count` on Company is a relation count the isolation
  // extension never sees, so they reported both workspaces at once.
  const company = await prisma.company.findUnique({
    where: { id: user.companyId },
    select: { name: true, _count: { select: { users: true } } },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="What is set up in this workspace, and what still needs you. Every section is in the menu on the left."
      />
      <SettingsOverview
        vertical={vertical}
        inventory={inventory}
        gaps={gaps}
        company={{
          name: company?.name ?? "your workspace",
          userCount: company?._count.users ?? 0,
        }}
      />
    </div>
  );
}
