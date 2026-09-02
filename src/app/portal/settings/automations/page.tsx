import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { SettingsScreenHeader } from "@/components/portal/settings-kit/screen-header";
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

/**
 * Never cached. Run rows are written by whatever set the automation off — a
 * stage move on the deal page, a photo upload, the daily cron — so no
 * revalidatePath on this route can ever cover them, and a cached page would
 * report "nothing has run yet" over a run that had just happened.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Automations" };

export default async function AutomationSettingsPage({
  searchParams,
}: {
  /**
   * Which rule is open, and on which tab. Read HERE rather than in the browser:
   * a client that reads `window.location` while hydrating renders a rule the
   * server never sent, which React reports as a hydration mismatch.
   */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
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
      <SettingsScreenHeader
        section="automations"
        description="When a deal hits a milestone, do the paperwork — generate a document, send it for signature, compile the photos, move the job on."
      />
      <AutomationRulesManager
        initialRuleId={one(params.rule)}
        initialTab={one(params.tab)}
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
