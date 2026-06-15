import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { ROLES } from "@/server/rbac/matrix";
import { roleLabel } from "@/lib/roles";
import { PageHeader } from "@/components/portal/ui";
import { NotificationRulesManager } from "@/components/portal/notification-rules-manager";
import { ScheduledRemindersSettings } from "@/components/portal/scheduled-reminders-settings";
import { EsignDeliverySettings } from "@/components/portal/esign-delivery-settings";

const STATUSES = ["not_started", "in_production", "on_hold", "qc", "completed", "closed", "cancelled"];

export const metadata = { title: "Notification Rules" };

export default async function NotificationSettingsPage() {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) redirect("/portal/settings");

  const [rules, pipeline, users, settings] = await Promise.all([
    prisma.notificationRule.findMany({ where: { companyId: user.companyId }, orderBy: { createdAt: "desc" } }),
    prisma.pipeline.findFirst({ where: { companyId: user.companyId }, orderBy: { isDefault: "desc" }, include: { stages: { orderBy: { position: "asc" } } } }),
    prisma.user.findMany({ where: { companyId: user.companyId, status: "active" }, orderBy: { firstName: "asc" }, select: { id: true, firstName: true, lastName: true } }),
    prisma.companySettings.findUnique({ where: { companyId: user.companyId }, select: { weeklyTaskRemindersEnabled: true, emailSignedCopyToSigners: true } }),
  ]);

  return (
    <div className="space-y-6">
      <Link href="/portal/settings" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to settings
      </Link>
      <PageHeader
        title="Notification Rules"
        description="Define what triggers a notification, who receives it, and how it's delivered."
      />
      <ScheduledRemindersSettings weeklyTaskReminders={settings?.weeklyTaskRemindersEnabled ?? true} />
      <EsignDeliverySettings emailSignedCopyToSigners={settings?.emailSignedCopyToSigners ?? true} />
      <NotificationRulesManager
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
