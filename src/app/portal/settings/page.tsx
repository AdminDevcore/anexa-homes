import { redirect } from "next/navigation";
import Link from "next/link";
import { Settings as SettingsIcon } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { getActiveVertical } from "@/server/auth/vertical";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { PageHeader } from "@/components/portal/ui";
import { visibleSettingsSections } from "@/lib/settings-sections";
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

      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-2">
          <SettingsIcon className="size-4 text-gold" />
          <h2 className="font-semibold">{company?.name}</h2>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Mini label="Users" value={company?._count.users ?? 0} />
          <Mini label="Pipelines" value={pipelines} />
          <Mini label="Doc Templates" value={documentTemplates} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visibleSettingsSections(vertical).map((s) => {
          const inner = (
            <>
              <span className="grid size-10 place-items-center rounded-lg bg-gold/12 text-gold-muted">
                <s.icon className="size-5" />
              </span>
              <h3 className="mt-4 font-medium">{s.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>
              <span
                className={`mt-3 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                  s.href ? "bg-gold/15 text-gold-muted" : "bg-muted text-muted-foreground"
                }`}
              >
                {s.href ? "Open" : "Next phase"}
              </span>
            </>
          );
          return s.href ? (
            <Link
              key={s.title}
              href={s.href}
              className="rounded-xl border border-border bg-card p-5 transition-colors hover:border-gold/40"
            >
              {inner}
            </Link>
          ) : (
            <div key={s.title} className="rounded-xl border border-border bg-card p-5">
              {inner}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-xl font-semibold">{value}</div>
    </div>
  );
}
