import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { PageHeader } from "@/components/portal/ui";
import { AutomationRulesManager } from "@/components/portal/automation-rules-manager";

// Matches the ProjectStatus enum. Same list the notification settings page
// carries, for the same reason: the enum is not queryable at runtime.
const PROJECT_STATUSES = [
  "not_started",
  "in_production",
  "on_hold",
  "qc",
  "completed",
  "closed",
  "cancelled",
];

export const metadata = { title: "Automations" };

export default async function AutomationSettingsPage() {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) redirect("/portal/settings");

  // Everything here reads through the scoped client, so the rules, stages,
  // templates and checklists on offer are this workspace's own.
  const [rules, pipeline, templates, runs] = await Promise.all([
    prisma.automationRule.findMany({
      where: { companyId: user.companyId },
      orderBy: { createdAt: "desc" },
    }),
    prisma.pipeline.findFirst({
      where: { companyId: user.companyId },
      orderBy: { isDefault: "desc" },
      include: { stages: { orderBy: { position: "asc" } } },
    }),
    prisma.documentTemplate.findMany({
      where: { companyId: user.companyId, active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.automationRun.findMany({
      where: { companyId: user.companyId },
      orderBy: { startedAt: "desc" },
      take: 50,
      include: {
        rule: { select: { name: true } },
        lead: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
  ]);

  return (
    <div className="space-y-6">
      <Link
        href="/portal/settings"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to settings
      </Link>
      <PageHeader
        title="Automations"
        description="When a deal hits a milestone, do the paperwork — generate a document, send it for signature, compile the photos, move the job on."
      />
      <AutomationRulesManager
        rules={rules.map((r) => ({
          id: r.id,
          name: r.name,
          trigger: r.trigger,
          conditions: (r.conditions as Record<string, unknown>) ?? {},
          actions: (r.actions as Record<string, unknown>[]) ?? [],
          once: r.once,
          active: r.active,
        }))}
        stages={(pipeline?.stages ?? []).map((s) => ({ id: s.id, name: s.name }))}
        templates={templates}
        statuses={PROJECT_STATUSES}
        runs={runs.map((r) => ({
          id: r.id,
          ruleName: r.rule.name,
          status: r.status,
          steps: (r.steps as { type: string; ok: boolean; detail: string }[]) ?? [],
          error: r.error,
          startedAt: r.startedAt.toISOString(),
          lead: r.lead
            ? { id: r.lead.id, name: `${r.lead.firstName} ${r.lead.lastName}`.trim() }
            : null,
        }))}
      />
    </div>
  );
}
