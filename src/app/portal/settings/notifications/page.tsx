import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { ROLES } from "@/server/rbac/matrix";
import { roleLabel } from "@/lib/roles";
import { SettingsScreenHeader } from "@/components/portal/settings-kit/screen-header";
import { NotificationRulesManager } from "@/components/portal/notification-rules-manager";

const STATUSES = ["not_started", "in_production", "on_hold", "qc", "completed", "closed", "cancelled"];

export const metadata = { title: "Notification Rules" };

export default async function NotificationSettingsPage({
  searchParams,
}: {
  /** Which rule is open. Read on the SERVER so the first paint is the right one. */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
  const user = await requireUser();
  if (!can(user, "update", "Settings")) redirect("/portal/settings");

  const [rules, pipeline, users, settings] = await Promise.all([
    prisma.notificationRule.findMany({ where: { companyId: user.companyId }, orderBy: { createdAt: "desc" } }),
    prisma.pipeline.findFirst({ where: { companyId: user.companyId }, orderBy: { isDefault: "desc" }, include: { stages: { orderBy: { position: "asc" } } } }),
    prisma.user.findMany({ where: { companyId: user.companyId, status: "active" }, orderBy: { firstName: "asc" }, select: { id: true, firstName: true, lastName: true } }),
    prisma.companySettings.findUnique({ where: { companyId: user.companyId }, select: { weeklyTaskRemindersEnabled: true, emailSignedCopyToSigners: true, overdueDigestEnabled: true } }),
  ]);

  return (
    <div className="space-y-6">
      <SettingsScreenHeader
        section="notification_rules"
        description="Define what triggers a notification, who receives it, and how it's delivered."
      />
      <NotificationRulesManager
        initialRuleId={one(params.rule)}
        schedules={{
          weeklyTaskReminders: settings?.weeklyTaskRemindersEnabled ?? true,
          overdueDigest: settings?.overdueDigestEnabled ?? true,
          emailSignedCopyToSigners: settings?.emailSignedCopyToSigners ?? true,
        }}
        rules={rules.map((r) => ({
          id: r.id,
          name: r.name,
          event: r.event,
          conditions: r.conditions as { stageId?: string; status?: string },
          recipients: r.recipients as { roles?: string[]; userIds?: string[]; dynamic?: string[] },
          channels: r.channels as string[],
          titleTemplate: r.titleTemplate,
          bodyTemplate: r.bodyTemplate,
          active: r.active,
        }))}
        stages={(pipeline?.stages ?? []).map((s) => ({ id: s.id, name: s.name }))}
        statuses={STATUSES}
        users={users.map((u) => ({ id: u.id, name: `${u.firstName} ${u.lastName}` }))}
        roles={ROLES.map((r) => ({ value: r, label: roleLabel(r) }))}
      />
    </div>
  );
}
