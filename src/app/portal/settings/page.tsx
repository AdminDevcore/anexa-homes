import { redirect } from "next/navigation";
import Link from "next/link";
import { Building2, Users } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { getActiveVertical } from "@/server/auth/vertical";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { PageHeader } from "@/components/portal/ui";
import { SettingsHub } from "@/components/portal/settings-hub";
import { VERTICAL_ACCENT, VERTICAL_LABEL } from "@/lib/vertical";
import { workspaceSetupGaps } from "@/server/modules/settings/workspace-health";
import { settingsInventory } from "@/server/modules/settings/inventory";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser();
  if (!can(user, "read", "Settings")) redirect("/portal/dashboard");
  const vertical = await getActiveVertical(user);

  // Only an admin can act on a gap, so only an admin is shown one. The counts
  // are for everyone who can read Settings — they say nothing a reader could not
  // learn by opening the page itself.
  const [gaps, inventory] = await Promise.all([
    can(user, "update", "Settings") ? workspaceSetupGaps(user.companyId, vertical) : [],
    settingsInventory(user.companyId, vertical),
  ]);

  // Users is a company-wide count on purpose — one legal entity, one roster —
  // and it is the only number left up here. Pipelines and document templates
  // used to sit beside it and were wrong twice over: a nested `_count` on
  // Company is a relation count the isolation extension never sees, so they
  // reported both workspaces at once, and now that every card states its own
  // total they would only repeat the grid below.
  const company = await prisma.company.findUnique({
    where: { id: user.companyId },
    include: { settings: true, _count: { select: { users: true } } },
  });

  // The subtitle names things this workspace actually has: commissions are
  // roofing's (solar pays a rep off the split on his own profile), equipment is
  // solar's. A subtitle listing a card that is not on the page below it is the
  // same wrong turn the hub itself used to take.
  const has = vertical === "solar" ? "equipment" : "commissions";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description={`Customize ${company?.name ?? "your workspace"} — pipeline, fields, documents, ${has}, and branding.`}
      />

      {/* Identity strip: whose settings these are, and which workspace they
          apply to — the numbers are a glance, not the point of the page. */}
      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-gold/10 text-gold">
            <Building2 className="size-5" />
          </span>
          <div className="min-w-0">
            <div className="truncate font-display text-base font-semibold tracking-tight">
              {company?.name}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                className="size-1.5 rounded-full"
                style={{ backgroundColor: VERTICAL_ACCENT[vertical] }}
                aria-hidden
              />
              {VERTICAL_LABEL[vertical]} workspace
            </div>
          </div>
        </div>

        <Link
          href="/portal/team"
          className="flex items-center gap-3 rounded-xl border border-border bg-background px-4 py-2.5 transition-colors hover:border-gold/40"
          title="Everyone in the company — one roster, shared by every workspace"
        >
          <Users className="size-4 text-muted-foreground" />
          <span className="font-display text-lg font-semibold tabular-nums">
            {company?._count.users ?? 0}
          </span>
          <span className="text-sm text-muted-foreground">
            {company?._count.users === 1 ? "user" : "users"}
          </span>
        </Link>
      </div>

      <SettingsHub vertical={vertical} inventory={inventory} gaps={gaps} />
    </div>
  );
}
