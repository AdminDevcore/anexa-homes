import { redirect } from "next/navigation";
import { Building2, FileSignature, KanbanSquare, Users } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { getActiveVertical } from "@/server/auth/vertical";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { PageHeader } from "@/components/portal/ui";
import { SettingsHub } from "@/components/portal/settings-hub";
import { VERTICAL_ACCENT, VERTICAL_LABEL } from "@/lib/vertical";
import { workspaceSetupGaps } from "@/server/modules/settings/workspace-health";
import { WorkspaceSetupPanel } from "@/components/portal/workspace-setup-panel";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser();
  if (!can(user, "read", "Settings")) redirect("/portal/dashboard");
  const vertical = await getActiveVertical(user);

  // Only an admin can act on a gap, so only an admin is shown one.
  const gaps = can(user, "update", "Settings")
    ? await workspaceSetupGaps(user.companyId, vertical)
    : [];

  // Users is a company-wide count on purpose — one legal entity, one roster.
  //
  // Pipelines and document templates are NOT: they are vertical-isolated, and a
  // nested `_count` on Company is a relation count that the isolation extension
  // never sees, so these tiles used to report both workspaces' rows while every
  // other number on the page was this workspace's. Counted directly through the
  // scoped client instead, or the tile says "8" one line under a panel saying
  // there is nothing to send for signature.
  const [company, pipelines, documentTemplates] = await Promise.all([
    prisma.company.findUnique({
      where: { id: user.companyId },
      include: { settings: true, _count: { select: { users: true } } },
    }),
    prisma.pipeline.count({ where: { companyId: user.companyId } }),
    prisma.documentTemplate.count({ where: { companyId: user.companyId } }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description={`Customize ${company?.name ?? "your workspace"} — pipeline, fields, documents, commissions, and branding.`}
      />

      <WorkspaceSetupPanel gaps={gaps} vertical={vertical} />

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

        <div className="grid grid-cols-3 divide-x divide-border overflow-hidden rounded-xl border border-border bg-background">
          <Mini
            icon={Users}
            label="Users"
            value={company?._count.users ?? 0}
            hint="Everyone in the company, across workspaces"
          />
          <Mini
            icon={KanbanSquare}
            label="Pipelines"
            value={pipelines}
            hint={`Pipelines in the ${VERTICAL_LABEL[vertical]} workspace`}
          />
          <Mini
            icon={FileSignature}
            label="Doc templates"
            value={documentTemplates}
            hint={`Templates in the ${VERTICAL_LABEL[vertical]} workspace`}
          />
        </div>
      </div>

      <SettingsHub vertical={vertical} />
    </div>
  );
}

function Mini({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <div className="px-4 py-3 sm:px-5" title={hint}>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
        <Icon className="size-3.5" />
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 font-display text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
